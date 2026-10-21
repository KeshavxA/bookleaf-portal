import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { DEMO_TICKETS, seedDemoTickets } from "../../src/seed/demoTickets";
import { assertMayClear, clearTickets } from "../../src/seed/clearTickets";
import { ADMIN, buildTestApp, failingSdk, llmWithFakeSdk, login, prisma, resetTickets } from "../helpers";

const DAY = 86_400_000;

describe("demo ticket seed", () => {
  beforeEach(resetTickets);
  afterAll(resetTickets);

  it("creates pre-classified tickets without any LLM call, and is idempotent", async () => {
    const first = await seedDemoTickets(prisma);
    expect(first).toEqual({ created: DEMO_TICKETS.length, skipped: 0 });
    const second = await seedDemoTickets(prisma);
    expect(second).toEqual({ created: 0, skipped: DEMO_TICKETS.length });

    expect(await prisma.ticket.count()).toBe(DEMO_TICKETS.length);
    expect(await prisma.ticket.count({ where: { aiStatus: { not: "DONE" } } })).toBe(0);
    expect(await prisma.aiCall.count()).toBe(0);
  });

  it("mixes statuses, assignment, replies and notes, and back-dates open tickets", async () => {
    await seedDemoTickets(prisma);
    const tickets = await prisma.ticket.findMany({ include: { messages: true, internalNotes: true, assignee: true } });
    const by = (bookId: string | null) => tickets.find((t) => t.bookId === bookId)!;

    expect(by("BK005")).toMatchObject({ status: "OPEN", priority: "CRITICAL", category: "ROYALTY_PAYMENTS" });
    expect(by("BK010")).toMatchObject({ status: "IN_PROGRESS", isOpen: true });
    expect(by("BK010").assignee?.email).toBe("admin1@bookleaf.com");
    expect(by("BK016")).toMatchObject({ status: "RESOLVED", isOpen: false });
    expect(by("BK016").messages.some((m) => m.senderType === "ADMIN")).toBe(true);
    expect(by("BK001").internalNotes).toHaveLength(1);
    expect(by(null)).toMatchObject({ category: "GENERAL_INQUIRY" });
    expect(by("BK003")).toMatchObject({ category: "ISBN_METADATA", priority: "HIGH" });

    const openOver3Days = tickets.filter((t) => t.isOpen && Date.now() - t.createdAt.getTime() > 3 * DAY);
    expect(openOver3Days.length).toBeGreaterThanOrEqual(2);
  });

  it("shows up in the admin queue in urgency order", async () => {
    await seedDemoTickets(prisma);
    const { app } = buildTestApp(llmWithFakeSdk(failingSdk));
    const admin = await login(app, ADMIN);
    const res = await request(app).get("/api/v1/admin/tickets").set("Authorization", `Bearer ${admin}`);
    expect(res.body.total).toBe(DEMO_TICKETS.length);
    const priorities = res.body.items.map((t: { priority: string }) => t.priority);
    expect(priorities[0]).toBe("CRITICAL");
    expect(res.body.items.at(-1).status).toBe("RESOLVED"); // closed-out tickets sink to the bottom
  });
});

describe("db:clear-tickets", () => {
  it("deletes tickets, messages, notes and AI call logs, and nothing else", async () => {
    await seedDemoTickets(prisma);
    await prisma.aiCall.create({ data: { kind: "CLASSIFY", model: "m", status: "SUCCESS", latencyMs: 1 } });
    const users = await prisma.user.count();
    const books = await prisma.book.count();

    const n = await clearTickets(prisma);
    expect(n).toMatchObject({ tickets: DEMO_TICKETS.length, aiCalls: 1 });
    expect(n.messages).toBeGreaterThan(0);
    expect(n.notes).toBeGreaterThan(0);
    expect(await prisma.ticket.count()).toBe(0);
    expect(await prisma.ticketMessage.count()).toBe(0);
    expect(await prisma.internalNote.count()).toBe(0);
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.book.count()).toBe(books);
  });

  it("refuses in production unless --force is passed", () => {
    expect(() => assertMayClear("production", [])).toThrow(/--force/);
    expect(() => assertMayClear("production", ["--force"])).not.toThrow();
    expect(() => assertMayClear("development", [])).not.toThrow();
  });
});
