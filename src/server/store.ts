/**
 * Persistence layer. Uses Node's built-in SQLite driver (node:sqlite), so
 * there are no native dependencies to compile. All queries are parameterised.
 */
import { DatabaseSync } from "node:sqlite";
import type {
  AuditEntry,
  Component,
  ComponentInput,
  Link,
  LinkInput,
  Model,
  ModelImport,
  Requirement,
  RequirementInput,
  TestInput,
  VerificationTest,
} from "../shared/schema.ts";
import { requirementPatch, componentPatch, testPatch } from "../shared/schema.ts";
import type { z } from "zod";
import { wouldCreateCycle } from "../shared/trace.ts";
import { badRequest, conflict, notFound } from "./errors.ts";

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  parent_id TEXT REFERENCES requirements(id),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS components (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES components(id)
);
CREATE TABLE IF NOT EXISTS tests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  last_run TEXT
);
CREATE TABLE IF NOT EXISTS links (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('component','test')),
  target_id TEXT NOT NULL,
  suspect INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (requirement_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_req_parent ON requirements(parent_id);
`;

type Row = Record<string, unknown>;

const toRequirement = (r: Row): Requirement => ({
  id: r.id as string,
  title: r.title as string,
  description: r.description as string,
  type: r.type as Requirement["type"],
  priority: r.priority as Requirement["priority"],
  status: r.status as Requirement["status"],
  verificationMethod: r.verification_method as Requirement["verificationMethod"],
  parentId: (r.parent_id as string | null) ?? null,
  rationale: r.rationale as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const toComponent = (r: Row): Component => ({
  id: r.id as string,
  name: r.name as string,
  kind: r.kind as Component["kind"],
  description: r.description as string,
  parentId: (r.parent_id as string | null) ?? null,
});
const toTest = (r: Row): VerificationTest => ({
  id: r.id as string,
  name: r.name as string,
  method: r.method as VerificationTest["method"],
  status: r.status as VerificationTest["status"],
  description: r.description as string,
  lastRun: (r.last_run as string | null) ?? null,
});
const toLink = (r: Row): Link => ({
  requirementId: r.requirement_id as string,
  targetType: r.target_type as Link["targetType"],
  targetId: r.target_id as string,
  suspect: r.suspect === 1,
});

export type RequirementFilter = {
  search?: string;
  status?: string;
  priority?: string;
  type?: string;
};

export class Store {
  readonly db: DatabaseSync;
  /** Injectable clock so tests can control timestamps. */
  now: () => string = () => new Date().toISOString();

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  /** Runs fn inside a transaction; rolls back on any error. */
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  private audit(action: AuditEntry["action"], entity: AuditEntry["entity"], entityId: string, summary: string) {
    this.db
      .prepare("INSERT INTO audit (at, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?)")
      .run(this.now(), action, entity, entityId, summary);
  }

  // ---------- reads ----------

  getModel(): Model {
    return {
      requirements: this.db.prepare("SELECT * FROM requirements ORDER BY id").all().map(toRequirement),
      components: this.db.prepare("SELECT * FROM components ORDER BY id").all().map(toComponent),
      tests: this.db.prepare("SELECT * FROM tests ORDER BY id").all().map(toTest),
      links: this.db.prepare("SELECT * FROM links ORDER BY requirement_id, target_id").all().map(toLink),
    };
  }

  listRequirements(f: RequirementFilter = {}): Requirement[] {
    const where: string[] = [];
    const params: string[] = [];
    if (f.search) {
      where.push("(id LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
      const like = `%${f.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like, like);
    }
    for (const [col, val] of [
      ["status", f.status],
      ["priority", f.priority],
      ["type", f.type],
    ] as const) {
      if (val) {
        where.push(`${col} = ?`);
        params.push(val);
      }
    }
    const sql = `SELECT * FROM requirements ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
    return this.db
      .prepare(sql)
      .all(...params)
      .map(toRequirement);
  }

  getRequirement(id: string): Requirement {
    const row = this.db.prepare("SELECT * FROM requirements WHERE id = ?").get(id);
    if (!row) throw notFound("Requirement", id);
    return toRequirement(row);
  }

  getComponent(id: string): Component {
    const row = this.db.prepare("SELECT * FROM components WHERE id = ?").get(id);
    if (!row) throw notFound("Component", id);
    return toComponent(row);
  }

  getTest(id: string): VerificationTest {
    const row = this.db.prepare("SELECT * FROM tests WHERE id = ?").get(id);
    if (!row) throw notFound("Test", id);
    return toTest(row);
  }

  listAudit(limit = 100): AuditEntry[] {
    return this.db
      .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?")
      .all(Math.min(Math.max(limit, 1), 500))
      .map((r) => ({
        id: r.id as number,
        at: r.at as string,
        action: r.action as AuditEntry["action"],
        entity: r.entity as AuditEntry["entity"],
        entityId: r.entity_id as string,
        summary: r.summary as string,
      }));
  }

  private exists(table: "requirements" | "components" | "tests", id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  }

  // ---------- requirements ----------

  createRequirement(input: RequirementInput): Requirement {
    return this.tx(() => {
      if (this.exists("requirements", input.id)) throw conflict(`Requirement ${input.id} already exists.`);
      if (input.parentId && !this.exists("requirements", input.parentId)) {
        throw badRequest(`Parent requirement ${input.parentId} does not exist.`);
      }
      const ts = this.now();
      this.db
        .prepare(
          `INSERT INTO requirements (id, title, description, type, priority, status, verification_method, parent_id, rationale, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          input.title,
          input.description,
          input.type,
          input.priority,
          input.status,
          input.verificationMethod,
          input.parentId,
          input.rationale,
          ts,
          ts,
        );
      this.audit("create", "requirement", input.id, `Created "${input.title}"`);
      return this.getRequirement(input.id);
    });
  }

  updateRequirement(id: string, patch: z.infer<typeof requirementPatch>): Requirement {
    return this.tx(() => {
      const current = this.getRequirement(id);
      const next = { ...current, ...patch };
      if (patch.parentId !== undefined && patch.parentId !== null) {
        if (!this.exists("requirements", patch.parentId)) {
          throw badRequest(`Parent requirement ${patch.parentId} does not exist.`);
        }
        const all = this.db.prepare("SELECT id, parent_id AS parentId FROM requirements").all() as {
          id: string;
          parentId: string | null;
        }[];
        if (wouldCreateCycle(all, id, patch.parentId)) {
          throw badRequest(`Making ${patch.parentId} the parent of ${id} would create a loop in the hierarchy.`);
        }
      }
      const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== current[k]);
      if (changed.length === 0) return current;

      this.db
        .prepare(
          `UPDATE requirements SET title = ?, description = ?, type = ?, priority = ?, status = ?,
             verification_method = ?, parent_id = ?, rationale = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          next.title,
          next.description,
          next.type,
          next.priority,
          next.status,
          next.verificationMethod,
          next.parentId,
          next.rationale,
          this.now(),
          id,
        );

      // A change to what the requirement says invalidates earlier reviews of its links.
      if (changed.includes("title") || changed.includes("description")) {
        const res = this.db.prepare("UPDATE links SET suspect = 1 WHERE requirement_id = ?").run(id);
        if (Number(res.changes) > 0) {
          this.audit("update", "link", id, `Marked ${res.changes} link(s) suspect after the requirement text changed`);
        }
      }
      this.audit("update", "requirement", id, `Changed ${changed.join(", ")}`);
      return this.getRequirement(id);
    });
  }

  deleteRequirement(id: string): void {
    this.tx(() => {
      this.getRequirement(id);
      const kids = this.db.prepare("SELECT id FROM requirements WHERE parent_id = ?").all(id) as { id: string }[];
      if (kids.length) {
        throw conflict(`Requirement ${id} has child requirements. Re-parent or delete them first.`, {
          children: kids.map((k) => k.id),
        });
      }
      this.db.prepare("DELETE FROM requirements WHERE id = ?").run(id);
      this.audit("delete", "requirement", id, "Deleted requirement and its links");
    });
  }

  // ---------- components ----------

  createComponent(input: ComponentInput): Component {
    return this.tx(() => {
      if (this.exists("components", input.id)) throw conflict(`Component ${input.id} already exists.`);
      if (input.parentId && !this.exists("components", input.parentId)) {
        throw badRequest(`Parent component ${input.parentId} does not exist.`);
      }
      this.db
        .prepare("INSERT INTO components (id, name, kind, description, parent_id) VALUES (?, ?, ?, ?, ?)")
        .run(input.id, input.name, input.kind, input.description, input.parentId);
      this.audit("create", "component", input.id, `Created "${input.name}"`);
      return this.getComponent(input.id);
    });
  }

  updateComponent(id: string, patch: z.infer<typeof componentPatch>): Component {
    return this.tx(() => {
      const next = { ...this.getComponent(id), ...patch };
      if (next.parentId === id) throw badRequest("A component cannot be its own parent.");
      if (patch.parentId && !this.exists("components", patch.parentId)) {
        throw badRequest(`Parent component ${patch.parentId} does not exist.`);
      }
      this.db
        .prepare("UPDATE components SET name = ?, kind = ?, description = ?, parent_id = ? WHERE id = ?")
        .run(next.name, next.kind, next.description, next.parentId, id);
      this.audit("update", "component", id, `Changed ${Object.keys(patch).join(", ") || "nothing"}`);
      return this.getComponent(id);
    });
  }

  deleteComponent(id: string): void {
    this.tx(() => {
      this.getComponent(id);
      const kids = this.db.prepare("SELECT id FROM components WHERE parent_id = ?").all(id) as { id: string }[];
      if (kids.length) {
        throw conflict(`Component ${id} has child components. Re-parent or delete them first.`, {
          children: kids.map((k) => k.id),
        });
      }
      this.db.prepare("DELETE FROM links WHERE target_type = 'component' AND target_id = ?").run(id);
      this.db.prepare("DELETE FROM components WHERE id = ?").run(id);
      this.audit("delete", "component", id, "Deleted component and its links");
    });
  }

  // ---------- tests ----------

  createTest(input: TestInput): VerificationTest {
    return this.tx(() => {
      if (this.exists("tests", input.id)) throw conflict(`Test ${input.id} already exists.`);
      this.db
        .prepare("INSERT INTO tests (id, name, method, status, description, last_run) VALUES (?, ?, ?, ?, ?, ?)")
        .run(input.id, input.name, input.method, input.status, input.description, input.lastRun);
      this.audit("create", "test", input.id, `Created "${input.name}"`);
      return this.getTest(input.id);
    });
  }

  updateTest(id: string, patch: z.infer<typeof testPatch>): VerificationTest {
    return this.tx(() => {
      const current = this.getTest(id);
      const next = { ...current, ...patch };
      this.db
        .prepare("UPDATE tests SET name = ?, method = ?, status = ?, description = ?, last_run = ? WHERE id = ?")
        .run(next.name, next.method, next.status, next.description, next.lastRun, id);
      const statusNote = patch.status && patch.status !== current.status ? ` (status ${current.status} to ${patch.status})` : "";
      this.audit("update", "test", id, `Changed ${Object.keys(patch).join(", ") || "nothing"}${statusNote}`);
      return this.getTest(id);
    });
  }

  deleteTest(id: string): void {
    this.tx(() => {
      this.getTest(id);
      this.db.prepare("DELETE FROM links WHERE target_type = 'test' AND target_id = ?").run(id);
      this.db.prepare("DELETE FROM tests WHERE id = ?").run(id);
      this.audit("delete", "test", id, "Deleted test and its links");
    });
  }

  // ---------- links ----------

  link(input: LinkInput): Link {
    return this.tx(() => {
      this.getRequirement(input.requirementId);
      if (input.targetType === "component") this.getComponent(input.targetId);
      else this.getTest(input.targetId);
      const existing = this.db
        .prepare("SELECT 1 FROM links WHERE requirement_id = ? AND target_type = ? AND target_id = ?")
        .get(input.requirementId, input.targetType, input.targetId);
      if (existing) throw conflict(`${input.requirementId} is already linked to ${input.targetId}.`);
      this.db
        .prepare("INSERT INTO links (requirement_id, target_type, target_id, suspect, created_at) VALUES (?, ?, ?, 0, ?)")
        .run(input.requirementId, input.targetType, input.targetId, this.now());
      const verb = input.targetType === "component" ? "allocated to" : "verified by";
      this.audit("link", "link", input.requirementId, `${input.requirementId} ${verb} ${input.targetId}`);
      return { ...input, suspect: false };
    });
  }

  unlink(input: LinkInput): void {
    this.tx(() => {
      const res = this.db
        .prepare("DELETE FROM links WHERE requirement_id = ? AND target_type = ? AND target_id = ?")
        .run(input.requirementId, input.targetType, input.targetId);
      if (Number(res.changes) === 0) throw notFound("Link", `${input.requirementId} to ${input.targetId}`);
      this.audit("unlink", "link", input.requirementId, `Removed link ${input.requirementId} to ${input.targetId}`);
    });
  }

  /** Mark a suspect link as reviewed. */
  reviewLink(input: LinkInput): Link {
    return this.tx(() => {
      const res = this.db
        .prepare("UPDATE links SET suspect = 0 WHERE requirement_id = ? AND target_type = ? AND target_id = ?")
        .run(input.requirementId, input.targetType, input.targetId);
      if (Number(res.changes) === 0) throw notFound("Link", `${input.requirementId} to ${input.targetId}`);
      this.audit("review", "link", input.requirementId, `Reviewed link ${input.requirementId} to ${input.targetId}`);
      return { ...input, suspect: false };
    });
  }

  // ---------- bulk ----------

  /**
   * Import a model. "replace" wipes existing data first; "merge" upserts by ID.
   * Everything runs in one transaction, so a bad record leaves the data untouched.
   */
  importModel(data: ModelImport, mode: "merge" | "replace", source = "import"): { counts: Record<string, number> } {
    return this.tx(() => {
      if (mode === "replace") {
        this.db.exec("DELETE FROM links; DELETE FROM requirements; DELETE FROM components; DELETE FROM tests;");
      }
      const ts = this.now();
      const upsertReq = this.db.prepare(
        `INSERT INTO requirements (id, title, description, type, priority, status, verification_method, parent_id, rationale, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, type=excluded.type,
           priority=excluded.priority, status=excluded.status, verification_method=excluded.verification_method,
           rationale=excluded.rationale, updated_at=excluded.updated_at`,
      );
      for (const r of data.requirements) {
        upsertReq.run(r.id, r.title, r.description, r.type, r.priority, r.status, r.verificationMethod, r.rationale, ts, ts);
      }
      // Parents are set in a second pass so rows can appear in any order.
      const setParent = this.db.prepare("UPDATE requirements SET parent_id = ? WHERE id = ?");
      for (const r of data.requirements) {
        if (r.parentId && !this.exists("requirements", r.parentId)) {
          throw badRequest(`Requirement ${r.id} references missing parent ${r.parentId}.`);
        }
        setParent.run(r.parentId, r.id);
      }
      const all = this.db.prepare("SELECT id, parent_id AS parentId FROM requirements").all() as {
        id: string;
        parentId: string | null;
      }[];
      for (const r of all) {
        if (r.parentId && wouldCreateCycle(all, r.id, r.parentId)) {
          throw badRequest(`Requirement hierarchy has a loop involving ${r.id}.`);
        }
      }

      const upsertComp = this.db.prepare(
        `INSERT INTO components (id, name, kind, description, parent_id) VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind, description=excluded.description`,
      );
      for (const c of data.components) upsertComp.run(c.id, c.name, c.kind, c.description);
      for (const c of data.components) {
        if (c.parentId && !this.exists("components", c.parentId)) {
          throw badRequest(`Component ${c.id} references missing parent ${c.parentId}.`);
        }
        this.db.prepare("UPDATE components SET parent_id = ? WHERE id = ?").run(c.parentId, c.id);
      }

      const upsertTest = this.db.prepare(
        `INSERT INTO tests (id, name, method, status, description, last_run) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, method=excluded.method, status=excluded.status,
           description=excluded.description, last_run=excluded.last_run`,
      );
      for (const t of data.tests) upsertTest.run(t.id, t.name, t.method, t.status, t.description, t.lastRun);

      const insLink = this.db.prepare(
        `INSERT INTO links (requirement_id, target_type, target_id, suspect, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT DO UPDATE SET suspect = excluded.suspect`,
      );
      for (const l of data.links) {
        if (!this.exists("requirements", l.requirementId)) {
          throw badRequest(`Link references missing requirement ${l.requirementId}.`);
        }
        const table = l.targetType === "component" ? "components" : "tests";
        if (!this.exists(table, l.targetId)) {
          throw badRequest(`Link from ${l.requirementId} references missing ${l.targetType} ${l.targetId}.`);
        }
        insLink.run(l.requirementId, l.targetType, l.targetId, l.suspect ? 1 : 0, ts);
      }

      const counts = {
        requirements: data.requirements.length,
        components: data.components.length,
        tests: data.tests.length,
        links: data.links.length,
      };
      this.audit(
        source === "reset" ? "reset" : "import",
        "model",
        mode,
        `${source === "reset" ? "Reset demo data" : `Imported (${mode})`}: ${counts.requirements} requirements, ${counts.components} components, ${counts.tests} tests, ${counts.links} links`,
      );
      return { counts };
    });
  }
}
