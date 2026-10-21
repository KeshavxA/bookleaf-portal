import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { ADMIN, PRIYA, buildTestApp, failingSdk, llmWithFakeSdk, login } from "../helpers";

const { app } = buildTestApp(llmWithFakeSdk(failingSdk));
let priya: string;
let admin: string;
beforeAll(async () => {
  [priya, admin] = await Promise.all([login(app, PRIYA), login(app, ADMIN)]);
});

describe("validation errors", () => {
  it("returns field-level details for an invalid ticket", async () => {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${priya}`)
      .send({ subject: "Hi", description: "short", attachments: [{ name: "", size: -1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["bookId", "subject", "description", "attachments.0.name", "attachments.0.size"]));
  });

  it("rejects malformed JSON with the standard envelope (not a 500)", async () => {
    const res = await request(app)
      .post("/api/v1/tickets")
      .set("Authorization", `Bearer ${priya}`)
      .set("Content-Type", "application/json")
      .send('{"subject": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", details: [] });
  });

  it("validates admin queue filters", async () => {
    const res = await request(app)
      .get("/api/v1/admin/tickets?status=OPEN,NOPE&pageSize=500&sort=random")
      .set("Authorization", `Bearer ${admin}`);
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["status.1", "pageSize", "sort"]));
  });

  it("rejects out-of-range page and pageSize instead of clamping", async () => {
    for (const qs of ["page=0", "page=-1", "page=1.5", "page=abc", "pageSize=0", "pageSize=101", "pageSize=ten"]) {
      const res = await request(app).get(`/api/v1/admin/tickets?${qs}`).set("Authorization", `Bearer ${admin}`);
      expect(res.status, qs).toBe(400);
      expect(res.body.error.code, qs).toBe("VALIDATION_ERROR");
      expect(res.body.error.details[0].field, qs).toBe(qs.split("=")[0]);
    }
    const ok = await request(app).get("/api/v1/admin/tickets?page=2&pageSize=100").set("Authorization", `Bearer ${admin}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ page: 2, pageSize: 100 });
  });

  it("caps messages, replies and notes at 5000 characters", async () => {
    const tooLong = { body: "x".repeat(5001) };
    const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
    for (const [path, token] of [
      ["/api/v1/tickets/any/messages", priya],
      ["/api/v1/admin/tickets/any/reply", admin],
      ["/api/v1/admin/tickets/any/notes", admin],
    ] as const) {
      const res = await request(app).post(path).set(auth(token)).send(tooLong);
      expect(res.status, path).toBe(400);
      expect(res.body.error.details, path).toEqual([{ field: "body", message: "Message must be at most 5000 characters" }]);
    }
    const desc = await request(app)
      .post("/api/v1/tickets")
      .set(auth(priya))
      .send({ bookId: null, subject: "s".repeat(121), description: "d".repeat(5001) });
    expect(desc.body.error.details.map((x: { field: string }) => x.field).sort()).toEqual(["description", "subject"]);
  });

  it("rejects unknown and empty PATCH bodies", async () => {
    const empty = await request(app).patch("/api/v1/admin/tickets/x").set("Authorization", `Bearer ${admin}`).send({});
    expect(empty.status).toBe(400);
    const unknown = await request(app)
      .patch("/api/v1/admin/tickets/x")
      .set("Authorization", `Bearer ${admin}`)
      .send({ priority: "URGENT", hacked: true });
    expect(unknown.status).toBe(400);
  });

  it("returns 404 in the standard envelope for unknown routes and ids", async () => {
    const route = await request(app).get("/api/v1/nope").set("Authorization", `Bearer ${admin}`);
    expect(route.status).toBe(404);
    expect(route.body.error.code).toBe("NOT_FOUND");
    const ticket = await request(app).get("/api/v1/admin/tickets/does-not-exist").set("Authorization", `Bearer ${admin}`);
    expect(ticket.status).toBe(404);
  });
});
