/**
 * Security and contract checks driven by the real route table, so a route added
 * later is covered automatically: it must be authenticated, role-checked and documented.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { listRoutes, type RouteInfo } from "../../src/lib/routeTable";
import { API_PREFIX } from "../../src/app";
import { openApiSpec } from "../../src/docs/openapi";
import { ADMIN, PRIYA, ROHIT, buildTestApp, fakeMessage, llmWithFakeSdk, login, prisma, resetTickets } from "../helpers";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const AI_REASONING = "Royalty overdue for six months per author";
const NOTE_TEXT = "Internal: ledger shows BK001 skipped in Q2 batch";
const DRAFT_TEXT = `Hi Priya,\n\n${"We are checking your royalty payment and will update you soon. ".repeat(6)}\n\nWarm regards,\nBookLeaf Support Team`;

const sdk = async (params: Anthropic.MessageCreateParamsNonStreaming) =>
  params.output_config?.format
    ? fakeMessage(JSON.stringify({ category: "ROYALTY_PAYMENTS", priority: "CRITICAL", reasoning: AI_REASONING }))
    : fakeMessage(DRAFT_TEXT);

const { app, container } = buildTestApp(llmWithFakeSdk(sdk));
const routes = listRoutes(app);

/** Routes reachable without a token. Adding one here should be a deliberate, reviewed change. */
const PUBLIC_ROUTES = new Set([
  "POST /api/v1/auth/login",
  "GET /health",
  "GET /api/docs/openapi.json", // public API documentation
]);

const key = (r: RouteInfo) => `${r.method} ${r.path}`;
const fill = (path: string, id: string) => path.replace(/:id\b/g, id);
const send = (r: RouteInfo, path: string, token?: string) => {
  const m = r.method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete";
  const req = request(app)[m](path);
  if (token) req.set(auth(token));
  return r.method === "GET" ? req : req.send({ body: "A perfectly valid follow-up message" });
};

let priya: string;
let rohit: string;
let admin: string;
let priyaTicketId: string;

beforeAll(async () => {
  [priya, rohit, admin] = await Promise.all([login(app, PRIYA), login(app, ROHIT), login(app, ADMIN)]);
  await container.queue.onIdle();
  await resetTickets();

  // A ticket with every admin-only field populated: AI result, assignee, note, draft and a reply.
  const created = await request(app)
    .post("/api/v1/tickets")
    .set(auth(priya))
    .send({ bookId: "BK001", subject: "Royalty missing", description: "No royalty has arrived for six months now." });
  priyaTicketId = created.body.id;
  await container.queue.onIdle();
  await request(app).post(`/api/v1/admin/tickets/${priyaTicketId}/notes`).set(auth(admin)).send({ body: NOTE_TEXT });
  await request(app).post(`/api/v1/admin/tickets/${priyaTicketId}/assign-to-me`).set(auth(admin));
  await request(app).post(`/api/v1/admin/tickets/${priyaTicketId}/draft`).set(auth(admin)).send({});
  await request(app).patch(`/api/v1/admin/tickets/${priyaTicketId}`).set(auth(admin)).send({ category: "GENERAL_INQUIRY" });
  await request(app).post(`/api/v1/admin/tickets/${priyaTicketId}/draft`).set(auth(admin)).send({});
});
afterAll(async () => {
  await container.queue.onIdle();
  await resetTickets();
});

describe("route table", () => {
  it("finds the expected routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(19);
    expect(routes.map(key)).toContain("POST /api/v1/admin/tickets/:id/classify");
  });

  it("has exactly the intended public routes", () => {
    const publicOnes = routes.map(key).filter((k) => PUBLIC_ROUTES.has(k));
    expect(new Set(publicOnes)).toEqual(PUBLIC_ROUTES);
  });
});

describe("authentication", () => {
  it("every non-public route returns 401 without a token", async () => {
    const protectedRoutes = routes.filter((r) => !PUBLIC_ROUTES.has(key(r)));
    expect(protectedRoutes.length).toBeGreaterThan(10);
    for (const r of protectedRoutes) {
      const res = await send(r, fill(r.path, priyaTicketId));
      expect(res.status, key(r)).toBe(401);
      expect(res.body.error?.code, key(r)).toBe("UNAUTHORIZED");
    }
  });

  it("every non-public route returns 401 with a malformed token", async () => {
    for (const r of routes.filter((x) => !PUBLIC_ROUTES.has(key(x)))) {
      const res = await send(r, fill(r.path, priyaTicketId), "not-a-jwt");
      expect(res.status, key(r)).toBe(401);
    }
  });
});

describe("authorization", () => {
  const adminRoutes = () => routes.filter((r) => r.path.startsWith(`${API_PREFIX}/admin/`));

  it("every /admin/* route returns 403 for an AUTHOR token", async () => {
    expect(adminRoutes().length).toBeGreaterThanOrEqual(9);
    for (const r of adminRoutes()) {
      const res = await send(r, fill(r.path, priyaTicketId), priya);
      expect(res.status, key(r)).toBe(403);
      expect(res.body.error.code, key(r)).toBe("FORBIDDEN");
    }
  });

  it("an author gets 404 on every :id route for another author's ticket", async () => {
    const authorIdRoutes = routes.filter((r) => r.path.includes(":id") && !r.path.startsWith(`${API_PREFIX}/admin/`));
    expect(authorIdRoutes.map(key)).toEqual(
      expect.arrayContaining(["GET /api/v1/tickets/:id", "POST /api/v1/tickets/:id/messages"]),
    );
    for (const r of authorIdRoutes) {
      const res = await send(r, fill(r.path, priyaTicketId), rohit);
      expect(res.status, key(r)).toBe(404);
      expect(res.body.error.code, key(r)).toBe("NOT_FOUND");
    }
    // and nothing was written to Priya's ticket
    expect(await prisma.ticketMessage.count({ where: { ticketId: priyaTicketId, senderType: "AUTHOR" } })).toBe(0);
  });

  it("POST /tickets with another author's bookId is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: "BK003", subject: "Not my book", description: "Trying to attach Rohit's book here." });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.ticket.count({ where: { bookId: "BK003" } })).toBe(0);
  });
});

describe("AuthorTicket never leaks admin fields", () => {
  // Matches the key anywhere in the JSON, including nested objects.
  const FORBIDDEN_KEYS = [
    "category",
    "priority",
    "aiStatus",
    "aiSuggestion",
    "aiCategory",
    "aiPriority",
    "aiReasoning",
    "aiError",
    "categoryOverridden",
    "priorityOverridden",
    "assignee",
    "assigneeId",
    "internalNotes",
    "draft",
    "draftBody",
  ];

  function expectClean(label: string, body: unknown) {
    const json = JSON.stringify(body);
    for (const k of FORBIDDEN_KEYS) expect(json, `${label} contains "${k}"`).not.toContain(`"${k}":`);
    expect(json, label).not.toContain(AI_REASONING);
    expect(json, label).not.toContain(NOTE_TEXT);
    expect(json, label).not.toContain("We are checking your royalty payment"); // unsent draft
  }

  it("the fixture ticket really has those fields set (admin view)", async () => {
    const res = await request(app).get(`/api/v1/admin/tickets/${priyaTicketId}`).set(auth(admin));
    expect(res.body.aiSuggestion.reasoning).toBe(AI_REASONING);
    expect(res.body.internalNotes[0].body).toBe(NOTE_TEXT);
    expect(res.body.assignee).not.toBeNull();
    expect(res.body.draft.body).toContain("We are checking your royalty payment");
  });

  it("GET /tickets/:id, GET /tickets, POST /tickets and POST /messages are clean", async () => {
    expectClean("GET /tickets/:id", (await request(app).get(`/api/v1/tickets/${priyaTicketId}`).set(auth(priya))).body);
    expectClean("GET /tickets", (await request(app).get("/api/v1/tickets").set(auth(priya))).body);

    const created = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: null, subject: "Another question", description: "How do I change my author bio?" });
    expect(created.status).toBe(201);
    expectClean("POST /tickets", created.body);

    const msg = await request(app).post(`/api/v1/tickets/${priyaTicketId}/messages`).set(auth(priya)).send({ body: "Any update?" });
    expect(msg.status).toBe(201);
    expectClean("POST /tickets/:id/messages", msg.body);
    await container.queue.onIdle();
  });

  it("the author still sees admin replies", async () => {
    await request(app).post(`/api/v1/admin/tickets/${priyaTicketId}/reply`).set(auth(admin)).send({ body: "We are on it." });
    const res = await request(app).get(`/api/v1/tickets/${priyaTicketId}`).set(auth(priya));
    expectClean("GET /tickets/:id after reply", res.body);
    expect(res.body.messages.at(-1)).toMatchObject({ senderType: "ADMIN", body: "We are on it." });
  });
});

describe("SSE scoping", () => {
  let server: http.Server;
  let base: string;

  beforeAll(() => {
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((r) => server.close(r)));

  interface Frame {
    event: string;
    ticketId: string;
  }

  function listen(token: string) {
    const frames: Frame[] = [];
    let buffer = "";
    const req = http.get(`${base}/api/v1/events`, { headers: auth(token) }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) frames.push({ event, ticketId: (JSON.parse(data) as { ticketId: string }).ticketId });
        }
      });
    });
    req.on("error", () => {});
    return { frames, close: () => req.destroy() };
  }

  const settle = () => new Promise((r) => setTimeout(r, 150));

  it("authors receive only their own tickets' events, never created/ai_ready; streams are cleaned up", async () => {
    const before = container.hub.size;
    const priyaStream = listen(priya);
    const rohitStream = listen(rohit);
    const adminStream = listen(admin);
    await settle();
    expect(container.hub.size).toBe(before + 3);

    const mine = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: null, subject: "Priya question", description: "How do I update my author profile?" });
    const theirs = await request(app)
      .post("/api/v1/tickets")
      .set(auth(rohit))
      .send({ bookId: "BK003", subject: "Rohit question", description: "Is Code & Karma available in the UK?" });
    await container.queue.onIdle();
    for (const id of [mine.body.id, theirs.body.id]) {
      await request(app).post(`/api/v1/admin/tickets/${id}/reply`).set(auth(admin)).send({ body: "Replying now." });
      await request(app).post(`/api/v1/admin/tickets/${id}/notes`).set(auth(admin)).send({ body: "private" });
      await request(app).patch(`/api/v1/admin/tickets/${id}`).set(auth(admin)).send({ priority: "LOW" });
    }
    await settle();

    expect(adminStream.frames.map((f) => f.event)).toEqual(
      expect.arrayContaining(["ticket.created", "ticket.ai_ready", "ticket.message", "ticket.updated"]),
    );
    for (const [stream, ownId] of [
      [priyaStream, mine.body.id],
      [rohitStream, theirs.body.id],
    ] as const) {
      expect(stream.frames.length).toBeGreaterThan(0);
      expect(stream.frames.every((f) => f.ticketId === ownId)).toBe(true);
      expect(stream.frames.map((f) => f.event)).not.toContain("ticket.created");
      expect(stream.frames.map((f) => f.event)).not.toContain("ticket.ai_ready");
      expect(stream.frames.map((f) => f.event)).toContain("ticket.message");
    }

    [priyaStream, rohitStream, adminStream].forEach((s) => s.close());
    await settle();
    expect(container.hub.size).toBe(before);
  });
});

describe("OpenAPI spec matches the router", () => {
  const toOpenApi = (p: string) => p.slice(API_PREFIX.length).replace(/:(\w+)/g, "{$1}");
  const apiRoutes = routes.filter((r) => r.path.startsWith(`${API_PREFIX}/`));
  const routeKeys = new Set(apiRoutes.map((r) => `${r.method} ${toOpenApi(r.path)}`));
  const specKeys = new Set(
    Object.entries(openApiSpec.paths as Record<string, Record<string, unknown>>).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((m) => ["get", "post", "put", "patch", "delete"].includes(m))
        .map((m) => `${m.toUpperCase()} ${path}`),
    ),
  );

  it("documents every Express route", () => {
    expect([...routeKeys].filter((k) => !specKeys.has(k))).toEqual([]);
  });

  it("has no spec path that is not a real route", () => {
    expect([...specKeys].filter((k) => !routeKeys.has(k))).toEqual([]);
  });
});
