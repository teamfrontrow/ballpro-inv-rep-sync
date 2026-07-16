import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const migrationsDir = path.resolve(process.cwd(), "db/migrations");

async function main(): Promise<void> {
  const connectionString = process.env.CONNECTOR_DATABASE_URL;
  if (!connectionString) throw new Error("CONNECTOR_DATABASE_URL is required");

  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  let initializedSettings = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('ballpro-connector-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");

    const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string | null }>(
        "SELECT checksum FROM schema_migrations WHERE version = $1",
        [file],
      );
      if (existing.rowCount) {
        if (existing.rows[0].checksum && existing.rows[0].checksum !== checksum) {
          throw new Error(`Migration ${file} changed after it was applied`);
        }
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2) ON CONFLICT (version) DO UPDATE SET checksum = EXCLUDED.checksum",
          [file, checksum],
        );
        await client.query("COMMIT");
        if (file === "0001_init.sql") initializedSettings = true;
        console.log(`Applied ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (initializedSettings) {
      await client.query(
        `UPDATE app_settings
         SET default_cap = $1, future_horizon_days = $2, shopify_api_version = $3
         WHERE singleton = true`,
        [
          Number.parseInt(process.env.SYNC_DEFAULT_CAP ?? "500", 10),
          Number.parseInt(process.env.FUTURE_HORIZON_DAYS ?? "365", 10),
          process.env.SHOPIFY_API_VERSION ?? "2026-07",
        ],
      );
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('ballpro-connector-migrations'))");
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
