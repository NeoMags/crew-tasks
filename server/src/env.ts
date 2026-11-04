import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL (Neon pooled connection string) is required'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters (openssl rand -base64 32)'),
  BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be the public URL of this API, e.g. https://crew-tasks-api.vercel.app'),
  NODE_ENV: z.string().default('production'),
  /** Optional: enables photo attachments via Vercel Blob. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  /** Optional: protects /api/cron/* (Vercel Cron sends it as a Bearer token). */
  CRON_SECRET: z.string().optional(),
  /** Optional: Expo access token if "enhanced push security" is enabled on your Expo account. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Optional: Resend API key + sender, enables password-reset codes by email. */
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  /** Set to "off" to disable Expo push (in-app inbox still works). */
  PUSH: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server configuration — ${issues}`);
  }
  return parsed.data;
}
