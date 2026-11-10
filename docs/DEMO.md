# Demo script (Sprint 1)

Audience: someone who has never seen the app. Time: about 10 minutes. All people, businesses and contact details in the demo are invented seed data.

Read this first. The app has two halves that are not yet joined:

| Half | What it is | Status |
| --- | --- | --- |
| Screens (the UI you click) | Placeholder pages per role. Who you are and which business you see come from two browser cookies and fake data in `lib/mock-session.ts`. | Mock. No sign-in happens. |
| API and database (`/api/v1`, Postgres) | Real sign-in by magic link, real role and tenant checks, real seeded data. | Real, but the screens do not call it yet (except nothing in this script). |

So you demonstrate the look and the role separation on the screens, and the real sign-in and data isolation through API calls. Say this out loud in the demo; do not present the pickers as login.

## Before you start

Follow the README ("Run locally from a clean checkout"), then load the demo data:

```
npm run start:local            # terminal 1, leave running
npm run db:seed                # terminal 2
npm run db:import-exercises    # terminal 2
```

Open http://localhost:3000 on a phone-sized window (about 390 px wide). The picker bar is visible because the app runs outside production.

## Part 1: switch tenant (screens, mock)

The "Business" picker has three demo businesses. Pick each one and watch the heading, logo and colours change.

| Picker label | Mock slug | Brand colour |
| --- | --- | --- |
| Demo Karate Academy | `demo-karate` | red |
| Demo Iron Gym | `demo-gym` | teal |
| Demo Group Classes Studio | `demo-classes` | purple |

What to point out: the business name, logo and colours change; no "Project All Star" branding appears anywhere (the app is white-label); the language picker offers English, Hindi and Kannada, and the Hindi and Kannada text shows a "needs native-speaker review" banner.

Known mismatch: the database seed names the businesses differently ("Sample Dojo", "Sample Iron Works", "Sample Flow Studio") and the third slug is `demo-studio`, not `demo-classes`. The screens show the mock names above; the API returns the seeded names. This is a tracked bug (Tasks database: UI demo tenants do not match seeded tenants).

## Part 2: each role sees only its own view (screens, mock)

Use the "View as" picker (Owner, Coach, Customer), then press "Continue as ...". Each role has its own bottom navigation:

| Role | Screens in the navigation | Content today |
| --- | --- | --- |
| Owner | Dashboard, Members, Batches, Coaches, Settings | Placeholders. Members has an "Import members from CSV" button that opens the CSV import screen. |
| Coach | Today, Members, My record | Placeholders |
| Customer | Progress, Schedule, Profile | Placeholders |

Then show the separation: while viewing as Coach, type an owner address such as `/owner/dashboard` in the browser bar. You get "not available for your role" and no link into the owner screens. The same holds for every role pair. This is what the end-to-end test checks.

Owner CSV import: Owner, Members, "Import members from CSV", then choose `public/sample-members.csv` (11 columns, fake people). The screen validates and previews the file. It runs against a mock client, so nothing is saved. To import for real, use the API (Part 4).

What is not in the screens yet: the coach roll call, session log, member progress page and owner dashboard numbers. The data for them exists in the database and the API lists members, batches and sessions (Part 3), but the pages are placeholders.

## Part 3: sign in by magic link (API, real)

Customers and parents are meant to open a magic link from WhatsApp; no passwords. For the POC nothing is sent: a development-only endpoint hands you the link. It exists only outside production (`NODE_ENV=production` returns 404).

Seeded users (all addresses end in `.example.test`; the tenant slug is the real database slug):

| Tenant slug | Owner | Coach | Customer |
| --- | --- | --- | --- |
| `demo-karate` | `owner@demo-karate.example.test` | `c1@demo-karate.example.test` (also `c2`) | `member-a1@demo-karate.example.test` (adult), or a parent: `parent-g1@demo-karate.example.test` to `parent-g6@...` |
| `demo-gym` | `owner@demo-gym.example.test` | `c1@demo-gym.example.test` (also `c2`) | `member-m1@demo-gym.example.test` |
| `demo-studio` | `owner@demo-studio.example.test` | `c1@demo-studio.example.test` (also `c2`) | `member-m1@demo-studio.example.test` |

Step 1, ask for a link (replace the values):

```
curl -s -X POST http://localhost:3000/api/v1/dev/magic-link \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"demo-karate","email":"c1@demo-karate.example.test"}'
```

The reply is `{"url":"http://.../auth/magic?token=...","expiresAt":"..."}`. The link lives 15 minutes and works once. The email must belong to that tenant: asking for `owner@demo-karate...` under `demo-gym` returns 404, which is the tenant boundary at work. The server also prints the link in its console.

Step 2, exchange the token for a session (copy the value after `token=`):

```
curl -s -X POST http://localhost:3000/api/v1/auth/magic-link/exchange \
  -H 'content-type: application/json' -d '{"token":"PASTE_TOKEN"}'
```

The reply holds an `accessToken` (valid 1 hour), a `refreshToken` (30 days) and the user with role and tenant. A second exchange of the same token fails.

Step 3, act as that user:

```
curl -s http://localhost:3000/api/v1/me -H 'authorization: Bearer PASTE_ACCESS_TOKEN'
curl -s http://localhost:3000/api/v1/members  -H 'authorization: Bearer PASTE_ACCESS_TOKEN'
curl -s http://localhost:3000/api/v1/batches  -H 'authorization: Bearer PASTE_ACCESS_TOKEN'
curl -s http://localhost:3000/api/v1/sessions -H 'authorization: Bearer PASTE_ACCESS_TOKEN'
```

What each role sees, enforced on the server:

- Owner: every member, batch and session in their own business, and nothing from the other two.
- Coach: only their own batches and sessions (and the members in them).
- Customer: only their own record, or their linked child's. A parent sees the child; the child has no login of its own.

Do the same sign-in as an owner of another tenant and compare the lists to show that data never crosses businesses.

Honest gap: the browser does not do this. Opening the returned `/auth/magic?token=...` link in a browser shows a not-found page because the landing page that would call the exchange does not exist yet (tracked in the Tasks database). Likewise, there is no endpoint yet for an owner or coach to generate a link for a member; the dev endpoint stands in for it, and phone OTP is in the contract but not built.

## Part 4: CSV import for real (API)

The endpoint is `POST /api/v1/members/import` (owner only; contract in `docs/api/openapi.yaml`). Get an owner access token as in Part 3, then check the file without saving (`dryRun=true` is the default) and commit it:

```
curl -s -X POST 'http://localhost:3000/api/v1/members/import?dryRun=true' \
  -H 'authorization: Bearer PASTE_OWNER_ACCESS_TOKEN' -F file=@public/sample-members.csv
curl -s -X POST 'http://localhost:3000/api/v1/members/import?dryRun=false' \
  -H 'authorization: Bearer PASTE_OWNER_ACCESS_TOKEN' -F file=@public/sample-members.csv
```

Rows are saved only if there are no row errors, and re-uploading the same file creates no duplicates. CSV only (up to 2 MB, 2000 rows); Excel and PDF are refused. Members always go into the owner's own business. A coach or customer token gets 403.

## Part 5: automated proof

`npm run test:isolation` (tenant and role rules, 132 tests) and `npm run test:e2e` (this script's Parts 1 to 3, run in Chrome) pass from a clean checkout; see the README for the commands and the Chrome note.
