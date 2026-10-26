import { describe, expect, it } from "vitest";
import {
  TraceIndex,
  buildMatrix,
  computeMetrics,
  findGaps,
  impactOf,
  isAllocated,
  verificationState,
  wouldCreateCycle,
} from "../src/shared/trace.ts";
import { alloc, comp, model, req, test, verify } from "./helpers.ts";
import { seedModel } from "../src/server/seed.ts";

describe("verificationState", () => {
  it("is unverified when a requirement has no tests and no children", () => {
    const m = model({ requirements: [req("A-1")] });
    expect(verificationState(new TraceIndex(m), "A-1")).toBe("unverified");
  });

  it("is passed only when every linked test passed", () => {
    const m = model({
      requirements: [req("A-1")],
      tests: [test("T-1", "passed"), test("T-2", "planned")],
      links: [verify("A-1", "T-1"), verify("A-1", "T-2")],
    });
    expect(verificationState(new TraceIndex(m), "A-1")).toBe("planned");
  });

  it("takes the worst state: failing beats blocked beats planned", () => {
    const m = model({
      requirements: [req("A-1")],
      tests: [test("T-1", "blocked"), test("T-2", "failed"), test("T-3", "passed")],
      links: [verify("A-1", "T-1"), verify("A-1", "T-2"), verify("A-1", "T-3")],
    });
    expect(verificationState(new TraceIndex(m), "A-1")).toBe("failing");
  });

  it("rolls child states up to the parent", () => {
    const m = model({
      requirements: [req("P-1"), req("C-1", { parentId: "P-1" }), req("C-2", { parentId: "P-1" })],
      tests: [test("T-1", "passed")],
      links: [verify("C-1", "T-1")],
    });
    // C-2 has no tests, so the parent is not fully verified.
    expect(verificationState(new TraceIndex(m), "P-1")).toBe("unverified");
  });

  it("ignores deferred children when rolling up", () => {
    const m = model({
      requirements: [req("P-1"), req("C-1", { parentId: "P-1" }), req("C-2", { parentId: "P-1", status: "deferred" })],
      tests: [test("T-1", "passed")],
      links: [verify("C-1", "T-1")],
    });
    expect(verificationState(new TraceIndex(m), "P-1")).toBe("passed");
  });
});

describe("isAllocated", () => {
  it("is true for a parent only when all active children are allocated", () => {
    const base = {
      requirements: [req("P-1"), req("C-1", { parentId: "P-1" }), req("C-2", { parentId: "P-1" })],
      components: [comp("X-1")],
    };
    const partial = model({ ...base, links: [alloc("C-1", "X-1")] });
    const full = model({ ...base, links: [alloc("C-1", "X-1"), alloc("C-2", "X-1")] });
    expect(isAllocated(new TraceIndex(partial), "P-1")).toBe(false);
    expect(isAllocated(new TraceIndex(full), "P-1")).toBe(true);
  });

  it("ignores links that point at missing components", () => {
    const m = model({ requirements: [req("A-1")], links: [alloc("A-1", "GONE-1")] });
    expect(isAllocated(new TraceIndex(m), "A-1")).toBe(false);
  });
});

describe("computeMetrics", () => {
  it("counts leaves only, so parents are not double-counted", () => {
    const m = model({
      requirements: [req("P-1"), req("C-1", { parentId: "P-1" }), req("C-2", { parentId: "P-1" })],
      components: [comp("X-1")],
      tests: [test("T-1", "passed")],
      links: [alloc("C-1", "X-1"), verify("C-1", "T-1")],
    });
    const metrics = computeMetrics(m);
    expect(metrics.leafRequirements).toBe(2);
    expect(metrics.allocationCoverage).toBe(50);
    expect(metrics.verificationPlannedCoverage).toBe(50);
    expect(metrics.verificationPassedCoverage).toBe(50);
  });

  it("returns zero coverage, not NaN, for an empty model", () => {
    const metrics = computeMetrics(model({}));
    expect(metrics.allocationCoverage).toBe(0);
    expect(metrics.leafRequirements).toBe(0);
  });

  it("excludes deferred requirements from coverage", () => {
    const m = model({ requirements: [req("A-1", { status: "deferred" }), req("A-2")] });
    const metrics = computeMetrics(m);
    expect(metrics.deferredRequirements).toBe(1);
    expect(metrics.leafRequirements).toBe(1);
  });

  it("produces the documented numbers for the demo model", () => {
    const m = model({
      requirements: seedModel.requirements.map((r) => req(r.id, r)),
      components: seedModel.components,
      tests: seedModel.tests,
      links: seedModel.links,
    });
    const metrics = computeMetrics(m);
    expect(metrics.totalRequirements).toBe(26);
    expect(metrics.deferredRequirements).toBe(1);
    expect(metrics.leafRequirements).toBe(20);
    expect(metrics.allocated).toBe(17);
    expect(metrics.withTests).toBe(17);
    expect(metrics.failing).toBe(1);
    expect(metrics.suspectLinks).toBe(1);
  });
});

describe("findGaps", () => {
  const kinds = (m: ReturnType<typeof model>) => findGaps(m).map((g) => `${g.kind}:${g.id}`);

  it("reports an orphan requirement once rather than as unallocated and unverified", () => {
    expect(kinds(model({ requirements: [req("A-1")] }))).toEqual(["orphan-requirement:A-1"]);
  });

  it("finds unallocated and unverified leaves", () => {
    const m = model({ requirements: [req("P-1"), req("C-1", { parentId: "P-1" })] });
    expect(kinds(m)).toEqual(expect.arrayContaining(["unallocated:C-1", "unverified:C-1"]));
    expect(kinds(m)).not.toContain("unallocated:P-1");
  });

  it("finds orphan components and tests", () => {
    const m = model({
      requirements: [req("A-1")],
      components: [comp("X-1"), comp("X-2")],
      tests: [test("T-1"), test("T-2")],
      links: [alloc("A-1", "X-1"), verify("A-1", "T-1")],
    });
    expect(kinds(m)).toEqual(expect.arrayContaining(["orphan-component:X-2", "orphan-test:T-2"]));
    expect(kinds(m)).not.toContain("orphan-component:X-1");
  });

  it("does not call a parent component an orphan when its child is linked", () => {
    const m = model({
      requirements: [req("A-1")],
      components: [comp("SYS-1"), comp("X-1", "SYS-1")],
      links: [alloc("A-1", "X-1")],
    });
    expect(kinds(m)).not.toContain("orphan-component:SYS-1");
  });

  it("flags a method mismatch and a verified status that the tests do not support", () => {
    const m = model({
      requirements: [req("A-1", { verificationMethod: "test", status: "verified" })],
      components: [comp("X-1")],
      tests: [test("T-1", "planned", "inspection")],
      links: [alloc("A-1", "X-1"), verify("A-1", "T-1")],
    });
    expect(kinds(m)).toEqual(expect.arrayContaining(["method-mismatch:A-1", "status-inconsistent:A-1"]));
  });

  it("lists high-priority gaps first", () => {
    const m = model({ requirements: [req("L-1", { priority: "low" }), req("H-1", { priority: "high" })] });
    expect(findGaps(m)[0].id).toBe("H-1");
  });

  it("reports suspect links", () => {
    const m = model({
      requirements: [req("A-1")],
      tests: [test("T-1")],
      links: [verify("A-1", "T-1", true)],
    });
    expect(kinds(m)).toContain("suspect-link:A-1->T-1");
  });
});

describe("impactOf", () => {
  const m = model({
    requirements: [
      req("S-1"),
      req("A-1", { parentId: "S-1" }),
      req("A-2", { parentId: "A-1" }),
      req("B-1", { parentId: "S-1" }),
    ],
    components: [comp("X-1"), comp("X-2")],
    tests: [test("T-1")],
    links: [alloc("A-2", "X-1"), alloc("B-1", "X-1"), alloc("A-1", "X-2"), verify("A-2", "T-1")],
  });

  it("includes ancestors, descendants and their components and tests", () => {
    const impact = impactOf(m, "A-1")!;
    expect(impact.ancestors.map((r) => r.id)).toEqual(["S-1"]);
    expect(impact.descendants.map((r) => r.id)).toEqual(["A-2"]);
    expect(impact.components.map((c) => c.id).sort()).toEqual(["X-1", "X-2"]);
    expect(impact.tests.map((t) => t.id)).toEqual(["T-1"]);
  });

  it("lists requirements that share an affected component", () => {
    expect(impactOf(m, "A-1")!.related.map((r) => r.id)).toEqual(["B-1"]);
  });

  it("returns null for an unknown requirement", () => {
    expect(impactOf(m, "NOPE-1")).toBeNull();
  });
});

describe("wouldCreateCycle", () => {
  const rs = [
    { id: "A-1", parentId: null },
    { id: "B-1", parentId: "A-1" },
    { id: "C-1", parentId: "B-1" },
  ];
  it("rejects self-parenting and descendants as parents", () => {
    expect(wouldCreateCycle(rs, "A-1", "A-1")).toBe(true);
    expect(wouldCreateCycle(rs, "A-1", "C-1")).toBe(true);
  });
  it("allows valid re-parenting", () => {
    expect(wouldCreateCycle(rs, "C-1", "A-1")).toBe(false);
    expect(wouldCreateCycle(rs, "C-1", null)).toBe(false);
  });
});

describe("buildMatrix", () => {
  it("marks linked and suspect cells", () => {
    const m = model({
      requirements: [req("A-1"), req("A-2")],
      tests: [test("T-1"), test("T-2")],
      links: [verify("A-1", "T-1"), verify("A-2", "T-2", true)],
    });
    const matrix = buildMatrix(m, "test");
    expect(matrix.columns.map((c) => c.id)).toEqual(["T-1", "T-2"]);
    expect(matrix.cells).toEqual([
      ["linked", "none"],
      ["none", "suspect"],
    ]);
  });
});
