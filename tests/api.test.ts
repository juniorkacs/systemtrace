import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.ts";
import { Store } from "../src/server/store.ts";
import { seedModel } from "../src/server/seed.ts";

let store: Store;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  store = new Store(":memory:");
  store.importModel(seedModel, "replace", "reset");
  app = createApp(store, { rateLimit: false });
});

describe("requirements API", () => {
  it("lists requirements with computed trace state", async () => {
    const res = await request(app).get("/api/requirements").expect(200);
    expect(res.body).toHaveLength(26);
    const pay2 = res.body.find((r: { id: string }) => r.id === "PAY-002");
    expect(pay2.verificationState).toBe("failing");
    expect(pay2.componentIds).toEqual(["CMP-CAM", "CMP-GNSS"]);
  });

  it("filters by search text and priority", async () => {
    const res = await request(app).get("/api/requirements").query({ search: "geofence", priority: "high" }).expect(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["NAV-002", "SYS-002"]);
  });

  it("treats LIKE wildcards in search as literal text", async () => {
    const res = await request(app).get("/api/requirements").query({ search: "%" }).expect(200);
    // Only rows containing a literal "%" match: SAF-001 ("20%") and PAY-002 ("(95%)").
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["PAY-002", "SAF-001"]);
  });

  it("rejects an invalid filter value", async () => {
    const res = await request(app).get("/api/requirements").query({ priority: "urgent" }).expect(400);
    expect(res.body.error).toBe("Validation failed.");
  });

  it("creates, updates and deletes a requirement, recording audit history", async () => {
    await request(app)
      .post("/api/requirements")
      .send({ id: "SEC-004", title: "Log every command received", parentId: "SYS-004", type: "security" })
      .expect(201);
    const patched = await request(app).patch("/api/requirements/SEC-004").send({ priority: "high" }).expect(200);
    expect(patched.body.priority).toBe("high");
    await request(app).delete("/api/requirements/SEC-004").expect(204);
    await request(app).get("/api/requirements/SEC-004").expect(404);

    const audit = await request(app).get("/api/audit").query({ limit: 3 }).expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual(["delete", "update", "create"]);
  });

  it("returns field-level validation errors", async () => {
    const res = await request(app).post("/api/requirements").send({ id: "lowercase", title: "x" }).expect(400);
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(["id", "title"]);
  });

  it("rejects duplicate IDs and missing parents", async () => {
    await request(app).post("/api/requirements").send({ id: "SYS-001", title: "Duplicate one" }).expect(409);
    await request(app).post("/api/requirements").send({ id: "NEW-001", title: "Orphan child", parentId: "NOPE-1" }).expect(400);
  });

  it("refuses a parent change that would create a loop", async () => {
    const res = await request(app).patch("/api/requirements/SYS-001").send({ parentId: "FLT-001" }).expect(400);
    expect(res.body.error).toMatch(/loop/);
  });

  it("refuses to delete a requirement that has children", async () => {
    const res = await request(app).delete("/api/requirements/SYS-001").expect(409);
    expect(res.body.details.children).toContain("FLT-001");
  });

  it("marks links suspect when requirement text changes, and clears them on review", async () => {
    await request(app).patch("/api/requirements/NAV-001").send({ title: "Estimate position to within 1.5 m" }).expect(200);
    const detail = await request(app).get("/api/requirements/NAV-001").expect(200);
    expect(detail.body.links.every((l: { suspect: boolean }) => l.suspect)).toBe(true);

    await request(app)
      .post("/api/links/review")
      .send({ requirementId: "NAV-001", targetType: "test", targetId: "TST-NAV-01" })
      .expect(200);
    const after = await request(app).get("/api/requirements/NAV-001");
    const testLink = after.body.links.find((l: { targetId: string }) => l.targetId === "TST-NAV-01");
    expect(testLink.suspect).toBe(false);
  });

  it("does not mark links suspect for a status-only change", async () => {
    await request(app).patch("/api/requirements/NAV-001").send({ status: "implemented" }).expect(200);
    const detail = await request(app).get("/api/requirements/NAV-001");
    expect(detail.body.links.some((l: { suspect: boolean }) => l.suspect)).toBe(false);
  });
});

describe("links API", () => {
  it("links a requirement to a test and updates coverage", async () => {
    const before = await request(app).get("/api/trace/metrics");
    await request(app)
      .post("/api/links")
      .send({ requirementId: "SAF-002", targetType: "test", targetId: "TST-ENV-01" })
      .expect(201);
    const after = await request(app).get("/api/trace/metrics");
    expect(after.body.withTests).toBe(before.body.withTests + 1);
  });

  it("rejects links to unknown targets and duplicate links", async () => {
    await request(app).post("/api/links").send({ requirementId: "SAF-002", targetType: "test", targetId: "TST-NOPE-1" }).expect(404);
    await request(app).post("/api/links").send({ requirementId: "NAV-001", targetType: "test", targetId: "TST-NAV-01" }).expect(409);
  });

  it("deleting a test removes its links", async () => {
    await request(app).delete("/api/tests/TST-NAV-01").expect(204);
    const detail = await request(app).get("/api/requirements/NAV-001");
    expect(detail.body.links.some((l: { targetId: string }) => l.targetId === "TST-NAV-01")).toBe(false);
  });
});

describe("analysis API", () => {
  it("returns gaps including the seeded problems", async () => {
    const res = await request(app).get("/api/trace/gaps").expect(200);
    const keys = res.body.map((g: { kind: string; id: string }) => `${g.kind}:${g.id}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        "unverified:SAF-002",
        "unallocated:SEC-003",
        "failing:PAY-002",
        "status-inconsistent:PAY-002",
        "method-mismatch:SEC-001",
        "orphan-requirement:CON-002",
        "orphan-component:CMP-LIGHT",
        "orphan-test:TST-ENV-01",
        "suspect-link:SAF-001->TST-SAF-01",
      ]),
    );
  });

  it("returns the traceability matrix for either axis", async () => {
    const res = await request(app).get("/api/trace/matrix").query({ axis: "test" }).expect(200);
    expect(res.body.columns).toHaveLength(18);
    await request(app).get("/api/trace/matrix").query({ axis: "people" }).expect(400);
  });

  it("returns impact analysis", async () => {
    const res = await request(app).get("/api/trace/impact/SYS-002").expect(200);
    expect(res.body.descendants).toHaveLength(6);
    expect(res.body.components.map((c: { id: string }) => c.id)).toContain("CMP-PROP");
  });
});

describe("import and export", () => {
  it("exports JSON that can be re-imported to an identical model", async () => {
    const exported = await request(app).get("/api/export").query({ format: "json" }).expect(200);
    const fresh = new Store(":memory:");
    const app2 = createApp(fresh, { rateLimit: false });
    await request(app2).post("/api/import").query({ mode: "replace" }).send(exported.body).expect(200);
    const strip = (m: ReturnType<Store["getModel"]>) => ({
      ...m,
      requirements: m.requirements.map(({ createdAt: _c, updatedAt: _u, ...r }) => (void _c, void _u, r)),
    });
    expect(strip(fresh.getModel())).toEqual(strip(store.getModel()));
  });

  it("merges a CSV of requirements", async () => {
    const csv = "id,title,parentId,priority,components\nDAT-003,Compress imagery before upload,SYS-005,low,CMP-DATA\n";
    await request(app).post("/api/import").set("Content-Type", "text/csv").send(csv).expect(200);
    const res = await request(app).get("/api/requirements/DAT-003").expect(200);
    expect(res.body.allocated).toBe(true);
  });

  it("rejects a CSV with errors and imports nothing", async () => {
    const csv = "id,title\nOK-001,A valid row\nbad,x\n";
    const res = await request(app).post("/api/import").set("Content-Type", "text/csv").send(csv).expect(400);
    expect(res.body.details[0].row).toBe(3);
    await request(app).get("/api/requirements/OK-001").expect(404);
  });

  it("rolls back a JSON import that references a missing component", async () => {
    const before = store.getModel();
    await request(app)
      .post("/api/import")
      .send({
        requirements: [{ id: "NEW-001", title: "New requirement" }],
        links: [{ requirementId: "NEW-001", targetType: "component", targetId: "CMP-NOPE" }],
      })
      .expect(400);
    expect(store.getModel()).toEqual(before);
  });

  it("returns 400 for malformed JSON", async () => {
    await request(app).post("/api/import").set("Content-Type", "application/json").send("{oops").expect(400);
  });
});

describe("security headers", () => {
  it("sets a content security policy and hides the framework", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
