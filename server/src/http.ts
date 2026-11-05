import type { Context } from 'hono';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 501,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const forbidden = (m = "You don't have permission to do that.") => new HttpError(403, m);
export const notFound = (m = 'Not found.') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

/** Parse and validate a JSON body; throws 400 with readable messages. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('Request body must be JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; '));
  }
  return parsed.data;
}

export const uuid = z.string().uuid();

export function parseUuid(v: string | undefined, what = 'id'): string {
  const r = uuid.safeParse(v);
  if (!r.success) throw notFound(`Unknown ${what}.`);
  return r.data;
}

/** Postgres error code helper (e.g. 23505 unique_violation). */
export function pgCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
}
