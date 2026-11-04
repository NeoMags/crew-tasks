/**
 * Attachment storage behind a small interface so it can be swapped (Vercel Blob in
 * production, in-memory in tests). Disabled when BLOB_READ_WRITE_TOKEN is not set.
 */
import { del, put } from '@vercel/blob';
import type { Env } from './env.js';

export interface Storage {
  put(pathname: string, data: Blob, contentType: string): Promise<{ url: string; pathname: string }>;
  delete(pathnames: string[]): Promise<void>;
}

export function vercelBlobStorage(env: Env): Storage | null {
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  return {
    async put(pathname, data, contentType) {
      // Random suffix makes URLs unguessable; files are only listed to group members via the API.
      const r = await put(pathname, data, { access: 'public', contentType, addRandomSuffix: true, token });
      return { url: r.url, pathname: r.pathname };
    },
    async delete(pathnames) {
      if (pathnames.length) await del(pathnames, { token });
    },
  };
}

export function memoryStorage(): Storage & { files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  return {
    files,
    async put(pathname, data) {
      const p = `${pathname}-${crypto.randomUUID().slice(0, 8)}`;
      files.set(p, data);
      return { url: `https://blob.test/${p}`, pathname: p };
    },
    async delete(pathnames) {
      pathnames.forEach((p) => files.delete(p));
    },
  };
}
