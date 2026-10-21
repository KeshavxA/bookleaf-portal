import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { ADMIN, PRIYA, ROHIT, buildTestApp, failingSdk, fakeMessage, llmWithFakeSdk, login, prisma, resetTickets } from "../helpers";

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("ticket creation when the LLM is down", () => {
  const { app, container } = buildTestApp(llmWithFakeSdk(failingSdk));
  let priya: string;
  let admin: string;

  beforeAll(async () => {
    [priya, admin] = await Promise.all([login(app, PRIYA), login(app, ADMIN)]);
  });
  beforeEach(resetTickets);

  it("still returns 201, then falls back to keyword triage with aiStatus FAILED", async () => {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({
        bookId: "BK001",
        subject: "Wrong ISBN on Amazon",
        description: "The ISBN on Amazon is different from the one printed on my book.",
        attachments: [{ name: "photo.jpg", size: 2048 }],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "OPEN", book: { id: "BK001" }, attachments: [{ name: "photo.jpg", size: 2048 }] });

    await container.queue.onIdle();
    const t = await request(app).get(`/api/v1/admin/tickets/${res.body.id}`).set(auth(admin));
    expect(t.body).toMatchObject({
      aiStatus: "FAILED",
      aiSuggestion: null,
      category: "ISBN_METADATA",
      priority: "HIGH", // ISBN floor applies to fallback too
      categoryOverridden: false,
    });

    // every attempt is accounted for in a single AiCall row
    const calls = await prisma.aiCall.findMany({ where: { ticketId: res.body.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "CLASSIFY", status: "ERROR", attempts: 3, errorCode: "UPSTREAM_ERROR" });
  });

  it("draft endpoint returns 200 with draft=null and an error so the admin can reply manually", async () => {
    const created = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: null, subject: "Author bio", description: "Can I update my author bio on the store?" });
    await container.queue.onIdle();

    const res = await request(app).post(`/api/v1/admin/tickets/${created.body.id}/draft`).set(auth(admin)).send({});
    expect(res.status).toBe(200);
    expect(res.body.draft).toBeNull();
    expect(res.body.error.code).toMatch(/^AI_/);

    // manual reply still works and is visible to the author
    const reply = await request(app)
      .post(`/api/v1/admin/tickets/${created.body.id}/reply`)
      .set(auth(admin))
      .send({ body: "Yes - send us the new bio and we'll update it." });
    expect(reply.status).toBe(201);
    const mine = await request(app).get(`/api/v1/tickets/${created.body.id}`).set(auth(priya));
    expect(mine.body.status).toBe("IN_PROGRESS");
    expect(mine.body.messages).toHaveLength(1);
    expect(mine.body.messages[0]).toMatchObject({ senderType: "ADMIN", body: "Yes - send us the new bio and we'll update it." });
  });
});

describe("ticket lifecycle with a working LLM", () => {
  let draftCalls = 0;
  const sdk = async (params: Anthropic.MessageCreateParamsNonStreaming) => {
    if (params.output_config?.format) {
      return fakeMessage(JSON.stringify({ category: "ROYALTY_PAYMENTS", priority: "CRITICAL", reasoning: "No royalty for six months" }));
    }
    draftCalls++;
    return fakeMessage(
      `Hi Priya,\n\n${"I understand how frustrating this wait has been and I'm sorry. ".repeat(6)}\n\nWarm regards,\nBookLeaf Support Team`,
    );
  };
  const { app, container } = buildTestApp(llmWithFakeSdk(sdk));
  let priya: string;
  let rohit: string;
  let admin: string;
  let ticketId: string;

  beforeAll(async () => {
    [priya, rohit, admin] = await Promise.all([login(app, PRIYA), login(app, ROHIT), login(app, ADMIN)]);
    await resetTickets();
    const res = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: "BK001", subject: "Royalty missing", description: "I have not received any royalty for 6 months." });
    ticketId = res.body.id;
    await container.queue.onIdle();
  });

  it("stores the AI classification and suggestion", async () => {
    const t = await request(app).get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(t.body).toMatchObject({
      aiStatus: "DONE",
      category: "ROYALTY_PAYMENTS",
      priority: "CRITICAL",
      aiSuggestion: { category: "ROYALTY_PAYMENTS", priority: "CRITICAL", reasoning: "No royalty for six months" },
    });
  });

  it("admin overrides set flags and survive a re-classification", async () => {
    const patched = await request(app).patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ priority: "HIGH" });
    expect(patched.body).toMatchObject({ priority: "HIGH", priorityOverridden: true, categoryOverridden: false });

    const retry = await request(app).post(`/api/v1/admin/tickets/${ticketId}/classify`).set(auth(admin));
    expect(retry.status).toBe(202);
    await container.queue.onIdle();
    const t = await request(app).get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(t.body).toMatchObject({ priority: "HIGH", priorityOverridden: true, aiStatus: "DONE", aiSuggestion: { priority: "CRITICAL" } });
  });

  it("caches the draft, regenerates on request, and invalidates on a new author message", async () => {
    const first = await request(app).post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin)).send({});
    expect(first.body.draft).toMatchObject({ source: "AI" });
    expect(first.body.draft.body).toMatch(/BookLeaf Support Team$/);
    const callsAfterFirst = draftCalls;

    const cached = await request(app).post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin)).send({});
    expect(cached.body.draft.generatedAt).toBe(first.body.draft.generatedAt);
    expect(draftCalls).toBe(callsAfterFirst);

    await request(app).post(`/api/v1/admin/tickets/${ticketId}/draft`).set(auth(admin)).send({ regenerate: true });
    expect(draftCalls).toBe(callsAfterFirst + 1);

    await request(app).post(`/api/v1/tickets/${ticketId}/messages`).set(auth(priya)).send({ body: "Any update?" });
    const detail = await request(app).get(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin));
    expect(detail.body.draft).toBeNull();
  });

  it("supports notes, assignment, queue filters and urgency sort", async () => {
    await request(app)
      .post("/api/v1/tickets")
      .set(auth(rohit))
      .send({ bookId: "BK003", subject: "Author bio update", description: "How do I change my bio on the store?" });
    await container.queue.onIdle();

    const note = await request(app).post(`/api/v1/admin/tickets/${ticketId}/notes`).set(auth(admin)).send({ body: "Checked ledger" });
    expect(note.status).toBe(201);
    expect(note.body).toMatchObject({ adminName: "Ritika Sen", body: "Checked ledger" });

    const assigned = await request(app).post(`/api/v1/admin/tickets/${ticketId}/assign-to-me`).set(auth(admin));
    expect(assigned.body.assignee.name).toBe("Ritika Sen");

    const mine = await request(app).get("/api/v1/admin/tickets?assigneeId=me").set(auth(admin));
    expect(mine.body.items.map((t: { id: string }) => t.id)).toEqual([ticketId]);
    expect(mine.body.items[0]).not.toHaveProperty("messages");

    const search = await request(app).get("/api/v1/admin/tickets?q=bio").set(auth(admin));
    expect(search.body.total).toBe(1);

    const queue = await request(app).get("/api/v1/admin/tickets").set(auth(admin));
    expect(queue.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
  });

  it("refuses author messages on closed tickets", async () => {
    await request(app).patch(`/api/v1/admin/tickets/${ticketId}`).set(auth(admin)).send({ status: "CLOSED" });
    const res = await request(app).post(`/api/v1/tickets/${ticketId}/messages`).set(auth(priya)).send({ body: "hello?" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });
});

describe("realtime (SSE)", () => {
  const { app, container } = buildTestApp(llmWithFakeSdk(failingSdk));
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await resetTickets();
  });
  afterAll(async () => {
    container.hub.close();
    await new Promise((r) => server.close(r));
  });

  function listen(token: string): { events: string[]; close: () => void } {
    const events: string[] = [];
    const req = http.get(`${base}/api/v1/events`, { headers: auth(token) }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        for (const line of chunk.split("\n")) if (line.startsWith("event: ")) events.push(line.slice(7));
      });
    });
    req.on("error", () => {});
    return { events, close: () => req.destroy() };
  }

  it("scopes events by role and cleans up on disconnect", async () => {
    const [priya, rohit, admin] = await Promise.all([login(app, PRIYA), login(app, ROHIT), login(app, ADMIN)]);
    const priyaStream = listen(priya);
    const rohitStream = listen(rohit);
    const adminStream = listen(admin);
    await new Promise((r) => setTimeout(r, 100));
    expect(container.hub.size).toBe(3);

    const created = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: null, subject: "Question", description: "How do I update my author profile?" });
    await container.queue.onIdle();
    await request(app).post(`/api/v1/admin/tickets/${created.body.id}/reply`).set(auth(admin)).send({ body: "Here's how." });
    await new Promise((r) => setTimeout(r, 100));

    expect(adminStream.events).toEqual(expect.arrayContaining(["ticket.created", "ticket.ai_ready", "ticket.message"]));
    expect(priyaStream.events).toEqual(expect.arrayContaining(["ticket.message", "ticket.updated"]));
    expect(priyaStream.events).not.toContain("ticket.created");
    expect(priyaStream.events).not.toContain("ticket.ai_ready");
    expect(rohitStream.events).toEqual([]);

    [priyaStream, rohitStream, adminStream].forEach((s) => s.close());
    await new Promise((r) => setTimeout(r, 100));
    expect(container.hub.size).toBe(0);
  });
});
