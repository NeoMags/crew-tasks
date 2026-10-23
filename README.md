# Crew Tasks

An Android app for friends to **assign work, track progress and see what's pending**: groups, tasks, "what's needed" checklists, proof-photo attachments, comments with @mentions, reminders and push notifications.

Built with **Expo (React Native, TypeScript)** + **Firebase** (Auth, Firestore, Storage, Cloud Functions, FCM).

---

## Features

| Area | What you get |
|---|---|
| Accounts | Email/password sign-up, password reset, display name (synced to all your groups) |
| Groups | Create a group, invite with a 6-character code (share via WhatsApp etc.), roles: owner / admin / member, remove members, reset invite code, leave/delete group |
| Tasks | Title, details, multiple assignees, priority, due date & time, repeat (daily/weekly/monthly), status **To do → In progress → Blocked (with reason) → In review → Done**, progress %, "pick up" unassigned tasks |
| Approval | Optional "needs my approval": assignees submit for review, only the assigner/admin marks Done |
| What's needed | Per-task checklist of items to furnish (documents, money, info), showing who furnished what and when |
| Proof & files | Photo attachments from camera/gallery (needs Blaze plan, see below) |
| Tracking | **My tasks** (assigned to me / I assigned) with Open, Overdue, Today and Blocked counters; group board with per-friend pending/overdue counts and status filters |
| Discussion | Comments per task, @mentions notify the person mentioned |
| History | Append-only activity log per task (who changed what, when) |
| Reminders | On-device: automatic (1 h before + at due time) and custom ("in 1 hour", "tomorrow 9 AM", any time) |
| Push | New task / assigned to you / status change / review requested / comment / mention / overdue (Cloud Functions + FCM) |

## Architecture

```
Android app (Expo Router, Firebase JS SDK)
   │  realtime listeners, transactions
   ▼
Firestore ── firestore.rules (all authorization, tested)
   │  triggers
   ▼
Cloud Functions (functions/) ──► FCM push to users/{uid}/devices tokens
Cloud Storage (tasks/{taskId}/…) ── storage.rules (group members only)
```

Data model:

| Collection | Purpose |
|---|---|
| `users/{uid}` | profile; `devices/{id}` holds FCM tokens |
| `groups/{gid}` | name, `memberIds`, `members{uid:{name,role}}`, current invite code |
| `inviteCodes/{code}` | code → group (gettable, never listable) |
| `tasks/{tid}` | task incl. checklist + attachments; `comments/`, `activity/` subcollections |

**Security is enforced server-side** in `firestore.rules` / `storage.rules`: only members can read a group's tasks; joining requires the current, unexpired invite code; only assignees/assigner/admins change status; only the assigner/admins edit details or delete; only the owner changes roles; activity is append-only. The UI hides actions too, but that is convenience only.

## Plans and costs (verify on firebase.google.com/pricing)

| Feature | Spark (free) | Blaze (pay-as-you-go) |
|---|---|---|
| Accounts, groups, tasks, checklist, comments, activity | ✅ | ✅ |
| On-device reminders | ✅ | ✅ |
| Push notifications (Cloud Functions) | ❌ | ✅ |
| Photo attachments (Cloud Storage) | ❌ — build with `ATTACHMENTS=off` | ✅ |

A friends group stays well inside Firestore's free quotas. On Blaze, Functions and Storage have free allowances, but new Storage buckets outside the US get no "always free" tier, so attachments may cost a few cents a month. **Set a budget alert** in Google Cloud Billing.

---

## 1. Set up Firebase (one time)

1. Create a project at <https://console.firebase.google.com>.
2. **Firestore Database** → Create database → Production mode → location **asia-south1 (Mumbai)**. If you choose another location, set `FUNCTIONS_REGION` in `functions/.env` to the same region.
3. **Authentication** → Sign-in method → enable **Email/Password**.
4. **Project settings → Your apps**:
   - Add a **Web app**. Copy its config values into `.env` (see `.env.example`) and into the GitHub secrets below.
   - Add an **Android app** with package `com.neomags.crewtasks` (or your own; then set `ANDROID_PACKAGE`). Download **google-services.json**. It is needed for push notifications.
5. *(For push + attachments)* Upgrade to **Blaze**, then create **Storage** (same region).
6. Deploy rules, indexes and functions from your computer:

```bash
npm install -g firebase-tools
firebase login
firebase use --add                       # pick your project
npm ci --prefix functions
firebase deploy --only firestore         # rules + indexes (works on Spark)
firebase deploy --only storage,functions # Blaze only; accept the Storage→Firestore permission prompt
```

## 2. Build the APK on GitHub (recommended)

1. Create the signing key **once** and keep it safe. Losing it means friends must uninstall before installing a new build.

   ```bash
   ./scripts/make-keystore.sh            # needs Java's keytool
   ```

2. Add the SHA-1 it prints to your Android app in Firebase.
3. In GitHub → **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|---|---|
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_APP_ID` | from the Web app config |
| `GOOGLE_SERVICES_JSON_BASE64` | `base64 -w0 google-services.json` |
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | from `make-keystore.sh` |

   Optional **variables**: `ANDROID_PACKAGE`, and `ATTACHMENTS=off` if you stay on Spark.

4. **Actions → Build Android APK → Run workflow**. Download `crew-tasks-apk` from the run, or push a tag (`git tag v1.0.0 && git push --tags`) to get the APK attached to a GitHub Release.

**Alternative (EAS):** `npx eas-cli@latest build -p android --profile preview` builds an APK in Expo's cloud. Set the same `EXPO_PUBLIC_FIREBASE_*` values as EAS environment variables and upload `google-services.json` as a file variable.

## 3. Install on phones

Send the APK (WhatsApp, Drive, Telegram). Each friend opens it, allows "Install unknown apps" for that source, installs, signs up, and joins with your invite code. To update, install the new APK over the old one. This only works if every build is signed with the **same keystore**.

**Notifications on Xiaomi / Oppo / Vivo / Realme / OnePlus:** set Battery → *No restrictions* and allow *Autostart*, or the OS may block reminders. The app's **Me** tab links to the settings.

## Development

```bash
npm ci
cp .env.example .env        # fill in Firebase web config
npx expo prebuild -p android && npx expo run:android   # dev build on a phone/emulator (USB debugging)
```

The app uses native modules (notifications, date picker), so use a dev build rather than Expo Go.

### Tests

```bash
npm run typecheck
npm test                 # business-logic unit tests (tests/unit)
npm run test:rules       # Firestore + Storage security rules against emulators (needs Java)
npm run test:functions   # notification decision logic (functions/test)
```

CI (`.github/workflows/ci.yml`) runs all of these on every push.

## Project layout

```
src/app/            screens (Expo Router): (auth)/, (app)/(tabs)/, group/, task/
src/components/     UI kit, TaskRow, task detail sections, date picker
src/lib/            firebase, auth, groups, tasks, reminders, push, pure logic
functions/src/      Cloud Functions (push, overdue scan, clean-up)
firestore.rules, storage.rules, firestore.indexes.json
plugins/withReleaseSigning.js   release signing from env vars
tests/              unit + security-rules tests
```

## Known limitations

- **Push** needs Blaze, deployed functions and `google-services.json` in the build. Without them the app still works and on-device reminders still fire.
- **Reminders** are per phone. Reinstalling or signing out clears them; the app re-creates automatic ones on next open.
- **Attachment links** are Firebase download URLs: anyone who has a link can open that file. Don't attach highly sensitive documents.
- **Removed members** are unassigned from open tasks by a Cloud Function, so this only happens on Blaze.
- **Group size** is capped at 50 members, 20 assignees per task, 50 checklist items and 10 attachments per task.
- **Platform:** Android is the focus. iOS should build with EAS, but it is untested.

## Roadmap ideas

Google Sign-In / phone OTP · Google Calendar sync of due dates · Telegram bot digest of pending tasks · expense split per task · home-screen widget · AI quick-add ("Ravi to submit form by Friday") · export to Sheets/PDF · Play Store release.
