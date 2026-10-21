import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ADMIN, PASSWORD, PRIYA, ROHIT, buildTestApp, failingSdk, llmWithFakeSdk, login, prisma, resetTickets } from "../helpers";

const { app, container } = buildTestApp(llmWithFakeSdk(failingSdk));
let priya: string;
let rohit: string;
let admin: string;

beforeAll(async () => {
  [priya, rohit, admin] = await Promise.all([login(app, PRIYA), login(app, ROHIT), login(app, ADMIN)]);
});
beforeEach(async () => {
  await container.queue.onIdle();
  await resetTickets();
});

describe("auth", () => {
  it("logs in with seeded credentials and returns the user", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({ email: "Priya.Sharma@email.com", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: PRIYA, role: "AUTHOR", name: "Priya Sharma" });
    expect(res.body.user).not.toHaveProperty("passwordHash");
  });

  it("rejects bad credentials with the same message for unknown users", async () => {
    const wrong = await request(app).post("/api/v1/auth/login").send({ email: PRIYA, password: "nope" });
    const unknown = await request(app).post("/api/v1/auth/login").send({ email: "ghost@email.com", password: "nope" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it("protects every route except login", async () => {
    for (const [method, path] of [
      ["get", "/api/v1/auth/me"],
      ["get", "/api/v1/books"],
      ["get", "/api/v1/tickets"],
      ["get", "/api/v1/admin/tickets"],
      ["get", "/api/v1/events"],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
  });

  it("rejects tampered and expired tokens", async () => {
    const tampered = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${priya}x`);
    expect(tampered.status).toBe(401);
    const expired = jwt.sign({ role: "ADMIN", authorId: null }, "test-secret-test-secret-test-secret-123456", {
      subject: "x",
      expiresIn: -10,
    });
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns the caller", async () => {
    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${admin}`);
    expect(res.body).toMatchObject({ email: ADMIN, role: "ADMIN" });
  });
});

describe("RBAC", () => {
  async function createTicket(token: string, bookId: string | null) {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${token}`)
      .send({ bookId, subject: "Royalty question", description: "When will my next royalty payout happen?" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it("an author cannot read another author's ticket (404, not 403)", async () => {
    const id = await createTicket(rohit, "BK003");
    const res = await request(app).get(`/api/v1/tickets/${id}`).set("Authorization", `Bearer ${priya}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");

    const msg = await request(app)
      .post(`/api/v1/tickets/${id}/messages`)
      .set("Authorization", `Bearer ${priya}`)
      .send({ body: "hello" });
    expect(msg.status).toBe(404);

    const list = await request(app).get("/api/v1/tickets").set("Authorization", `Bearer ${priya}`);
    expect(list.body).toEqual([]);
  });

  it("an author only sees their own books", async () => {
    const res = await request(app).get("/api/v1/books").set("Authorization", `Bearer ${priya}`);
    expect(res.status).toBe(200);
    expect(res.body.map((b: { id: string }) => b.id).sort()).toEqual(["BK001", "BK002"]);
  });

  it("an author cannot attach another author's book to a ticket", async () => {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${priya}`)
      .send({ bookId: "BK003", subject: "Hello there", description: "This is not my book at all." });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: "bookId", message: "Book not found" }]);
  });

  it("authors are forbidden from admin endpoints and admins from author endpoints", async () => {
    const id = await createTicket(priya, "BK001");
    const asAuthor = await request(app).get(`/api/v1/admin/tickets/${id}`).set("Authorization", `Bearer ${priya}`);
    expect(asAuthor.status).toBe(403);
    expect((await request(app).get("/api/v1/books").set("Authorization", `Bearer ${admin}`)).status).toBe(403);
  });

  it("author responses never include triage, AI, assignee or note fields", async () => {
    const id = await createTicket(priya, "BK001");
    await container.queue.onIdle();
    await request(app).post(`/api/v1/admin/tickets/${id}/notes`).set("Authorization", `Bearer ${admin}`).send({ body: "secret" });
    const res = await request(app).get(`/api/v1/tickets/${id}`).set("Authorization", `Bearer ${priya}`);
    for (const key of ["category", "priority", "aiStatus", "aiSuggestion", "assignee", "internalNotes", "draft"]) {
      expect(res.body).not.toHaveProperty(key);
    }
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("assigning a ticket to a non-admin is a validation error", async () => {
    const id = await createTicket(priya, null);
    const author = await prisma.user.findUniqueOrThrow({ where: { email: ROHIT } });
    const res = await request(app)
      .patch(`/api/v1/admin/tickets/${id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ assigneeId: author.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe("assigneeId");
  });
});
