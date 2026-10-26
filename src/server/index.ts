/**
 * Server entry point.
 *
 * Environment variables (see .env.example):
 *   PORT          port to listen on (default 3001)
 *   DB_PATH       SQLite file path; ":memory:" for an ephemeral database (default ./data/systemtrace.db)
 *   DEMO_MODE     "true" to reseed the demo model on start and every DEMO_RESET_MINUTES
 *   DEMO_RESET_MINUTES  reset interval in demo mode (default 60)
 */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";
import { seedModel } from "./seed.ts";

const port = Number(process.env.PORT ?? 3001);
const dbPath = process.env.DB_PATH ?? "./data/systemtrace.db";
const demoMode = process.env.DEMO_MODE === "true";
const resetMinutes = Number(process.env.DEMO_RESET_MINUTES ?? 60);

if (dbPath !== ":memory:") mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const store = new Store(dbPath);

const isEmpty = store.getModel().requirements.length === 0;
if (isEmpty || demoMode) {
  store.importModel(seedModel, "replace", "reset");
  console.log("Loaded the Kestrel AG-1 demo model.");
}
if (demoMode && resetMinutes > 0) {
  setInterval(() => store.importModel(seedModel, "replace", "reset"), resetMinutes * 60_000).unref();
}

// In production the compiled server serves the built client from dist/client.
const here = dirname(fileURLToPath(import.meta.url));
const candidate = resolve(here, "../../client");
const staticDir = existsSync(resolve(candidate, "index.html")) ? candidate : undefined;

const app = createApp(store, { staticDir });
const server = app.listen(port, () => {
  console.log(`SystemTrace API listening on http://localhost:${port}${staticDir ? " (serving web client)" : ""}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
