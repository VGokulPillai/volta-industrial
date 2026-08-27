import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AppDb } from './index.js';

/**
 * Runs committed SQL migrations from ./drizzle/ at app startup.
 *
 * - Safe to call on every boot: Drizzle's migrator tracks applied migrations
 *   in a meta table and is a no-op if everything is up to date.
 * - In dev, the current user is the project owner (DDL allowed).
 * - In prod, the service principal runs this on first deploy, becomes the
 *   owner of `app` schema, and can run future migrations.
 *
 * NB: the migrations folder path is computed relative to this source file so
 * it resolves both under tsx-watch (dev) and tsdown-bundled (prod).
 */
export async function runMigrations(db: AppDb): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  // Dev: server/db/migrate.ts → ../../drizzle
  // Prod (bundled to dist/server.js): dist/ → ../drizzle
  const candidates = [
    resolve(here, '../../drizzle'),
    resolve(here, '../drizzle'),
  ];
  const fs = await import('node:fs');
  const migrationsFolder = candidates.find((p) => fs.existsSync(p));
  if (!migrationsFolder) {
    throw new Error(
      `No Drizzle migrations folder found. Tried: ${candidates.join(', ')}. ` +
        `Run \`npm run db:generate\` first.`,
    );
  }
  await migrate(db, { migrationsFolder });

  // Drizzle output is regenerated for clean installs, while this committed,
  // idempotent migration safely upgrades databases that already ran an older
  // generated 0000 migration. It creates app-owned state only.
  const build2Candidates = [
    resolve(here, '../../migrations/002_build2_workflow.sql'),
    resolve(here, '../migrations/002_build2_workflow.sql'),
  ];
  const build2Path = build2Candidates.find((p) => fs.existsSync(p));
  if (!build2Path) {
    throw new Error(`Build 2 migration not found. Tried: ${build2Candidates.join(', ')}`);
  }
  const build2Sql = fs.readFileSync(build2Path, 'utf8');
  await db.execute(sql.raw(build2Sql));
}
