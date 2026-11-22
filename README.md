# Project All Star

A white-label visibility tool for small and medium gyms, sports arenas, fitness centres and kids' coaching academies in India. Owners, coaches and customers (members, and parents for kids) get one shared view of sessions, attendance, progress and follow-ups, each in their own screens. It is a visibility tool: it shows what was delivered and how members are progressing, in positive terms. See `CLAUDE.md` for the standing project rules.

Mobile-optimized web app (no native app, no install). Each business sets its own name, logo and colours; the product carries no builder branding. Screens are in English, Hindi and Kannada.

Status: Sprint 2, POC complete pending review. Every role has working screens backed by the real API and database. Click-through demo: `docs/DEMO.md`. Manual test guide and automated suites: `docs/TESTING.md`. Data model: `docs/DATA_MODEL.md`. Dependency licences: `docs/THIRD_PARTY.md`. Contract: `docs/api/openapi.yaml`. Plan and formulas: `docs/PLAN-POC.md`. Open items: see "Known limitations and open decisions" below.

## Stack

Next.js (App Router) and TypeScript, React 19, Postgres 16 with Prisma 6, `tenant_id` on every table, Vitest and Playwright for tests. Dev deployment on Vercel (Hobby) with Neon Postgres (Singapore). No UI or i18n library: the design system, SVG charts and the three-language layer are our own code.

## Run locally from a clean checkout

Prerequisites: Node 22 (`.nvmrc`; run `nvm use`), npm, and Docker (for the local Postgres 16 container).

```
git clone <repo-url> && cd <repo>
nvm use
npm install          # also runs `prisma generate` (postinstall)
npm run db:up        # Postgres in Docker, waits until healthy
npm run setup        # creates .env from .env.example if missing, db:up, prisma generate, prisma migrate deploy
npm run db:seed      # rich demo seed: 3 tenants with plans, logs, goals, bookings, about 12 weeks of history
npm run start:local  # setup again (harmless) and then the dev server
```

`npm run setup` already does `db:up`, so the first two commands can be one. In short: `npm install`, `npm run setup`, `npm run db:seed`, `npm run dev` (or `npm run start:local`, which is `setup` plus `dev`).

The app is at http://localhost:3000 (health check: http://localhost:3000/api/health). Outside production the demo pickers (Business and View as) are visible, so you can look at every role without signing in. Walkthrough: `docs/DEMO.md`.

What `npm run db:seed` does (`prisma/seed/index.ts`): upserts the three demo tenants (base layer) and then rewrites the rich layer (plans, assignments, workout logs, goals, about 12 weeks of sessions and attendance, upcoming sessions with bookings and a waitlist, coach availability, booking settings, the updates feed, members who joined and left). It also loads the exercise catalog into each tenant if missing. All dates are relative to today in Asia/Kolkata; set `SEED_TODAY=YYYY-MM-DD` to pin the anchor date. It is safe to re-run. Time: about 1 to 10 seconds locally depending on the machine (9 s on a 2026-11-22 check against a fresh empty database), about 40 s against a remote database. `npm run db:import-exercises` (optional, safe to re-run) re-imports only the catalog (902 exercises per tenant: 876 gym entries from free-exercise-db plus our own drafts); `npm run db:import-exercises -- demo-gym` limits it to one tenant.

Both seed scripts refuse to write to a non-local database unless `SEED_ALLOW_REMOTE=1` is set on purpose. Only ever use it with fake data.

Verified on 2026-11-22 from a fresh `npm ci` against an empty scratch database on the shared local Postgres container: `prisma migrate deploy` applies all 9 migrations, `npm run db:seed` prints `Seeded 3 demo tenants (with plans, logs, goals, bookings) in 8.7s.`, `npm run db:import-exercises` upserts 902 exercises per tenant. The container start itself (`npm run db:up`) was not re-run in that check because a Postgres container was already running; it is covered by `scripts/setup.mjs` and `docker-compose.yml`.

Node note: the repo is pinned for Node 22 LTS. It was also exercised on Node 23.11 with no problems, but use 22.

### Stopping and resetting

```
npm run db:down          # stop Postgres (data stays in the pgdata volume)
docker compose down -v   # also delete the data, to start from an empty database
```

## Environment variables

`.env.example` holds the local defaults (nothing secret). Real values for a hosted environment are set in the host's settings (Vercel), never in the repo.

| Variable | Used for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Prisma connection string | Local default in `.env.example`. On Vercel use the Neon pooled (`-pooler`) URL for the app with `pgbouncer=true&connection_limit=5` appended (the app logs a names-only warning at start-up if these are missing). `PERF_LOG=1` prints one `PQ <ms>` line per query for counting queries per page. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | The local Docker Postgres (`docker-compose.yml`) | Local only. |
| `APP_BASE_URL` | Origin used to build magic links (`<APP_BASE_URL>/auth/magic?token=...`) | Defaults to `http://localhost:3000`. Set it to the public URL on a hosted environment, or links point at localhost. |
| `DEMO_MODE` | `true` keeps the Business / View as demo pickers visible in production | Outside production the pickers are always on. Turn `DEMO_MODE` off before any real customer data is added. |
| `SEED_ALLOW_REMOTE` | `1` lets `db:seed` and `db:import-exercises` write to a non-local database | Deliberate override; fake data only. |
| `SEED_TODAY` | `YYYY-MM-DD` anchor date for the rich seed | Optional; default is today in Asia/Kolkata. |
| `NEXT_PUBLIC_*` | Browser-visible settings | None are used by the code today. If one is ever added it is public by definition: never put a secret in a `NEXT_PUBLIC_` variable. |

Test-only variables (`E2E_*`) are listed under "Tests".

## Signing in

There are no passwords. Sign-in is by magic link, meant to be shared by hand (for example on WhatsApp). Nothing is sent automatically in the POC.

- A link looks like `<APP_BASE_URL>/auth/magic?token=...`. It works once and expires after 15 minutes. Only a hash of the token is stored.
- Opening it in a browser signs that browser in. The session lives in httpOnly cookies (`as_access`, `as_refresh`): the access token lasts 1 hour and the refresh token 30 days, rotated by `proxy.ts` when the access cookie has expired. The shell has a Sign out button. Without a session (and with demo mode off) visitors are sent to `/sign-in`, which explains where to find a link.
- A link is for one user in one business. A wrong tenant or email does not produce a link.

How to get a link:

1. In the app (the real way): sign in as the owner or a coach, open a member (Members, then the member), and use "Create sign-in link". It shows the link once with a copy button. For a child it creates the link for the parent or guardian. A coach can do this only for members in their own batches.
2. In development, with the dev route (only outside production; it answers 404 when `NODE_ENV=production`):

```
curl -s -X POST http://localhost:3000/api/v1/dev/magic-link \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"demo-gym","email":"owner@demo-gym.example.test"}'
```

   The reply is `{"url":"...","expiresAt":"..."}`; open `url` in a browser. The server console also prints it.
3. On a hosted (production-mode) environment the dev route is off. Use a one-off script from your laptop with `DATABASE_URL` pointed at the target database and `APP_BASE_URL` set to the public URL. Save this as `make-link.ts` in the repo root (do not commit it) and delete it afterwards:

```ts
import { PrismaClient } from "@prisma/client";
import { createMagicLink } from "./lib/auth/magic-link";

async function main() {
  const [slug, email] = process.argv.slice(2);
  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
    const user = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, email } });
    const link = await createMagicLink(user.id, tenant.id);
    console.log(link.url, link.expiresAt.toISOString());
  } finally {
    await prisma.$disconnect();
  }
}
main();
```

   Run it with `DATABASE_URL=... APP_BASE_URL=https://your-app.example npx tsx make-link.ts demo-gym owner@demo-gym.example.test`. The link is a credential until it is used or expires: treat it like a password, and do not paste it into docs, tickets or chats.

For API testing, exchange the token for tokens with `POST /api/v1/auth/magic-link/exchange` (body `{"token":"..."}`); the reply has an access token for `Authorization: Bearer ...`. Phone OTP is in the contract but not built.

## Roles and what each sees

The hierarchy is fixed: owner, coach, customer. The tenant and role always come from the session, never from the URL or a request body. A role that opens another role's address sees "not available for your role".

| Role | Bottom navigation | What they see |
| --- | --- | --- |
| Owner | Dashboard, Members, Batches, Workouts, Settings (Coaches is reached from the dashboard quick links and from Settings) | Whole business: KPIs and charts (members, retention, sessions scheduled vs completed, attendance and no-show patterns, workout adherence, fee status display, bookings), friendly check-ins, renewal alerts with recent attendance, sessions without a roll call; member table and detail; batches; coaches with workload; booking rules; CSV import. |
| Coach | Today, Members, Plans, Workouts, My record | Own sessions (today, week, availability), roll call with offline queue, schedule a session; own members (roster, goals, plans, sign-in link); workout plans and assignment; own delivered-sessions record. Only members in the coach's own batches. |
| Customer (member or parent) | Home, Workouts, Schedule, Progress, Profile | Own record, or the linked child's: today's workouts with start, stop and complete (works offline), updates feed, class schedule with booking, waitlist and cancel, progress (level, goals, attendance, streaks, achievements, history), profile. A parent sees the child; the child has no login. |

Demo accounts (all `*.example.test`): see `docs/DEMO.md`.

## Tests

DB-backed tests need `DATABASE_URL` in the environment. Vitest does not read `.env`, so without it those tests print a `[skip]` line and the run still shows green. Use a scratch database: the tests write their own fixtures and expect the demo tenants.

```
export DATABASE_URL="postgresql://allstar:allstar_local_dev@localhost:5432/allstar?schema=public"
npm run typecheck
npm run lint
npm test                 # all of Vitest (runs test files one at a time: fileParallelism is off in vitest.config.ts)
npm run test:isolation   # tenant isolation, role matrix and data-flow suites
npm run test:e2e         # Playwright (all e2e/*.spec.ts)
```

Playwright details:

- It creates and drops its own scratch database (default `allstar_e2e_smoke`), migrates and seeds it, and starts `next dev` on port 3211. It refuses non-local hosts. Set `E2E_DB_NAME` (must contain `e2e`) and `E2E_PORT` to run several spec files at once without clashing, for example `E2E_DB_NAME=allstar_e2e_qa75 E2E_PORT=3275 npx playwright test e2e/cross-role.spec.ts`.
- `E2E_WEBPACK=1` runs the dev server with `--webpack`. Use it if Turbopack dev loops on hot reload on your machine (seen locally during Sprint 2).
- If you ran `npm run build`, delete `.next` before the e2e run (`rm -rf .next`); a production build in `.next` conflicts with `next dev`.
- Browsers: Playwright 1.65 cannot download browsers on some macOS versions (for example macOS 13), so the default is your installed Google Chrome (`E2E_BROWSER_CHANNEL=chrome`). On CI, or without Chrome, run `npx playwright install chromium` once and set `E2E_BROWSER_CHANNEL=chromium`.

More commands: `npm run build`, `npm run db:migrate` (create a migration in dev), `npm run db:deploy` (apply migrations), `npm run db:generate`. Full suite breakdown and the manual test guide: `docs/TESTING.md`.

## API contract

`docs/api/openapi.yaml` (OpenAPI 3.0.3, v0.2.0) is the contract that Backend and Frontend build against; the conventions (tenant from the session, roles in `x-roles`, cursor pagination, error shape) are at the top of that file. Role access is enforced on the server (`lib/auth/policy.ts`) and checked against the contract for every operation by `tests/api-matrix.test.ts`.

Known differences between contract and code:

- In the contract but not implemented: `POST /auth/otp/request` and `POST /auth/otp/verify` (phone OTP).
- Implemented but not in the contract: `POST /api/v1/dev/magic-link` (development only, 404 in production), and the same-origin UI bridges `/ui/members-import` and `/ui/workout-log` that add the session cookie for the browser.

## Hosting (dev deployment)

These are the current facts, recorded as a Proposed decision in Notion ("Proposed: tech stack"), not an accepted one.

- App on Vercel (Hobby plan). Database on Neon Postgres, Singapore region.
- Set `DATABASE_URL` (Neon pooled URL), `APP_BASE_URL` (the public https URL) and, for a demo site, `DEMO_MODE=true` in Vercel's Environment Variables only. None of these values belong in the repo, `.env.example`, docs, commits or chats.
- The build does not run migrations. Apply them by hand from a laptop with `prisma migrate deploy` (`npm run db:deploy`), with `DATABASE_URL` in that shell set to the Neon unpooled (direct) connection string, because migrations should not go through the pooler.
- Seeding a hosted demo database: with `DATABASE_URL` set to the target, run `SEED_ALLOW_REMOTE=1 npm run db:seed`. It takes about 40 seconds remotely. Only with fake data, and unset the variable afterwards.
- Vercel's Hobby plan is for non-commercial use. Before any real paying customer or commercial pilot the plan or the host has to change; that is a human decision (cost and data-residency questions are open in Notion).
- In production the demo pickers are hidden unless `DEMO_MODE=true`, and `POST /api/v1/dev/magic-link` always answers 404. To sign in on a hosted site, use "Create sign-in link" from an owner or coach session, or the one-off script above.
- The seed refuses non-local databases without `SEED_ALLOW_REMOTE=1`; do not set that variable in Vercel.

## Project structure

| Path | What is there |
| --- | --- |
| `app/[role]/...` | Role screens: dashboard, members and member detail, import, batches, coaches, settings, today / week / availability, sessions (roll call, schedule), plans, record, home, workouts, exercise, updates, schedule, progress, profile |
| `app/api/v1/` | The API (route handlers; thin wrappers over `lib/api`) |
| `app/auth/`, `app/sign-in/`, `app/ui/` | Magic-link landing and cookie routes, sign-in-needed page, same-origin bridges for import and workout logging |
| `proxy.ts` | Access-token refresh from the refresh cookie |
| `components/` | `ui/` design system, `charts/` SVG chart kit, `owner/`, `coach/`, `customer/`, `member/`, `plans/`, `sessions/`, shell |
| `lib/` | `api/` (domain functions), `auth/` (tokens, policy, principal), `analytics/`, `customer/`, `members/`, `plans/`, `sessions/`, `offline/` (roll-call and workout queues), `workouts/` (schedule expansion), `import/` (CSV), `i18n/` (en, hi, kn), `tenant-scope.ts`, `nav.ts` |
| `prisma/` | `schema.prisma`, `migrations/`, `seed/` (base and rich demo layers), `catalog/` (exercise import) |
| `data/` | Exercise catalog sources: `free-exercise-db` (Unlicense) and our own drafts |
| `tests/`, `e2e/` | Vitest suites and Playwright specs |
| `docs/` | `api/openapi.yaml`, `DATA_MODEL.md`, `DEMO.md`, `TESTING.md`, `THIRD_PARTY.md`, `PLAN-POC.md` |
| `scripts/` | `setup.mjs`, `fetch-free-exercise-db.mjs` |

Hindi and Kannada strings are our own drafts and are marked "needs native-speaker review".

## Known limitations and open decisions

- Parent OTP sign-in is not built. The contract has `requestOtp` and `verifyOtp`; today parents sign in with a magic link created by the owner or a coach. The standing rule is that parent accounts are verified by OTP, so this is open.
- The workout assignment UX (plan builder, assign sheet, member Workouts screens) was built on the project owner's explicit instruction. It remains a Proposed decision, pending the trainer interviews, and may change.
- DPDP parental consent: whether sports academies are exempt from verifiable parental consent for children's data is an open legal question for a lawyer. The consent flow is a Proposed decision, not built. The demo uses only fake data and no photos.
- Hindi and Kannada text is a draft and needs native-speaker review (the app shows a banner on those languages).
- Vercel Hobby is non-commercial use only; a commercial pilot needs a different plan or host. Not decided.
- Fee status is display only: marked by hand (cash or UPI), no payment processing, no amounts tracked.
- Hourly versus daily-streak achievements: the data supports both; which one the product shows is undecided.
- Exercise images are not used (licence of the upstream photos is unclear). Exercises are text only.
- Not scheduled yet: parent weekly progress card (shareable image or page), coach credential badges (owner-verified) on the coach directory, holiday calendar editor (holidays exist in the data and are honoured by the rules; there is no screen to edit them), UI for pre-declared excused absences (the table exists; excused absences are recorded in the roll call today).
- The `/[role]/[section]` fallback screen shows a placeholder for any section without its own page; none of the bottom-navigation items uses it.
