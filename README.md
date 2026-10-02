# Meal Prep (PWA)

Two-week meal prep plan with bag checklists, a food log, phone/iPad sync, and a nightly "tonight's move" reminder.
Vanilla HTML/CSS/JS, hosted on GitHub Pages, Supabase for sync and reminders. Works offline.

## What's in the repo

| Path | What it is |
|---|---|
| `index.html` | The whole app (CSS + JS inline). CONFIG block is near the top of the script. |
| `sw.js` | Service worker: offline cache + push notifications. |
| `manifest.webmanifest`, `icons/` | Home Screen install. |
| `vendor/supabase.js` | supabase-js v2.116.0 (UMD), stored locally so it works offline. |
| `tools/vapid-keys.html` | Makes your push keys in the browser. Nothing leaves the page. |
| `supabase/01_schema.sql` | Tables, row-level security, and the sync function. |
| `supabase/02_cron.sql` | Runs the reminder every 15 minutes. |
| `supabase/functions/meal-reminders/index.ts` | The Edge Function that sends reminders. |
| `tests/app.test.js` | jsdom behavioral tests (16). |

## Setup (all doable from an iPad)

### 1. Supabase project
1. Create a project (or reuse one).
2. **SQL Editor → New query**: paste `supabase/01_schema.sql` → Run.
3. **Authentication → Sign In / Providers**: make sure Email is on.
4. **Authentication → Emails**: add the code to **both** the **Confirm signup** template (used the very first time you sign in) and the **Magic Link** template (used after that), for example
   `<p>Your Meal Prep code: <b>{{ .Token }}</b></p>`
   The app signs in with this code, not the link. On iPhone and iPad, a Home Screen app keeps its own storage separate from Safari, so tapping a magic link would sign in Safari instead of the app.
5. **Project Settings → API Keys**: copy the Project URL and the publishable key (or legacy anon key).

### 2. Push keys
1. Open `tools/vapid-keys.html` (from GitHub Pages once deployed, or any browser) → Generate keys.
2. Keep the private key private. It goes in Supabase secrets only, never in the repo.

### 3. Fill in CONFIG in `index.html`
```js
SUPABASE_URL: 'https://YOUR-REF.supabase.co',
SUPABASE_KEY: 'your publishable key',
VAPID_PUBLIC_KEY: 'the public key from step 2',
PLAN_START: '2026-10-05',   // the Monday after your first prep day
```
The publishable key is meant to be public; row-level security keeps each account's rows private. `PLAN_START` is the Monday that counts as Week A, Day 1; you can also change it later under Settings → Plan start.

### 4. Reminder function
1. **Edge Functions → Deploy a new function → Via Editor**. Name it `meal-reminders`, paste `supabase/functions/meal-reminders/index.ts`, deploy.
2. In the function's settings, turn **off** JWT verification. The function checks its own secret for cron calls and verifies your login for test sends.
3. **Edge Functions → Secrets**, add:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (from step 2)
   - `VAPID_SUBJECT` = `mailto:you@yourdomain.com`
   - `CRON_SECRET` = a long random string (a password manager's generator works)

### 5. Schedule it
1. **Database → Extensions**: enable `pg_cron` and `pg_net`.
2. SQL Editor: open `supabase/02_cron.sql`, replace the project URL and the `CRON_SECRET` placeholder, Run.

### 6. GitHub Pages
1. New repo (e.g. `meal-prep`), upload everything keeping the folders.
   On iPad, make a folder by using **Add file → Create new file** and typing `icons/README.md`, then open the folder and **Upload files** into it.
2. **Settings → Pages**: deploy from the `main` branch, root.
3. The app lives at `https://jrharper98.github.io/meal-prep/`.

### 7. Install on each device
1. Open the URL in Safari → Share → **Add to Home Screen**. Open it from the Home Screen icon from now on.
2. **Settings tab → Sync account**: enter your email, tap *Email me a code*, type the code.
3. **Nightly reminder**: pick a time, tap *Turn on reminders*, allow notifications, then *Send a test*.
4. Repeat on the other device with the same email.
5. After both devices are signed in, you can turn off **Allow new users to sign up** in Supabase Auth settings.

## How sync works
- Every checkbox, log entry, job toggle and setting is one row in `mp_kv`.
- Changes save on the device first, then upload when online. The newest change wins per item.
- Each device pulls anything newer when the app opens, comes back online, or every minute while it's open.

## Updating the app
1. Make the change in `index.html` (small edits, not rebuilds).
2. Bump `APP_VERSION` in `index.html` **and** `CACHE` in `sw.js` so installed apps pick up the new files.
3. Before uploading:
   ```
   npm install
   npm run check   # node --check on the extracted app JS and sw.js
   npm test        # jsdom behavioral tests
   ```
4. If the reminder wording changes, update both `tonightLines()` in `index.html` and `tonightMessage()` in the function. A test checks that they agree on the day.

## Troubleshooting
- **Reminder button is greyed out on iPhone/iPad**: open the app from the Home Screen icon, not Safari. Web push needs iOS/iPadOS 16.4 or later.
- **Test notification fails**: check **Edge Functions → meal-reminders → Logs**. The function uses `npm:web-push` under Deno; if it reports a crypto error, that's the piece to swap.
- **No nightly reminder**: `select * from cron.job_run_details order by start_time desc limit 10;` and `select * from net._http_response order by created desc limit 10;`
- **Sync badge says "Sync problem"**: Settings tab shows the error. Your changes stay queued on the device until it succeeds.
