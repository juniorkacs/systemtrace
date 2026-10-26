/**
 * Domain model and validation rules, shared by the API and the web client.
 * Every write to the API is validated against these schemas.
 */
import { z } from "zod";

export const REQUIREMENT_TYPES = ["functional", "performance", "interface", "safety", "security", "constraint"] as const;
export const PRIORITIES = ["high", "medium", "low"] as const;
export const REQUIREMENT_STATUSES = ["draft", "approved", "implemented", "verified", "deferred"] as const;
export const VERIFICATION_METHODS = ["test", "analysis", "inspection", "demonstration"] as const;
export const COMPONENT_KINDS = ["system", "subsystem", "component", "interface"] as const;
export const TEST_STATUSES = ["planned", "passed", "failed", "blocked"] as const;

/** Human-readable IDs such as SYS-001, NAV-012, CMP-FCS or TST-NAV-03. */
const idPattern = /^[A-Z][A-Z0-9]{1,9}(-[A-Z0-9]{1,10}){1,3}$/;
export const entityId = z
  .string()
  .trim()
  .regex(idPattern, "Use an uppercase ID like SYS-001 or CMP-NAV (letters, digits and hyphens)");

const text = (max: number) => z.string().trim().max(max);

export const requirementInput = z.object({
  id: entityId,
  title: text(160).min(3, "Title needs at least 3 characters"),
  description: text(4000).default(""),
  type: z.enum(REQUIREMENT_TYPES).default("functional"),
  priority: z.enum(PRIORITIES).default("medium"),
  status: z.enum(REQUIREMENT_STATUSES).default("draft"),
  verificationMethod: z.enum(VERIFICATION_METHODS).default("test"),
  parentId: entityId.nullable().default(null),
  rationale: text(2000).default(""),
});
export const requirementPatch = requirementInput.omit({ id: true }).partial();

export const componentInput = z.object({
  id: entityId,
  name: text(120).min(2, "Name needs at least 2 characters"),
  kind: z.enum(COMPONENT_KINDS).default("component"),
  description: text(2000).default(""),
  parentId: entityId.nullable().default(null),
});
export const componentPatch = componentInput.omit({ id: true }).partial();

export const testInput = z.object({
  id: entityId,
  name: text(160).min(3, "Name needs at least 3 characters"),
  method: z.enum(VERIFICATION_METHODS).default("test"),
  status: z.enum(TEST_STATUSES).default("planned"),
  description: text(2000).default(""),
  lastRun: z.iso.date().nullable().default(null),
});
export const testPatch = testInput.omit({ id: true }).partial();

export const linkInput = z.object({
  requirementId: entityId,
  targetType: z.enum(["component", "test"]),
  targetId: entityId,
});

export type RequirementInput = z.infer<typeof requirementInput>;
export type ComponentInput = z.infer<typeof componentInput>;
export type TestInput = z.infer<typeof testInput>;
export type LinkInput = z.infer<typeof linkInput>;

export type Requirement = RequirementInput & { createdAt: string; updatedAt: string };
export type Component = ComponentInput;
export type VerificationTest = TestInput;

/** A trace link. `suspect` is set when the requirement changed after the link was last reviewed. */
export type Link = {
  requirementId: string;
  targetType: "component" | "test";
  targetId: string;
  suspect: boolean;
};

export type Model = {
  requirements: Requirement[];
  components: Component[];
  tests: VerificationTest[];
  links: Link[];
};

/** Shape accepted by JSON import: same as export, timestamps optional. */
export const modelImport = z.object({
  requirements: z.array(requirementInput).max(5000),
  components: z.array(componentInput).max(5000).default([]),
  tests: z.array(testInput).max(5000).default([]),
  links: z
    .array(linkInput.extend({ suspect: z.boolean().default(false) }))
    .max(20000)
    .default([]),
});
export type ModelImport = z.infer<typeof modelImport>;

export type AuditEntry = {
  id: number;
  at: string;
  action: "create" | "update" | "delete" | "link" | "unlink" | "import" | "review" | "reset";
  entity: "requirement" | "component" | "test" | "link" | "model";
  entityId: string;
  summary: string;
};
