import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
/** Anything that can run a query: the pool or a transaction client. */
export type Queryable = Pick<pg.Pool, 'query'>;

// Return timestamptz as ISO strings and bigint ids as strings, matching the API types.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

/**
 * Use Neon's *pooled* connection string (host contains "-pooler") in production:
 * serverless functions open many short-lived connections and the pooler absorbs them.
 */
export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

/** Runs fn in a transaction. Keep it short: no network calls (push, uploads) inside. */
export async function tx<T>(pool: Pool, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
