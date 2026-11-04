# Crew Tasks

An Android app for friends to **assign work, track progress and see what's pending**: groups, tasks, "what's needed" checklists, proof-photo attachments, comments with @mentions, an in-app inbox, reminders and push notifications.

**Stack:** Expo (React Native, TypeScript) app · Hono API on **Vercel** · **Neon** Postgres · **Better Auth** (self-hosted, users stored in Neon). No Firebase.

---

## Features

| Area | What you get |
|---|---|
| Accounts | Email/password sign-up, 60-day sessions stored in the phone's secure storage, **password reset with a 6-digit emailed code** (needs Resend) |
| Groups | Create, invite with a 6-character code (share via WhatsApp), roles owner / admin / member, remove members, reset code, leave / delete |
| Tasks | Multiple assignees, priority, due date & time, repeat (daily/weekly/monthly), status **To do → In progress → Blocked (reason) → In review → Done**, progress %, "I'll do this" for unassigned tasks |
| Approval | Optional: assignees submit for review; only the assigner/admin marks Done |
| What's needed | Per-task checklist of things to furnish, showing who furnished what and when |
| Proof & files | Photos / PDFs up to 4 MB (needs Vercel Blob) |
| Tracking | **My tasks** (assigned to me / I assigned) with Open, Overdue, Today and Blocked counters; group board with per-friend counts |
| Discussion | Comments; @mentions are detected on the server and notify the person |
| History | Append-only activity log per task |
| Inbox | In-app notifications with unread badge: assigned, status changes, review requests, comments, mentions, overdue |
| Reminders | On-device: automatic (1 h before + at due time) and custom |
| Push | Optional background push via Expo (Android delivery goes through Google FCM, see below) |

## Architecture

```
Android app (Expo Router + React Query, refreshes every 15 s while open)
   │ HTTPS + session cookie (Better Auth)
   ▼
Vercel: Hono API  (server/)  ── every request: who are you? are you in this group? may you do this?
   │ pg (pooled)                    │ after commit
   ▼                                ▼
Neon Postgres                 Expo push → FCM → phone      Vercel Blob (attachments)
```

| Was (Firebase version) | Now |
|---|---|
| Firestore + security rules | Neon Postgres; **all authorization in the API** (tested), membership-scoped SQL |
| Firebase Auth | Better Auth inside the API (`user`/`session` tables in Neon) |
| Realtime listeners | Polling every 15 s while the app is open, instant refresh after your own changes, refresh on app resume |
| Cloud Functions | API routes; overdue scan piggybacks on traffic (≤ every 10 min) + daily Vercel Cron backstop |
| Storage | Vercel Blob (optional) |
| FCM direct | In-app inbox (always) + Expo push (optional) |

Data model (`server/migrations/001_init.sql`): `groups`, `group_members`, `tasks`, `task_assignees`, `checklist_items`, `attachments`, `comments`, `activity`, `notifications`, `devices` + Better Auth's tables. Foreign keys are indexed; constraints (lengths, enums, one owner per group, recurring ⇒ due date) are enforced in the database.

---

## Setup

You need accounts on **Neon**, **Vercel** and **GitHub** (all have free tiers; check their current limits). Resend and Expo are optional.

### 1. Neon database

1. Create a project at <https://console.neon.tech>. Pick the region closest to your friends; you'll put the Vercel functions in the same region.
2. From **Connect**, copy two connection strings:
   - **Pooled** (host contains `-pooler`): used by the API.
   - **Direct**: used once for migrations.

### 2. Create the tables

```bash
cd server
npm ci
cp .env.example .env     # fill in DATABASE_URL (use the DIRECT string here), BETTER_AUTH_SECRET, BETTER_AUTH_URL
npm run migrate          # safe to re-run; prints what it applied
```

Generate the secret with `openssl rand -base64 32`. Keep it; changing it signs everyone out.

### 3. Deploy the API on Vercel

1. Vercel → **Add New → Project** → import `NeoMags/crew-tasks`.
2. Set **Root Directory** to `server`. The framework is detected as **Hono**.
3. Add these **Environment Variables**:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** connection string |
   | `BETTER_AUTH_SECRET` | same value as in step 2 |
   | `BETTER_AUTH_URL` | your deployment URL, e.g. `https://crew-tasks-api.vercel.app` (deploy once, then set it and redeploy) |
   | `CRON_SECRET` | `openssl rand -hex 24` (protects the daily overdue job) |

4. **Settings → Functions → Region**: choose the region matching Neon.
5. Deploy, then open `https://<your-url>/api/health`. It should show `{"ok":true,...}`.

**Optional extras:**

- **Attachments:** Vercel → **Storage → Blob → Create** and connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`; redeploy.
- **Password reset emails:** create a Resend account, verify a sending domain, then set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Crew Tasks <noreply@yourdomain.com>`).

### 4. Build the APK (GitHub Actions)

1. Create the signing key **once** with `./scripts/make-keystore.sh` (needs Java's `keytool`). Back up the `.jks` file and its password: without them, friends must uninstall before installing an update.
2. GitHub → **Settings → Secrets and variables → Actions**:

   | Kind | Name | Value |
   |---|---|---|
   | Variable | `API_URL` | your Vercel URL (no trailing slash) |
   | Secret | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | from `make-keystore.sh` |
   | Variable (optional) | `ATTACHMENTS` | `off` if you skipped Blob |
   | Variable + secret (optional, push) | `EAS_PROJECT_ID`, `GOOGLE_SERVICES_JSON_BASE64` | see below |

3. **Actions → Build Android APK → Run workflow**, then download `crew-tasks-apk` from the run. Pushing a tag (`v1.0.1`) also attaches the APK to a GitHub Release.

### 5. Optional: background push notifications

The in-app **Inbox** works without any of this. For notifications that arrive while the app is closed:

1. Run `npx eas-cli@latest init` to create a free Expo project. Copy the **project ID** into the `EAS_PROJECT_ID` variable.
2. Set up Google's push channel. Android requires FCM for *any* push service, so Expo uses it too. Create a Firebase project used **only** as the delivery channel (no Firebase code in the app):
   - Add an Android app with package `com.neomags.crewtasks`.
   - Download `google-services.json` and store it base64-encoded as `GOOGLE_SERVICES_JSON_BASE64` (`base64 -w0 google-services.json`).
   - Generate an FCM V1 service-account key and upload it at expo.dev → your project → **Credentials → Android → FCM V1**.
3. Rebuild the APK.

### 6. Install on phones

Share the APK (WhatsApp, Drive, Telegram). Friends allow "Install unknown apps", sign up, and join with your invite code. On Xiaomi / Oppo / Vivo / Realme / OnePlus, set Battery → *No restrictions* for reliable reminders. The **Me** tab links to the setting.

---

## Security model

- **Sessions:** HttpOnly session cookies are issued by Better Auth. The app keeps them in Android's secure store and sends them on every request. There are no API keys in the app.
- **Group checks on every request:** each endpoint checks group membership in SQL. Non-members get `404`, so the API never reveals whether a task exists.
- **Permission rules** (each one is tested in `server/test/api.test.ts`):
  - Only assignees, the assigner or admins change status or progress.
  - Only the assigner or admins edit or delete a task.
  - Tasks that need approval can only be marked Done by the assigner or an admin.
  - Only the owner changes roles; the owner can't be removed.
  - Joining requires the current, unexpired invite code.
  - Assignees must be group members.
  - @mentions are worked out on the server.
- **Removed members** lose access immediately and are unassigned from that group's open tasks.
- **Password reset** codes expire after 10 minutes and allow 5 attempts. Unknown emails get the same response, so nobody can probe which emails have accounts.
- **Rate limiting:** Better Auth's limiter is on in production and its counters are stored in Postgres.
- **Attachment links** are unguessable URLs (random suffix) and are only shown to group members. Anyone who already has a link can open the file, so don't attach highly sensitive documents.

## Development

```bash
npm ci && npm ci --prefix server
cp .env.example .env                 # EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000
npm run server:dev                   # API on :3000 (reads server/.env)
npx expo prebuild -p android && npx expo run:android
```

### Tests

```bash
npm run typecheck                    # app
cd server && npx tsc --noEmit        # server
npm test                             # API integration tests + logic tests against a real Postgres
```

`npm test` starts a temporary embedded Postgres automatically. CI (`.github/workflows/ci.yml`) uses a Postgres service container, typechecks both packages and bundles the Android JS.

## Project layout

```
src/                 Expo app: screens (app/), components, lib (api client, auth, tasks, push, reminders)
server/src/          Hono API: index.ts (Vercel entry), createApp.ts, routes/, queries.ts, auth.ts, overdue.ts
server/src/shared/   types + business logic shared by app and server (app imports via @shared/*)
server/migrations/   SQL schema
server/test/         integration tests (real Postgres) + unit tests
plugins/             Expo config plugin for release signing
```

## Known limitations

- **Not instant like Firestore:** the app refreshes every 15 s while open and immediately after your own changes. Background push (optional) covers the rest.
- **Neon free tier sleeps when idle:** the first request after a quiet period can take a moment while the database wakes.
- **Overdue alerts** are checked on normal app traffic (at most every 10 minutes) plus a daily Vercel Cron run. In a group nobody opens, the alert can arrive up to a day late. Phone reminders for assignees aren't affected.
- **Uploads** are limited to 4 MB, Vercel's request-size limit. Photos are compressed before upload.
- **Push** needs the FCM setup above. Without it you still get the Inbox and phone reminders.
- **Testing:** iOS is untested. The app hasn't yet been run on a phone against a live deployment.

## Roadmap ideas

Google Sign-In · Google Calendar sync · Telegram digest bot · expense split per task · home-screen widget · AI quick-add ("Ravi to submit form by Friday") · export to Sheets/PDF · server-sent events for faster live updates.
