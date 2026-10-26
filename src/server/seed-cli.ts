/** `npm run seed`: replace the local database contents with the demo model. */
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Store } from "./store.ts";
import { seedModel } from "./seed.ts";

const dbPath = process.env.DB_PATH ?? "./data/systemtrace.db";
mkdirSync(dirname(resolve(dbPath)), { recursive: true });
const store = new Store(dbPath);
const { counts } = store.importModel(seedModel, "replace", "reset");
store.close();
console.log(`Seeded ${dbPath}:`, counts);
