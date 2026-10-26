/** Thin typed wrapper around the SystemTrace REST API. */
import type {
  AuditEntry,
  Component,
  ComponentInput,
  Link,
  LinkInput,
  Model,
  Requirement,
  RequirementInput,
  TestInput,
  VerificationTest,
} from "../shared/schema.ts";
import type { Gap, Impact, Matrix, Metrics, VerificationState } from "../shared/trace.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** Human-readable list of field problems, if the server returned any. */
  get fieldErrors(): string[] {
    if (!Array.isArray(this.details)) return [];
    return this.details.map((d: { path?: string; row?: number; message: string }) =>
      d.row !== undefined ? `Row ${d.row}: ${d.message}` : d.path ? `${d.path}: ${d.message}` : d.message,
    );
  }
}

async function call<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": contentType },
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : (body as string),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({ error: `Server returned ${res.status}.` }));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Request failed.", data.details);
  return data as T;
}

export type RequirementRow = Requirement & {
  verificationState: VerificationState;
  allocated: boolean;
  componentIds: string[];
  testIds: string[];
  childCount: number;
};

export type RequirementDetail = Requirement & {
  verificationState: VerificationState;
  allocated: boolean;
  links: Link[];
  children: { id: string; title: string; status: Requirement["status"] }[];
  impact: Impact;
};

export type ComponentRow = Component & { requirementIds: string[] };
export type TestRow = VerificationTest & { requirementIds: string[] };

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const api = {
  requirements: (f: { search?: string; status?: string; priority?: string; type?: string } = {}) =>
    call<RequirementRow[]>("GET", `/requirements${qs(f)}`),
  requirement: (id: string) => call<RequirementDetail>("GET", `/requirements/${encodeURIComponent(id)}`),
  createRequirement: (r: Partial<RequirementInput>) => call<Requirement>("POST", "/requirements", r),
  updateRequirement: (id: string, r: Partial<RequirementInput>) =>
    call<Requirement>("PATCH", `/requirements/${encodeURIComponent(id)}`, r),
  deleteRequirement: (id: string) => call<void>("DELETE", `/requirements/${encodeURIComponent(id)}`),

  components: () => call<ComponentRow[]>("GET", "/components"),
  createComponent: (c: Partial<ComponentInput>) => call<Component>("POST", "/components", c),
  updateComponent: (id: string, c: Partial<ComponentInput>) =>
    call<Component>("PATCH", `/components/${encodeURIComponent(id)}`, c),
  deleteComponent: (id: string) => call<void>("DELETE", `/components/${encodeURIComponent(id)}`),

  tests: () => call<TestRow[]>("GET", "/tests"),
  createTest: (t: Partial<TestInput>) => call<VerificationTest>("POST", "/tests", t),
  updateTest: (id: string, t: Partial<TestInput>) => call<VerificationTest>("PATCH", `/tests/${encodeURIComponent(id)}`, t),
  deleteTest: (id: string) => call<void>("DELETE", `/tests/${encodeURIComponent(id)}`),

  link: (l: LinkInput) => call<Link>("POST", "/links", l),
  unlink: (l: LinkInput) => call<void>("DELETE", "/links", l),
  reviewLink: (l: LinkInput) => call<Link>("POST", "/links/review", l),

  metrics: () => call<Metrics>("GET", "/trace/metrics"),
  gaps: () => call<Gap[]>("GET", "/trace/gaps"),
  matrix: (axis: "component" | "test") => call<Matrix>("GET", `/trace/matrix?axis=${axis}`),
  model: () => call<Model>("GET", "/model"),
  audit: (limit = 200) => call<AuditEntry[]>("GET", `/audit?limit=${limit}`),

  importJson: (data: unknown, mode: "merge" | "replace") =>
    call<{ counts: Record<string, number> }>("POST", `/import?mode=${mode}`, data),
  importCsv: (csv: string) => call<{ counts: Record<string, number> }>("POST", `/import?mode=merge`, csv, "text/csv"),
  resetDemo: () => call<{ counts: Record<string, number> }>("POST", "/demo/reset"),
};
