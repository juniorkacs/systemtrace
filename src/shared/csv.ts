/**
 * CSV import/export for requirements. One row per requirement; trace links
 * are stored as semicolon-separated IDs in the `components` and `tests` columns.
 */
import Papa from "papaparse";
import { requirementInput, type Model, type RequirementInput } from "./schema.ts";

export const CSV_COLUMNS = [
  "id",
  "title",
  "description",
  "type",
  "priority",
  "status",
  "verificationMethod",
  "parentId",
  "rationale",
  "components",
  "tests",
] as const;

export function requirementsToCsv(model: Model): string {
  const rows = model.requirements.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    priority: r.priority,
    status: r.status,
    verificationMethod: r.verificationMethod,
    parentId: r.parentId ?? "",
    rationale: r.rationale,
    components: linkIds(model, r.id, "component"),
    tests: linkIds(model, r.id, "test"),
  }));
  // Prefix cells that a spreadsheet would treat as formulas (CSV injection).
  const safe = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, /^[=+\-@\t\r]/.test(v) ? `'${v}` : v])),
  );
  return Papa.unparse({ fields: [...CSV_COLUMNS], data: safe.map((r) => CSV_COLUMNS.map((c) => r[c])) });
}

function linkIds(model: Model, reqId: string, type: "component" | "test"): string {
  return model.links
    .filter((l) => l.requirementId === reqId && l.targetType === type)
    .map((l) => l.targetId)
    .join(";");
}

export type CsvRowError = { row: number; message: string };
export type CsvParseResult = {
  requirements: RequirementInput[];
  links: { requirementId: string; targetType: "component" | "test"; targetId: string }[];
  errors: CsvRowError[];
};

/** Parse and validate a requirements CSV. Invalid rows are reported, never silently dropped. */
export function parseRequirementsCsv(csv: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  const errors: CsvRowError[] = parsed.errors.map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  const requirements: RequirementInput[] = [];
  const links: CsvParseResult["links"] = [];

  const header = parsed.meta.fields ?? [];
  for (const required of ["id", "title"]) {
    if (!header.includes(required)) errors.push({ row: 1, message: `Missing required column "${required}".` });
  }
  if (errors.some((e) => e.row === 1)) return { requirements, links, errors };

  parsed.data.forEach((raw, i) => {
    const row = i + 2; // +1 for header, +1 for 1-based rows
    const clean = (v: string | undefined) => (v ?? "").replace(/^'(?=[=+\-@\t\r])/, "").trim();
    const candidate = {
      id: clean(raw.id),
      title: clean(raw.title),
      description: clean(raw.description),
      type: clean(raw.type) || undefined,
      priority: clean(raw.priority) || undefined,
      status: clean(raw.status) || undefined,
      verificationMethod: clean(raw.verificationMethod) || undefined,
      parentId: clean(raw.parentId) || null,
      rationale: clean(raw.rationale),
    };
    const result = requirementInput.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ row, message: `${issue.path.join(".") || "row"}: ${issue.message}` });
      }
      return;
    }
    requirements.push(result.data);
    for (const [col, targetType] of [
      ["components", "component"],
      ["tests", "test"],
    ] as const) {
      for (const targetId of clean(raw[col])
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)) {
        links.push({ requirementId: result.data.id, targetType, targetId });
      }
    }
  });

  const seen = new Set<string>();
  for (const r of requirements) {
    if (seen.has(r.id)) errors.push({ row: 0, message: `Duplicate requirement ID ${r.id}.` });
    seen.add(r.id);
  }
  return { requirements, links, errors };
}
