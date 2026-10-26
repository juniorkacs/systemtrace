import type { Model, Requirement } from "../src/shared/schema.ts";

let clock = 0;
export function req(id: string, o: Partial<Requirement> = {}): Requirement {
  clock++;
  return {
    id,
    title: `Requirement ${id}`,
    description: "",
    type: "functional",
    priority: "medium",
    status: "approved",
    verificationMethod: "test",
    parentId: null,
    rationale: "",
    createdAt: `2026-01-01T00:00:${String(clock % 60).padStart(2, "0")}Z`,
    updatedAt: `2026-01-01T00:00:${String(clock % 60).padStart(2, "0")}Z`,
    ...o,
  };
}

export function model(m: Partial<Model>): Model {
  return { requirements: [], components: [], tests: [], links: [], ...m };
}

export const comp = (id: string, parentId: string | null = null) => ({
  id,
  name: `Component ${id}`,
  kind: "component" as const,
  description: "",
  parentId,
});

export const test = (id: string, status: "planned" | "passed" | "failed" | "blocked" = "passed", method: "test" | "analysis" | "inspection" | "demonstration" = "test") => ({
  id,
  name: `Test ${id}`,
  method,
  status,
  description: "",
  lastRun: null,
});

export const alloc = (requirementId: string, targetId: string, suspect = false) => ({
  requirementId,
  targetType: "component" as const,
  targetId,
  suspect,
});
export const verify = (requirementId: string, targetId: string, suspect = false) => ({
  requirementId,
  targetType: "test" as const,
  targetId,
  suspect,
});
