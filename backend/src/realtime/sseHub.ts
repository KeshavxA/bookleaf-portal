import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { ADMIN_ONLY_EVENTS, type EventBus, type TicketEvent } from "./eventBus";
import type { AuthClaims } from "../lib/jwt";

export const HEARTBEAT_MS = 25_000;

interface Client {
  id: string;
  role: AuthClaims["role"];
  authorId: string | null;
  res: Response;
}

/** Holds open SSE connections and routes bus events to the clients allowed to see them. */
export class SseHub {
  private readonly clients = new Map<string, Client>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor(bus: EventBus, heartbeatMs = HEARTBEAT_MS) {
    bus.subscribe((e) => this.dispatch(e));
    this.heartbeat = setInterval(() => this.broadcastComment("heartbeat"), heartbeatMs);
    this.heartbeat.unref();
  }

  connect(auth: AuthClaims, res: Response): string {
    const id = randomUUID();
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering (nginx/Render/Railway)
    res.flushHeaders();
    res.write("retry: 5000\n\n");
    res.write(": connected\n\n");

    this.clients.set(id, { id, role: auth.role, authorId: auth.authorId, res });
    res.on("close", () => this.clients.delete(id));
    return id;
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients.values()) c.res.end();
    this.clients.clear();
  }

  private canSee(client: Client, e: TicketEvent): boolean {
    if (client.role === "ADMIN") return true;
    return !e.adminOnly && !ADMIN_ONLY_EVENTS.has(e.type) && client.authorId === e.authorId;
  }

  private dispatch(e: TicketEvent): void {
    const frame = `event: ${e.type}\ndata: ${JSON.stringify({ ticketId: e.ticketId })}\n\n`;
    for (const client of this.clients.values()) {
      if (this.canSee(client, e)) this.safeWrite(client, frame);
    }
  }

  private broadcastComment(text: string): void {
    for (const client of this.clients.values()) this.safeWrite(client, `: ${text}\n\n`);
  }

  private safeWrite(client: Client, chunk: string): void {
    if (client.res.writableEnded || client.res.destroyed) {
      this.clients.delete(client.id);
      return;
    }
    client.res.write(chunk);
  }
}
