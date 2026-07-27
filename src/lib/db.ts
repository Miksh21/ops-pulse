import { Pool } from "pg";

// Supabase transaction pooler (port 6543) is the right endpoint for serverless:
// connections are handed back after each statement, so a burst of lambdas does
// not exhaust the free-tier connection budget. node-postgres does not use named
// prepared statements by default, so transaction mode is safe here.
//
// The pool is cached on globalThis because Vercel reuses the module scope
// between invocations on a warm lambda — without this every request leaks a
// connection until the pooler starts refusing them.
declare global {
  // eslint-disable-next-line no-var
  var __opsPulsePool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({
    connectionString,
    // Supabase's pooler presents a cert chain Node does not ship a root for.
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!globalThis.__opsPulsePool) {
    globalThis.__opsPulsePool = createPool();
  }
  return globalThis.__opsPulsePool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
