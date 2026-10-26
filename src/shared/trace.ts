/**
 * Traceability analysis. Pure functions over a Model, so the same rules are
 * used by the API, the UI and the unit tests. Nothing here is stored: every
 * metric is recomputed from the current links.
 *
 * Rules (also documented in docs/traceability-rules.md):
 *  - A requirement is *active* unless its status is "deferred".
 *  - A *leaf* is an active requirement with no active children. Coverage
 *    percentages count leaves only, so a parent and its children are not
 *    double-counted.
 *  - A leaf is *allocated* when at least one component satisfies it.
 *  - A requirement's verification state is the worst state among its own
 *    tests and its active children: failing > blocked > unverified > planned > passed.
 */
import type { Component, Link, Model, Requirement, VerificationTest } from "./schema.ts";

export type VerificationState = "passed" | "planned" | "unverified" | "blocked" | "failing";

const SEVERITY: Record<VerificationState, number> = {
  passed: 0,
  planned: 1,
  unverified: 2,
  blocked: 3,
  failing: 4,
};

function worst(states: VerificationState[]): VerificationState {
  return states.reduce<VerificationState>((acc, s) => (SEVERITY[s] > SEVERITY[acc] ? s : acc), "passed");
}

export function isActive(r: Requirement): boolean {
  return r.status !== "deferred";
}

/** Precomputed lookups used by every analysis function. */
export class TraceIndex {
  readonly reqById = new Map<string, Requirement>();
  readonly compById = new Map<string, Component>();
  readonly testById = new Map<string, VerificationTest>();
  readonly children = new Map<string, Requirement[]>();
  readonly componentsOf = new Map<string, Link[]>();
  readonly testsOf = new Map<string, Link[]>();
  readonly reqsOfComponent = new Map<string, string[]>();
  readonly reqsOfTest = new Map<string, string[]>();

  constructor(readonly model: Model) {
    for (const r of model.requirements) this.reqById.set(r.id, r);
    for (const c of model.components) this.compById.set(c.id, c);
    for (const t of model.tests) this.testById.set(t.id, t);
    for (const r of model.requirements) {
      if (r.parentId && this.reqById.has(r.parentId)) push(this.children, r.parentId, r);
    }
    for (const l of model.links) {
      if (!this.reqById.has(l.requirementId)) continue;
      if (l.targetType === "component" && this.compById.has(l.targetId)) {
        push(this.componentsOf, l.requirementId, l);
        push(this.reqsOfComponent, l.targetId, l.requirementId);
      } else if (l.targetType === "test" && this.testById.has(l.targetId)) {
        push(this.testsOf, l.requirementId, l);
        push(this.reqsOfTest, l.targetId, l.requirementId);
      }
    }
  }

  activeChildren(id: string): Requirement[] {
    return (this.children.get(id) ?? []).filter(isActive);
  }

  isLeaf(r: Requirement): boolean {
    return isActive(r) && this.activeChildren(r.id).length === 0;
  }

  tests(id: string): VerificationTest[] {
    return (this.testsOf.get(id) ?? []).map((l) => this.testById.get(l.targetId)!);
  }

  components(id: string): Component[] {
    return (this.componentsOf.get(id) ?? []).map((l) => this.compById.get(l.targetId)!);
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Verification state of a single requirement, rolled up from its children. */
export function verificationState(idx: TraceIndex, id: string, seen = new Set<string>()): VerificationState {
  if (seen.has(id)) return "unverified"; // defensive: cycles are rejected on write
  seen.add(id);
  const own = idx.tests(id);
  const children = idx.activeChildren(id);
  const states: VerificationState[] = [];

  if (own.length > 0) {
    states.push(
      worst(
        own.map((t) =>
          t.status === "failed" ? "failing" : t.status === "blocked" ? "blocked" : t.status === "planned" ? "planned" : "passed",
        ),
      ),
    );
  }
  for (const c of children) states.push(verificationState(idx, c.id, seen));
  if (states.length === 0) return "unverified";
  return worst(states);
}

/** True when the requirement, or all of its active children, are allocated to a component. */
export function isAllocated(idx: TraceIndex, id: string, seen = new Set<string>()): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  if ((idx.componentsOf.get(id) ?? []).length > 0) return true;
  const children = idx.activeChildren(id);
  return children.length > 0 && children.every((c) => isAllocated(idx, c.id, seen));
}

export type Metrics = {
  totalRequirements: number;
  activeRequirements: number;
  deferredRequirements: number;
  leafRequirements: number;
  allocated: number;
  withTests: number;
  passed: number;
  failing: number;
  blocked: number;
  /** Percentages of leaf requirements, 0–100, rounded to one decimal. */
  allocationCoverage: number;
  verificationPlannedCoverage: number;
  verificationPassedCoverage: number;
  suspectLinks: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byType: Record<string, number>;
  byVerificationState: Record<VerificationState, number>;
  components: number;
  tests: number;
  testsByStatus: Record<string, number>;
};

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
}

export function computeMetrics(model: Model): Metrics {
  const idx = new TraceIndex(model);
  const leaves = model.requirements.filter((r) => idx.isLeaf(r));
  const leafStates = leaves.map((r) => verificationState(idx, r.id));
  const byVerificationState: Record<VerificationState, number> = {
    passed: 0,
    planned: 0,
    unverified: 0,
    blocked: 0,
    failing: 0,
  };
  for (const s of leafStates) byVerificationState[s]++;

  const allocated = leaves.filter((r) => isAllocated(idx, r.id)).length;
  const withTests = leaves.filter((r) => idx.tests(r.id).length > 0).length;

  return {
    totalRequirements: model.requirements.length,
    activeRequirements: model.requirements.filter(isActive).length,
    deferredRequirements: model.requirements.filter((r) => !isActive(r)).length,
    leafRequirements: leaves.length,
    allocated,
    withTests,
    passed: byVerificationState.passed,
    failing: byVerificationState.failing,
    blocked: byVerificationState.blocked,
    allocationCoverage: pct(allocated, leaves.length),
    verificationPlannedCoverage: pct(withTests, leaves.length),
    verificationPassedCoverage: pct(byVerificationState.passed, leaves.length),
    suspectLinks: model.links.filter((l) => l.suspect).length,
    byStatus: countBy(model.requirements, (r) => r.status),
    byPriority: countBy(model.requirements.filter(isActive), (r) => r.priority),
    byType: countBy(model.requirements.filter(isActive), (r) => r.type),
    byVerificationState,
    components: model.components.length,
    tests: model.tests.length,
    testsByStatus: countBy(model.tests, (t) => t.status),
  };
}

export type GapKind =
  | "unallocated"
  | "unverified"
  | "failing"
  | "method-mismatch"
  | "status-inconsistent"
  | "orphan-requirement"
  | "orphan-component"
  | "orphan-test"
  | "suspect-link";

export type Gap = {
  kind: GapKind;
  entity: "requirement" | "component" | "test" | "link";
  id: string;
  message: string;
  priority?: Requirement["priority"];
};

/** Every traceability problem in the model, high-priority requirements first. */
export function findGaps(model: Model): Gap[] {
  const idx = new TraceIndex(model);
  const gaps: Gap[] = [];

  for (const r of model.requirements) {
    if (!isActive(r)) continue;
    const leaf = idx.isLeaf(r);
    const tests = idx.tests(r.id);
    const state = verificationState(idx, r.id);
    const hasParent = !!r.parentId && idx.reqById.has(r.parentId);
    const hasLinks = (idx.componentsOf.get(r.id)?.length ?? 0) + tests.length > 0;

    if (!hasParent && idx.activeChildren(r.id).length === 0 && !hasLinks) {
      gaps.push({
        kind: "orphan-requirement",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} traces to nothing: no parent, children, components or tests.`,
      });
      continue; // an orphan is also unallocated and unverified; report it once
    }
    if (leaf && !isAllocated(idx, r.id)) {
      gaps.push({
        kind: "unallocated",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} is not allocated to any component.`,
      });
    }
    if (leaf && tests.length === 0) {
      gaps.push({
        kind: "unverified",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} has no verification test.`,
      });
    }
    if (tests.some((t) => t.status === "failed")) {
      gaps.push({
        kind: "failing",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} has a failing test: ${tests
          .filter((t) => t.status === "failed")
          .map((t) => t.id)
          .join(", ")}.`,
      });
    }
    if (tests.length > 0 && !tests.some((t) => t.method === r.verificationMethod)) {
      gaps.push({
        kind: "method-mismatch",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} plans verification by ${r.verificationMethod}, but none of its tests use that method.`,
      });
    }
    if (r.status === "verified" && state !== "passed") {
      gaps.push({
        kind: "status-inconsistent",
        entity: "requirement",
        id: r.id,
        priority: r.priority,
        message: `${r.id} is marked verified, but its verification state is ${state}.`,
      });
    }
  }

  for (const c of model.components) {
    if ((idx.reqsOfComponent.get(c.id) ?? []).length > 0) continue;
    const childLinked = model.components.some(
      (x) => x.parentId === c.id && (idx.reqsOfComponent.get(x.id) ?? []).length > 0,
    );
    if (!childLinked) {
      gaps.push({
        kind: "orphan-component",
        entity: "component",
        id: c.id,
        message: `${c.id} (${c.name}) satisfies no requirement.`,
      });
    }
  }

  for (const t of model.tests) {
    if ((idx.reqsOfTest.get(t.id) ?? []).length === 0) {
      gaps.push({ kind: "orphan-test", entity: "test", id: t.id, message: `${t.id} verifies no requirement.` });
    }
  }

  for (const l of model.links) {
    if (l.suspect) {
      gaps.push({
        kind: "suspect-link",
        entity: "link",
        id: `${l.requirementId}->${l.targetId}`,
        priority: idx.reqById.get(l.requirementId)?.priority,
        message: `${l.requirementId} changed after its link to ${l.targetId} was reviewed.`,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2, undefined: 3 } as const;
  return gaps.sort((a, b) => rank[`${a.priority}` as keyof typeof rank] - rank[`${b.priority}` as keyof typeof rank]);
}

export type Impact = {
  requirement: Requirement;
  ancestors: Requirement[];
  descendants: Requirement[];
  components: Component[];
  tests: VerificationTest[];
  /** Other requirements that share an affected component and may need re-review. */
  related: Requirement[];
};

/** Everything that may need review if the given requirement changes. */
export function impactOf(model: Model, id: string): Impact | null {
  const idx = new TraceIndex(model);
  const requirement = idx.reqById.get(id);
  if (!requirement) return null;

  const ancestors: Requirement[] = [];
  const guard = new Set<string>([id]);
  let p = requirement.parentId ? idx.reqById.get(requirement.parentId) : undefined;
  while (p && !guard.has(p.id)) {
    ancestors.push(p);
    guard.add(p.id);
    p = p.parentId ? idx.reqById.get(p.parentId) : undefined;
  }

  const descendants: Requirement[] = [];
  const stack = [...(idx.children.get(id) ?? [])];
  const seen = new Set<string>([id]);
  while (stack.length) {
    const r = stack.pop()!;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    descendants.push(r);
    stack.push(...(idx.children.get(r.id) ?? []));
  }

  descendants.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const scope = [id, ...descendants.map((d) => d.id)];
  const components = uniqueBy(scope.flatMap((r) => idx.components(r)), (c) => c.id);
  const tests = uniqueBy(scope.flatMap((r) => idx.tests(r)), (t) => t.id);
  const scopeSet = new Set(scope);
  const related = uniqueBy(
    components.flatMap((c) => idx.reqsOfComponent.get(c.id) ?? []).filter((rid) => !scopeSet.has(rid)),
    (x) => x,
  ).map((rid) => idx.reqById.get(rid)!);

  return { requirement, ancestors, descendants, components, tests, related };
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
}

/** True if making `parentId` the parent of `id` would create a loop in the hierarchy. */
export function wouldCreateCycle(
  requirements: Pick<Requirement, "id" | "parentId">[],
  id: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  const parentOf = new Map(requirements.map((r) => [r.id, r.parentId]));
  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor);
  }
  return false;
}

export type MatrixCell = "none" | "linked" | "suspect";
export type Matrix = {
  axis: "component" | "test";
  rows: { id: string; title: string; state: VerificationState; allocated: boolean }[];
  columns: { id: string; name: string }[];
  cells: MatrixCell[][];
};

export function buildMatrix(model: Model, axis: "component" | "test"): Matrix {
  const idx = new TraceIndex(model);
  const rows = [...model.requirements]
    .filter(isActive)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((r) => ({ id: r.id, title: r.title, state: verificationState(idx, r.id), allocated: isAllocated(idx, r.id) }));
  const source = axis === "component" ? model.components : model.tests;
  const columns = [...source]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((c) => ({ id: c.id, name: c.name }));
  const linkMap = new Map<string, MatrixCell>();
  for (const l of model.links) {
    if (l.targetType === axis) linkMap.set(`${l.requirementId}|${l.targetId}`, l.suspect ? "suspect" : "linked");
  }
  const cells = rows.map((r) => columns.map((c) => linkMap.get(`${r.id}|${c.id}`) ?? "none"));
  return { axis, rows, columns, cells };
}
