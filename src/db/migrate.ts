/**
 * Standalone migration runner: `pnpm db:migrate`.
 * Boot-time migration in src/db/index.ts covers the app path; this exists for
 * CI and manual use.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";

const dbPath = process.env.FERRATA_DB_PATH ?? "./ferrata.db";
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });

// eslint-disable-next-line no-console
console.log(`Migrations applied to ${dbPath}`);
sqlite.close();
