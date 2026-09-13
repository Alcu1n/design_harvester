import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.ts";
const globalDB = globalThis as unknown as { harvesterPool?: pg.Pool };
export const pool =
  globalDB.harvesterPool ??
  new pg.Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://harvester:harvester@127.0.0.1:5432/harvester",
    max: 8,
  });
globalDB.harvesterPool = pool;
export const db = drizzle(pool, { schema });
export async function sql<T = Record<string, any>>(
  q: string,
  args: unknown[] = [],
): Promise<T[]> {
  return (await pool.query(q, args)).rows;
}
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const x = await fn(c);
    await c.query("COMMIT");
    return x;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
