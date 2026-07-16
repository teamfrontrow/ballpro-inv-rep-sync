import { Pool, type PoolClient, type QueryResultRow } from "pg";

declare global {
  var connectorPool: Pool | undefined;
  var repsparkPool: Pool | undefined;
}

function createPool(connectionString: string, applicationName: string): Pool {
  return new Pool({
    connectionString,
    application_name: applicationName,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function connectorDb(): Pool {
  const connectionString = process.env.CONNECTOR_DATABASE_URL;
  if (!connectionString) throw new Error("CONNECTOR_DATABASE_URL is required");
  global.connectorPool ??= createPool(connectionString, "ballpro-connector");
  return global.connectorPool;
}

export function repsparkDb(): Pool {
  const connectionString = process.env.REPSPARK_DATABASE_URL;
  if (!connectionString) throw new Error("REPSPARK_DATABASE_URL is required");
  global.repsparkPool ??= createPool(connectionString, "ballpro-connector-readonly");
  return global.repsparkPool;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connectorDb().connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T | null> {
  const result = await connectorDb().query<T>(text, values);
  return result.rows[0] ?? null;
}
