import { expo } from '@better-auth/expo';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import type { Pool } from './db.js';
import type { Env } from './env.js';
import { resendMailer, type Mailer } from './mail.js';

export function authOptions(pool: Pool, env: Env, mailer: Mailer | null = resendMailer(env)): BetterAuthOptions {
  return {
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    emailAndPassword: { enabled: true, minPasswordLength: 6, maxPasswordLength: 128 },
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 days: friends shouldn't have to log in often
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },
    plugins: [
      expo(),
      // Password reset with a 6-digit code emailed to the user, entered in the app (no web page needed).
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'forget-password') return;
          if (!mailer) throw new Error('Password reset by email is not set up on this server.');
          await mailer.send({
            to: email,
            subject: `${otp} is your Crew Tasks reset code`,
            text: `Your Crew Tasks password reset code is ${otp}.\n\nIt expires in 10 minutes. If you didn't ask for this, you can ignore this email.`,
          });
        },
      }),
    ],
    trustedOrigins: [
      'crewtasks://',
      ...(env.NODE_ENV !== 'production' ? ['exp://', 'exp://**', 'http://localhost:8081'] : []),
    ],
    // Serverless instances don't share memory, so keep rate-limit counters in Postgres.
    rateLimit: { enabled: env.NODE_ENV === 'production', storage: 'database', window: 60, max: 100 },
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      // Vercel sets these from the real client connection (clients can't spoof them through Vercel's edge).
      ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
    },
  };
}

export function createAuth(pool: Pool, env: Env, mailer?: Mailer | null) {
  return betterAuth(authOptions(pool, env, mailer));
}

export type Auth = ReturnType<typeof createAuth>;
