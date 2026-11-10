# Project All Star

White-label visibility tool for gyms, arenas and coaching academies. It gives owners, coaches and customers (members, and parents for kids) a shared view of sessions, attendance and progress. See `CLAUDE.md` for the standing project rules.

Status: Sprint 1 first vertical slice. The API and database are real; the screens are placeholders; sign-in by magic link is real. Read "What is real and what is mock" before demoing. Demo walkthrough: `docs/DEMO.md`. Dependency licences: `docs/THIRD_PARTY.md`.

## Run locally from a clean checkout

Prerequisites: Node 22 (`.nvmrc`; run `nvm use`), npm, and Docker (for the local Postgres 16 container).

```
git clone <repo-url> && cd <repo>
nvm use
npm install          # also runs `prisma generate` (postinstall)
npm run start:local  # setup + dev server
```

`npm run start:local` runs `npm run setup`, then `npm run dev`. `setup` (`scripts/setup.mjs`):

1. copies `.env.example` to `.env` if `.env` is missing (local-only values, nothing secret),
2. starts Postgres in Docker (`npm run db:up`, waits until healthy),
3. runs `prisma generate` and `prisma migrate deploy`.

The app is then at http://localhost:3000 (health check: http://localhost:3000/api/health). The database starts empty, so load the demo data in a second terminal:

```
npm run db:seed              # three demo tenants with fake users, members, batches, sessions
npm run db:import-exercises  # exercise catalog into every tenant (876 gym + our draft sports)
```

Both are safe to re-run (upserts). Both refuse to write to a non-local database unless `SEED_ALLOW_REMOTE=1` is set on purpose. `npm run db:import-exercises -- demo-gym` limits the import to one tenant.

Verified on 2026-11-10 from a fresh `npm ci` against an empty scratch database: migrations apply, seed prints `Seeded 3 demo tenants.`, the catalog import upserts 902 exercises per tenant. The one thing not re-run on that date was `npm run db:up` itself (Docker was already running a Postgres), so the container start in `setup` is verified only by reading the script and `docker-compose.yml`.

Node note: the repo is pinned for Node 22 LTS. It was also exercised on Node 23.11 with no problems, but use 22.

### Stopping and resetting

```
npm run db:down          # stop Postgres (data stays in the pgdata volume)
docker compose down -v   # also delete the data, to start from an empty database
```

## Tests

DB-backed tests need `DATABASE_URL` in the environment. Vitest does not read `.env`, so without it those tests print a `[skip]` line and the run still shows green. For a real run:

```
export DATABASE_URL="postgresql://allstar:allstar_local_dev@localhost:5432/allstar?schema=public"
npm run typecheck
npm run lint
npm test                 # all of Vitest (216 tests at the time of writing)
npm run test:isolation   # tenant isolation, role access, auth, theme, import API (132 tests)
npm run test:e2e         # Playwright smoke test (16 tests, one is an expected failure)
```

- Use a scratch database if you do not want tests touching your seeded one; the tests write their own fixtures.
- `npm run test:e2e` needs no `DATABASE_URL`. It creates and drops its own database `allstar_e2e_smoke` on the local Postgres (`localhost:5432`, user `allstar`), seeds it, starts `next dev` on port 3211 and runs against that. It refuses non-local hosts. Chrome note: Playwright 1.65 cannot download browsers on some macOS versions (for example macOS 13), so the test defaults to your installed Google Chrome (`E2E_BROWSER_CHANNEL=chrome`). On CI, or if you have no Chrome, run `npx playwright install chromium` once and set `E2E_BROWSER_CHANNEL=chromium`.
- The "UI sign-in by magic link (documented gap)" test is marked as an expected failure (`test.fail`) because the landing page for magic links does not exist yet. Playwright counts it as passed and prints it with a cross. When that page ships, the test goes red until the `.fail()` line is removed.

Other commands: `npm run build`, `npm run db:migrate` (create a migration in dev), `npm run db:deploy` (apply migrations), `npm run db:generate`.

## API contract

`docs/api/openapi.yaml` (OpenAPI 3.0.3) is the contract that Backend and Frontend build against; the conventions (tenant from the session, roles in `x-roles`, cursor pagination, error shape) are at the top of that file. Data model notes: `docs/DATA_MODEL.md`.

The contract is ahead of the code in places and the code is ahead of the contract in two:

- In the contract but not implemented: `POST /auth/otp/request` and `POST /auth/otp/verify` (phone OTP).
- Implemented but not in the contract: `POST /api/v1/dev/magic-link` (development only, returns 404 when `NODE_ENV=production`).
- Missing from both, tracked in the Tasks database as Backlog: a venues endpoint, and an endpoint for an owner or coach to generate a magic link for a member or parent.

## What is real and what is mock

- Real: the Postgres schema and migrations, tenant scoping, the seed, the exercise catalog, and the API under `/api/v1` (magic-link exchange, refresh, sign-out, `/me`, tenant and theme, members, member detail, CSV import, batches, sessions), with role and tenant checks enforced on the server.
- Sign-in: opening a magic link (`/auth/magic?token=...`) signs the browser in. The session lives in httpOnly cookies (`as_access`, `as_refresh`), `lib/session.ts` resolves it against the database, and the shell has a Sign out button. With no session and demo mode off, visitors are sent to `/sign-in`. Outside production (or with `DEMO_MODE=true`) the Business / View as picker still works when nobody is signed in, and shows the seeded tenants (name, logo and colours from the database). The owner CSV import screen uses a mock client unless `NEXT_PUBLIC_API_MODE=live`, and in live mode it would still have no bearer token to send.

## Hosting (dev deployment)

These are the current facts, recorded as a Proposed decision in Notion ("Proposed: tech stack"), not an accepted one.

- App on Vercel (Hobby plan). Database on Neon Postgres, Singapore region.
- `DATABASE_URL` for the cloud database is set in Vercel only. It is not in the repo, not in `.env.example`, and must not be pasted into docs, commits or chats.
- Migrations are applied by hand from a laptop with `npm run db:deploy` (that is `prisma migrate deploy`), with `DATABASE_URL` set in that shell to the target database. The build does not run migrations.
- The seed and catalog scripts refuse a non-local database unless `SEED_ALLOW_REMOTE=1`. Only set it on purpose, and only with fake data.
- Vercel's Hobby plan is for non-commercial use. Before any real paying customer or commercial pilot the plan or the host has to change; that is a human decision (cost and data-residency questions are open in Notion).
- In production the demo pickers are hidden unless `DEMO_MODE=true` is set, and `POST /api/v1/dev/magic-link` always answers 404.

## Layout

| Path | What is there |
| --- | --- |
| `app/` | Next.js pages (`app/[role]/...`), `app/about`, and the API under `app/api/v1` |
| `components/`, `lib/` | UI components, i18n (English, Hindi, Kannada), auth, tenant scoping, theme |
| `prisma/` | `schema.prisma`, migrations, `seed/` (demo tenants), `catalog/` (exercise import) |
| `data/` | Exercise catalog sources: `free-exercise-db` (Unlicense) and our own drafts |
| `tests/`, `e2e/` | Vitest suites and the Playwright smoke test |
| `docs/` | `api/openapi.yaml`, `DATA_MODEL.md`, `DEMO.md`, `THIRD_PARTY.md` |

Hindi and Kannada strings are our own drafts and are marked "needs native-speaker review".
