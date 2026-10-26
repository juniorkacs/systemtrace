/**
 * HTTP API. Every write is validated with the shared Zod schemas; all errors
 * are returned as { error, details? } with an appropriate status code.
 * See docs/api.md for the full reference.
 */
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import {
  componentInput,
  componentPatch,
  linkInput,
  modelImport,
  requirementInput,
  requirementPatch,
  testInput,
  testPatch,
  entityId,
  PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
} from "../shared/schema.ts";
import { buildMatrix, computeMetrics, findGaps, impactOf, TraceIndex, verificationState, isAllocated } from "../shared/trace.ts";
import { parseRequirementsCsv, requirementsToCsv } from "../shared/csv.ts";
import { HttpError, badRequest } from "./errors.ts";
import type { Store } from "./store.ts";
import { seedModel } from "./seed.ts";

export type AppOptions = {
  /** Disable rate limiting (tests). */
  rateLimit?: boolean;
  /** Absolute path of the built web client to serve, if any. */
  staticDir?: string;
};

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      "Validation failed.",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

const idParam = (req: Request) => parse(entityId, req.params.id);

const listQuery = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(REQUIREMENT_TYPES).optional(),
});

export function createApp(store: Store, opts: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(express.text({ type: "text/csv", limit: "2mb" }));

  if (opts.rateLimit !== false) {
    app.use("/api", rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
  }

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ----- requirements -----
  api.get("/requirements", (req, res) => {
    const filter = parse(listQuery, req.query);
    const model = store.getModel();
    const idx = new TraceIndex(model);
    const list = store.listRequirements(filter).map((r) => ({
      ...r,
      verificationState: verificationState(idx, r.id),
      allocated: isAllocated(idx, r.id),
      componentIds: (idx.componentsOf.get(r.id) ?? []).map((l) => l.targetId),
      testIds: (idx.testsOf.get(r.id) ?? []).map((l) => l.targetId),
      childCount: (idx.children.get(r.id) ?? []).length,
    }));
    res.json(list);
  });

  api.get("/requirements/:id", (req, res) => {
    const id = idParam(req);
    const requirement = store.getRequirement(id);
    const model = store.getModel();
    const idx = new TraceIndex(model);
    res.json({
      ...requirement,
      verificationState: verificationState(idx, id),
      allocated: isAllocated(idx, id),
      links: model.links.filter((l) => l.requirementId === id),
      children: (idx.children.get(id) ?? []).map((c) => ({ id: c.id, title: c.title, status: c.status })),
      impact: impactOf(model, id),
    });
  });

  api.post("/requirements", (req, res) => {
    res.status(201).json(store.createRequirement(parse(requirementInput, req.body)));
  });
  api.patch("/requirements/:id", (req, res) => {
    res.json(store.updateRequirement(idParam(req), parse(requirementPatch, req.body)));
  });
  api.delete("/requirements/:id", (req, res) => {
    store.deleteRequirement(idParam(req));
    res.status(204).end();
  });

  // ----- components -----
  api.get("/components", (_req, res) => {
    const model = store.getModel();
    const idx = new TraceIndex(model);
    res.json(model.components.map((c) => ({ ...c, requirementIds: idx.reqsOfComponent.get(c.id) ?? [] })));
  });
  api.post("/components", (req, res) => {
    res.status(201).json(store.createComponent(parse(componentInput, req.body)));
  });
  api.patch("/components/:id", (req, res) => {
    res.json(store.updateComponent(idParam(req), parse(componentPatch, req.body)));
  });
  api.delete("/components/:id", (req, res) => {
    store.deleteComponent(idParam(req));
    res.status(204).end();
  });

  // ----- tests -----
  api.get("/tests", (_req, res) => {
    const model = store.getModel();
    const idx = new TraceIndex(model);
    res.json(model.tests.map((t) => ({ ...t, requirementIds: idx.reqsOfTest.get(t.id) ?? [] })));
  });
  api.post("/tests", (req, res) => {
    res.status(201).json(store.createTest(parse(testInput, req.body)));
  });
  api.patch("/tests/:id", (req, res) => {
    res.json(store.updateTest(idParam(req), parse(testPatch, req.body)));
  });
  api.delete("/tests/:id", (req, res) => {
    store.deleteTest(idParam(req));
    res.status(204).end();
  });

  // ----- links -----
  api.post("/links", (req, res) => {
    res.status(201).json(store.link(parse(linkInput, req.body)));
  });
  api.delete("/links", (req, res) => {
    store.unlink(parse(linkInput, req.body));
    res.status(204).end();
  });
  api.post("/links/review", (req, res) => {
    res.json(store.reviewLink(parse(linkInput, req.body)));
  });

  // ----- analysis -----
  api.get("/trace/metrics", (_req, res) => {
    res.json(computeMetrics(store.getModel()));
  });
  api.get("/trace/gaps", (_req, res) => {
    res.json(findGaps(store.getModel()));
  });
  api.get("/trace/matrix", (req, res) => {
    const axis = parse(z.enum(["component", "test"]).default("component"), req.query.axis);
    res.json(buildMatrix(store.getModel(), axis));
  });
  api.get("/trace/impact/:id", (req, res) => {
    const id = idParam(req);
    const impact = impactOf(store.getModel(), id);
    if (!impact) throw new HttpError(404, `Requirement ${id} does not exist.`);
    res.json(impact);
  });
  api.get("/model", (_req, res) => {
    res.json(store.getModel());
  });

  // ----- audit -----
  api.get("/audit", (req, res) => {
    const limit = parse(z.coerce.number().int().min(1).max(500).default(100), req.query.limit);
    res.json(store.listAudit(limit));
  });

  // ----- import / export -----
  api.get("/export", (req, res) => {
    const format = parse(z.enum(["json", "csv"]).default("json"), req.query.format);
    const model = store.getModel();
    const date = new Date().toISOString().slice(0, 10);
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="systemtrace-requirements-${date}.csv"`);
      res.send(requirementsToCsv(model));
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="systemtrace-model-${date}.json"`);
      res.json({ format: "systemtrace/v1", exportedAt: new Date().toISOString(), ...model });
    }
  });

  api.post("/import", (req, res) => {
    const mode = parse(z.enum(["merge", "replace"]).default("merge"), req.query.mode);
    if (req.is("text/csv")) {
      if (typeof req.body !== "string") throw badRequest("Send the CSV as the request body.");
      const parsed = parseRequirementsCsv(req.body);
      if (parsed.errors.length) throw badRequest("The CSV has errors. Nothing was imported.", parsed.errors);
      if (mode === "replace") {
        throw badRequest("CSV files contain requirements only, so they can be merged but not used to replace the model.");
      }
      const links = parsed.links.map((l) => ({ ...l, suspect: false }));
      res.json(store.importModel({ requirements: parsed.requirements, components: [], tests: [], links }, "merge"));
      return;
    }
    const data = parse(modelImport, req.body);
    res.json(store.importModel(data, mode));
  });

  api.post("/demo/reset", (_req, res) => {
    res.json(store.importModel(seedModel, "replace", "reset"));
  });

  api.use((_req, _res, next) => next(new HttpError(404, "No such API endpoint.")));

  app.use("/api", api);

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir, { index: false, maxAge: "1h" }));
    // Client-side routing: serve index.html for any non-API GET.
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile("index.html", { root: opts.staticDir }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, details: err.details });
      return;
    }
    if (err instanceof SyntaxError && "body" in err) {
      res.status(400).json({ error: "Request body is not valid JSON." });
      return;
    }
    if (typeof err === "object" && err && "type" in err && err.type === "entity.too.large") {
      res.status(413).json({ error: "Request body is too large (limit 2 MB)." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}
