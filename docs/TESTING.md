# Testing guide

Two parts: the manual click-through (what to check by eye, by role) and the automated suites (what runs in the terminal and how). All data is fake (`Sample ...`, `*.example.test`). The demo script with accounts is `docs/DEMO.md`; this guide says what to verify.

## Part 1: manual test guide

### Setup

Local (no sign-in needed, pickers visible): follow the README ("Run locally from a clean checkout"): `npm install`, `npm run setup`, `npm run db:seed`, `npm run dev`, then open http://localhost:3000 at about 390 px width.

Hosted demo site: in Vercel, Settings, Environment Variables, add `DEMO_MODE` = `true` (Production), then redeploy, and seed the database once (README, "Hosting"). Turn `DEMO_MODE` off again before any real customer data is added. With demo mode off, visitors without a session see "Please sign in", and you sign in with a magic link (below).

Pickers (top of the page): **Business** (three demo businesses), **View as** (Owner, Coach, Member / Parent), **Language** (English, Hindi, Kannada). Bottom bar: the screens of the current role.

### Cross-cutting checks (do these for every role)

- Switch Business: name, logo and colours change; no builder branding appears; people from one business never show in another.
- Switch role: you see only that role's screens. Typing another role's address (for example `/owner/dashboard` as Coach) shows "This screen is not available for your role".
- Switch language to Hindi and Kannada: strings change and a "needs native-speaker review" banner shows. Switch back.
- Phone width (360 px): no sideways scrolling on any main screen; buttons are easy to tap; focus is visible with the keyboard.
- Loading, empty and error states are readable (try a filter with no results, or stop the server and reload a data screen).
- Wording is positive and about visibility and progress; nothing shames or penalises a member.

### Owner

Use `demo-gym` (cost display on) and `demo-karate`.

- **Dashboard.** Range chips (7, 30, 90 days) change the numbers and charts. KPI tiles: active members, new members, retention, attendance, no-show rate, sessions completed of scheduled, workout adherence, engagement; each shows the change against the previous period. Verify: numbers are plausible and not negative or over 100 percent; charts have text alternatives and labels; "Not enough data yet" appears instead of 0 where there is no data; fee donut says it is display only; bookings ring shows seats, waitlist and cancelled; coach workload rows link to coaches; Insights, Friendly check-ins, Renewal alerts (with attendance) and Sessions without a roll call lists render; quick links work.
- **Members.** Table with batch, level, fees, attendance; search and filters; open a member: charts, level, goals, plan, recent attendance, updates; fee status says display only. Owner can see every member of this business and none of another.
- **Batches.** Cards with sport, venue, coach, schedule, places filled; venue and sport filters; clear filters.
- **Coaches** (dashboard quick link or Settings). Sorting by name, members, workload, upcoming; workload band wording (room for more, well balanced, fully booked); open a coach for their stats and availability.
- **Workouts.** 902 exercises; search, filters (muscle, equipment, level, sport), paging; open one for the steps; karate, yoga and dance drafts say "Draft: needs trainer review"; no images.
- **Settings.** Brand details are read-only. Booking rules: cancellation window accepts 0 to 2880 whole minutes (try -1, 3000, 12.5, empty: each gives a clear message), the waitlist toggle and the missed-session-cost toggle save; reload shows the saved values; a coach or customer cannot change them.
- **CSV import.** `public/sample-members.csv`: Check shows totals, preview, notes; Import adds members; running it again adds nobody ("Already in your list"). A file over 2 MB, a non-CSV file, a file without a name column, and a row without a name each give a plain-language message with row and column. Imported members appear in Members and never in another business.

### Coach

Use `demo-karate` as c1 (kids) and `demo-gym` as c1.

- **Today / Week / Availability.** Today lists sessions with status, booked count and waitlist; earlier sessions without a roll call are flagged. Week navigates previous and next. Availability: add, edit and remove hour ranges; overlapping or backwards times are rejected with a message; save persists.
- **Schedule a session.** Batch session and one-on-one; a session outside availability or overlapping another gets a heads-up or an error; capacity and title are optional; the new session appears in Today or Week; members see it in their updates.
- **Roll call.** One tap per member changes status; "Mark everyone present"; Excused needs a reason (exam, illness, festival, travel); a session note saves; Complete session works only when someone is marked. Waitlisted members are listed apart. A cancelled or completed session cannot be edited; reschedule and cancel ask for confirmation and tell members.
- **Offline roll call.** With the browser offline, taps stay on the device ("n changes saved on this device"), rows say "Waiting to sync"; reload the page offline and the taps are still there; going online syncs them in order with no duplicates; Complete needs a connection and says so. If the server already has a different mark, the problem is listed and can be discarded.
- **Plans.** Create a daily, a weekly and a monthly plan; add exercises from the library with sets, reps or duration, and rest (invalid numbers are refused); save as draft; edit a plan (a second tab editing the same plan shows "Someone changed this plan"); assign to members (start date, optional end date, note); archive (assigned members stop seeing it).
- **Members.** Only members of the coach's own batches; filters (batch, status, check-in suggested); open a member: charts, plan, goals. Create a goal with a target, add a check-in, mark achieved. Another coach's member shows "This member is not one of yours".
- **Sign-in link.** Create sign-in link on a member shows a link once with Copy; for a child it is for the parent. A member with no login account says so. A coach cannot create one for a member outside their batches.
- **My record.** Switch 30 and 90 days; sessions scheduled and completed, waiting to be logged, consistency, attendance, adherence, goals and promotions; chart; recent sessions open the roll call. Numbers move after a roll call.

### Customer (member or parent)

Use `member-m1` in `demo-gym` or `parent-g1` in `demo-karate`.

- **Home.** Today's workouts, next session (Booked or On the waitlist), What's new with unread count, last 30 days (streak and level). With no plan: "Your coach has not shared a plan yet".
- **Workouts.** Start, Stop and Complete per exercise; status changes; reload keeps it; offline taps queue ("Saved on this phone") and sync on reconnect without duplicates; future days cannot be started; exercise detail shows steps.
- **Updates.** Everything the coach did (plan assigned or edited, goal, session scheduled, rescheduled or cancelled, booking confirmed, promoted from the waitlist) appears, newest first, and is marked read on opening. No other member's name appears.
- **Schedule.** Week and month views; Book; full class shows Join waiting list with a position; cancel inside the window works and a late cancel is refused with an explanation; waitlisted member is promoted when a place opens; holidays and cancelled sessions are explained; attendance history lists attended, missed and excused with the reason.
- **Progress.** Level ring, goals with percent and check-ins, attendance streaks, workouts completed versus pending, achievements, history. Excused absences and holidays never show as missed. The missed-session cost note shows only where the owner turned it on.
- **Profile.** Own details, sign out. A parent sees the child's data and not other children's.

### Sign-in checks

- Create a link (member detail, or the dev route in README), open it in a private window: you land signed in as that user, in that business only.
- Open the same link again: "This link cannot be used" (single use). Wait 15 minutes or use an old link: same message.
- Sign out: back to the sign-in-needed page (demo mode off) or the pickers (demo mode on). The back button does not restore the session.
- A link for the wrong business or email is never produced.

## Part 2: automated suites

Prerequisites: Postgres running (`npm run db:up`), dependencies installed, and a migrated and seeded database in `DATABASE_URL`. Vitest does not read `.env`, so export it. Without `DATABASE_URL` the DB-backed tests print `[skip]` and the run still looks green; do not count that as a pass.

```
export DATABASE_URL="postgresql://allstar:allstar_local_dev@localhost:5432/allstar?schema=public"
npm run typecheck
npm run lint
npm test
npm run test:isolation
npm run test:e2e
```

### Vitest (`npm test`)

All of `tests/**/*.test.ts`, run one file at a time (`fileParallelism: false` in `vitest.config.ts`, because DB-backed files share one database and the same demo tenants). Last full run on 2026-11-22: 46 files, 772 tests passed, about 50 seconds, against a freshly migrated and seeded scratch database. Groups:

| Area | Files |
| --- | --- |
| Schema and tenancy | `schema-tenancy`, `tenant-scope`, `attendance-schema`, `progress-schema`, `plans-schema` (CHECK constraints, partial unique index, scoped models) |
| Seed | `seed`, `seed-rich-qa` (rich seed privacy, idempotency, query counts) |
| Auth and access | `auth-policy` (52 operations vs contract), `auth-access`, `magic-link`, `member-magic-link`, `guard`, `privacy` |
| Contract, isolation and role matrix | `isolation`, `read-endpoints`, `api-matrix` (every operation, 9 actors, both tenants, leakage and cross-tenant writes), `api-dataflow` (cross-role flows), `contract-schema` helper |
| Domain APIs | `plans-api`, `workout-expand`, `sessions-write-api`, `bookings-api`, `progress-api`, `member-updates`, `analytics`, `members-import-api`, `exercise-catalog` |
| UI logic (pure functions, no browser) | `dashboard-view`, `members-view`, `owner-coaches-view`, `customer-*`, `rollcall-offline`, `sessions-form`, `plans-form`, `charts`, `import`, `import-fixtures`, `i18n`, `nav`, `theme`, `theme-ui`, `ui`, `slug`, `auth-landing` |

Run one file: `npx vitest run tests/bookings-api.test.ts`.

### Isolation subset (`npm run test:isolation`)

Tenant isolation, role access, auth, theme, import API, scoping, the role matrix and the cross-role data flow: `isolation`, `read-endpoints`, `auth-access`, `auth-policy`, `theme`, `members-import-api`, `magic-link`, `tenant-scope`, `api-matrix`, `api-dataflow`. Run it after any change to an endpoint, a role or `lib/tenant-scope.ts`.

### Playwright end to end (`npm run test:e2e`)

Specs in `e2e/`: `smoke` (shell, tenant and role switching, magic-link sign-in in the browser, route guards), `owner-dashboard`, `owner-coaches`, `owner-import`, `coach-sessions` (roll call), `coach-plans`, `coach-members`, `customer-workouts`, `customer-schedule`, and `cross-role` (15 tests: three real magic-link browser contexts walk the plan, session, booking, goal, import, role-guard, offline, console and network hygiene and navigation sweeps at 1280 and 360 px, scenarios of `docs/DEMO.md` Part 6). Every cross-role test asserts there are no console errors or failed requests.

How it works: Playwright starts `e2e/run-server.ts`, which drops and recreates a scratch database, runs `prisma migrate deploy`, `db:seed` and `db:import-exercises` on it, and serves the app with `next dev` (not `next start`, because the dev magic-link route answers 404 in production mode) with `DEMO_MODE=true`. It refuses non-local hosts and never reads `.env` or `DATABASE_URL`, so it cannot touch a real database. The scratch database is dropped afterwards.

Environment variables:

| Variable | Meaning | Default |
| --- | --- | --- |
| `E2E_DB_NAME` | Scratch database name; must contain `e2e` | `allstar_e2e_smoke` |
| `E2E_PORT` | Dev server port | `3211` |
| `E2E_WEBPACK` | `1` runs `next dev --webpack` (use if Turbopack dev loops on hot reload) | off |
| `E2E_BROWSER_CHANNEL` | `chrome` (installed Google Chrome) or `chromium` (after `npx playwright install chromium`) | `chrome` |
| `E2E_ADMIN_URL` | Admin connection used to create the scratch database (local only) | local `postgres` database with the `.env.example` credentials |

Rules of thumb:

- Run the whole suite as shards with `scripts/e2e-sharded.sh` (six shards, each with its own dev server and scratch database; ux-audit excluded). One `playwright test` over every spec keeps a single `next dev` alive while it compiles every route; on an 8 GB machine Next then restarts it ("approaching the used memory threshold") or it dies, and the rest of the run fails with ECONNRESET, ERR_CONNECTION_REFUSED or pages stuck on Loading.
- Open POC mode versus sign-in: the harness runs with `POC_OPEN` unset, so the demo role cookie decides the role and another role's screens are refused. Run `POC_OPEN=true npx playwright test e2e/smoke.spec.ts -g "\(d\)"` to check open mode (the URL decides the role, every screen opens).
- The default `expect` timeout is 30 s because the first visit to a route compiles it in `next dev`.
- `e2e/ux-new-screens.spec.ts` is the short audit of the workout-engine screens (360 px, en and hi: axe, overflow, touch targets, focus); `e2e/ux-audit.spec.ts` is the full 40 minute crawl.

- To run one spec, or several specs at the same time, give each its own database and port: `E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_qa75 E2E_PORT=3275 npx playwright test e2e/cross-role.spec.ts`.
- Delete `.next` between `npm run build` and the e2e run (`rm -rf .next`): a production build in `.next` conflicts with `next dev`.
- The first run compiles every route on demand, so it is slow; a timing flake on a cold compile passes when re-run alone.
- Playwright 1.65 cannot download browsers on some macOS versions (for example macOS 13); use installed Chrome there.
- Playwright traces for failures are kept under `test-results/`.

### Speed budgets (STAR-93)

Three guards, so a slow page fails CI instead of being found by hand:

- `Server-Timing` header: `proxy.ts` adds `Server-Timing: proxy;dur=<ms>` to every page response (see `lib/server-timing.ts`; metric name and a number only, no ids or URLs). It covers the time in the proxy. A streamed page sends its headers before the body finishes, so a true end-to-end render time cannot be in a header; the Playwright spec measures that from outside.
- `tests/query-budget.test.ts` (vitest, needs the seeded `DATABASE_URL`): renders owner dashboard, members, workouts, coach today, members and customer home, workouts through the root and role layouts with every Prisma query counted (cold cache, open POC mode faked), and fails if a page exceeds its budget. Budgets sit about 20 percent above the measured count. `QB_DEBUG=1 npx vitest run tests/query-budget.test.ts -t "customer home"` prints each query to find what grew. Measured on 2026-11-23: owner dashboard 40, members 25, workouts 8; coach today 21, members 25; customer home 50, workouts 41. STAR-102 fixed a harness bug (the request-cache emulation threw on the Prisma client, so some dashboard panels never ran and the dashboard count was understated) and added the later screens; measured 2026-11-26: owner dashboard 62, members 25, workouts 8; coach today 21, members 25; customer home 44 (was 85), workouts 38 (was 71), live workout 19, classes 11, progress exercises 15 (was 84), progress skills 12, exercise progress 13, history 14, how-to 13 (was 23), owner insights 11, plan results 16, plan send 21.
- `e2e/perf-budget.spec.ts` (Playwright): per page, the median of 3 warm requests must stay under an HTML size and a time-to-first-byte ceiling, and the response must carry a well-formed `Server-Timing`. Run it alone: `E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_perf93 E2E_PORT=3293 npx playwright test e2e/perf-budget.spec.ts` (`rm -rf .next` first if a build ran). It runs against `next dev`, so sizes include dev-only scripts; measured 199 KB dashboard (budget 250), 53 owner members, 70 owner workouts, 33 coach today, 48 coach members, 38 customer home, 63 customer workouts, all first bytes under 0.4 s. STAR-102 added live workout 41 KB, classes 24, progress exercises 60, skills 26, exercise progress 51 / history 71 / how-to 38, owner insights 36, plan results 29, plan send 36. About 150 KB of the dashboard figure is the dev-only flight debug data (`D` chunks), which a production build does not ship; the document itself is about 56 KB. Never raise a ceiling to get a green run; find what grew.

### Before declaring a change done

`npm run typecheck`, `npm run lint`, `npm test` with `DATABASE_URL` set, the relevant e2e spec, and `npm run build` (then `rm -rf .next` before any e2e run).
