import type { Env } from './env.js';

export interface Mailer {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

/** Sends email through Resend's HTTP API. Returns null (feature off) when not configured. */
export function resendMailer(env: Env, fetchImpl: typeof fetch = fetch): Mailer | null {
  const key = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!key || !from) return null;
  return {
    async send({ to, subject, text }) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Email could not be sent (${res.status}).`);
    },
  };
}
