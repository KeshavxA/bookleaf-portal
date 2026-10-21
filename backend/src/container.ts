/**
 * Composition root. The only place that knows concrete implementations;
 * everything else receives its dependencies. Tests build a container with a
 * fake LLM and get the real HTTP stack, services and database.
 */
import type { Logger } from "pino";
import { env } from "./config/env";
import { logger as rootLogger } from "./lib/logger";
import { prisma as defaultPrisma, type Db } from "./lib/prisma";
import { LlmClient } from "./ai/llm/client";
import { CircuitBreaker } from "./ai/llm/circuitBreaker";
import type { LlmPort } from "./ai/llm/types";
import { TicketClassifier } from "./ai/classifier/classifier";
import { TicketDrafter } from "./ai/drafter/drafter";
import { UserRepository } from "./repositories/userRepository";
import { BookRepository } from "./repositories/bookRepository";
import { TicketRepository } from "./repositories/ticketRepository";
import { AiCallRepository } from "./repositories/aiCallRepository";
import { AuthService } from "./services/authService";
import { BookService } from "./services/bookService";
import { TicketService } from "./services/ticketService";
import { AdminTicketService } from "./services/adminTicketService";
import { TriageService } from "./services/triageService";
import { DraftService } from "./services/draftService";
import { EventBus } from "./realtime/eventBus";
import { SseHub } from "./realtime/sseHub";
import { ClassificationQueue } from "./jobs/classificationQueue";
import { AuthController } from "./controllers/authController";
import { AuthorController } from "./controllers/authorController";
import { AdminController } from "./controllers/adminController";
import { EventsController } from "./controllers/eventsController";

export interface ContainerOverrides {
  db?: Db;
  llm?: LlmPort;
  logger?: Logger;
  sseHeartbeatMs?: number;
}

export function buildContainer(overrides: ContainerOverrides = {}) {
  const db = overrides.db ?? defaultPrisma;
  const log = overrides.logger ?? rootLogger;

  const users = new UserRepository(db);
  const books = new BookRepository(db);
  const tickets = new TicketRepository(db);
  const aiCalls = new AiCallRepository(db);

  const llm =
    overrides.llm ??
    new LlmClient({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.LLM_MODEL,
      timeoutMs: env.LLM_TIMEOUT_MS,
      maxRetries: env.LLM_MAX_RETRIES,
      breaker: new CircuitBreaker({ threshold: env.LLM_BREAKER_THRESHOLD, cooldownMs: env.LLM_BREAKER_COOLDOWN_MS }),
      recorder: aiCalls,
      onWarn: (msg, ctx) => log.warn(ctx, msg),
    });

  const bus = new EventBus();
  const hub = new SseHub(bus, overrides.sseHeartbeatMs);
  const triage = new TriageService(tickets, new TicketClassifier(llm), bus, log);
  const queue = new ClassificationQueue((id) => triage.classifyTicket(id), 2, (ticketId, err) =>
    log.error({ err, ticketId }, "Classification job crashed"),
  );

  const services = {
    auth: new AuthService(users),
    books: new BookService(books),
    tickets: new TicketService(tickets, books, queue, bus),
    adminTickets: new AdminTicketService(tickets, users, triage, queue, bus),
    drafts: new DraftService(tickets, new TicketDrafter(llm), bus, log),
  };

  const controllers = {
    auth: new AuthController(services.auth),
    author: new AuthorController(services.books, services.tickets),
    admin: new AdminController(services.adminTickets, services.drafts),
    events: new EventsController(hub),
  };

  return {
    db,
    llm,
    bus,
    hub,
    queue,
    services,
    controllers,
    /** Re-queue tickets left PENDING by a restart (or seeded demo tickets). */
    async recoverPendingClassifications() {
      const ids = await tickets.findPendingClassificationIds();
      ids.forEach((id) => queue.enqueue(id));
      return ids.length;
    },
  };
}

export type Container = ReturnType<typeof buildContainer>;
export type Controllers = Container["controllers"];
