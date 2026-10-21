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
