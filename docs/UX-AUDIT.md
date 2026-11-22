# UX quality audit (STAR-76)

Audited on branch `worktree-agent-aa90adf704398cd05`, 2026-11-22, rich seed, demo mode, `next dev --webpack`.
Automated by `e2e/ux-audit.spec.ts` (helpers in `e2e/helpers/ux-collect.ts`, `ux-routes.ts`).

```
E2E_WEBPACK=1 E2E_DB_NAME=allstar_e2e_qa76 E2E_PORT=3276 npx playwright test e2e/ux-audit.spec.ts
```

Result of the first run: 26 passed, 9 `test.fixme` (one per tracked defect). After the fixes below the `KNOWN` list is empty and every check is enforced (see Resolved). The crawl takes about
6 minutes. Extra switches: `UX_REUSE=1` re-runs the checks on the last crawl (cache in `playwright-report/`, no screenshots),
`UX_DISCOVER=1` writes `test-results/ux-audit/findings/<check>.json` without failing, `UX_TENANTS=demo-gym` limits tenants,
`UX_DEBUG=1` logs each page.

## Coverage

- Tenants: demo-karate, demo-gym, demo-studio (demo cookies, all three roles) plus an empty tenant `e2e-empty-gym` (owner, coach, customer
  with real magic-link sessions and no data) for the empty states.
- 98 distinct pages per run (33 route patterns x 3 tenants, detail pages discovered from links): `/`, `/about`, `/sign-in`;
  owner: home, dashboard, members, members/import, members/:id, batches, coaches, coaches/:id, workouts, settings;
  coach: home, today, today/week, today/availability, members, members/:id, plans, plans/new, record, sessions/new, sessions/:id, workouts;
  customer: home, workouts, schedule, progress, profile, updates, exercise/:id. The list is written to `test-results/ux-audit/pages.txt`.
- Each page: 360 px English (facts, axe, keyboard focus, screenshot), 768 and 1280 px (layout, targets, axe at 1280, screenshot at 1280),
  360 px Hindi and Kannada (keys, banner, hydration, console). 240 full-page screenshots in `test-results/ux-audit/`
  (`<tenant>__<role>__<page>__360|1280.png`, gitignored).
- Error states forced: workout log PUT 500, member import 500, unknown ids and routes, offline.

## Check results

| # | Check | Result |
|---|---|---|
| 1 | No placeholder, lorem, TODO, coming soon, empty headings | FAIL F1 (role home pages) |
| 2 | Real data on seeded pages, friendly empty states on the empty tenant | Pass. Coach Today shows "No sessions today" on a Sunday by design (the Week tab has data) |
| 3 | 360/768/1280: no horizontal scroll, 44px targets, nothing clipped | No page scrolls sideways. FAIL F4, F7, F8 |
| 4 | axe (wcag2a/aa, 2.1, 2.2, best-practice), focus, landmarks, one h1, labels | FAIL F2, F3, F6. No heading-order, landmark, label or focus findings (the dev-only demo bar is excluded) |
| 5 | Hindi, Kannada: no raw keys, no English fallbacks, review marker | Pass. hi and kn contain every key, banner shown on every shell page, `<html lang>` correct |
| 6 | No accountability or surveillance wording, no builder branding, visibility framing | Pass (messages and rendered pages, titles, alt text, footer, error pages) |
| 7 | Loading, error and empty states | Pass. `loading.tsx` and `error.tsx` exist, unknown ids and routes show a friendly page, forced 500s show no raw error |
| 8 | Console errors and failed requests | FAIL F5, F9 |
| 9 | Seed privacy | Pass. Only "Sample ..." names, example.test emails, no phone numbers, only local images |
| 10 | Visual consistency | See "Visual review" |

## Findings by severity

Count: High 1, Medium 7, Low 3.

### High

**F1 [STAR-83] Role home pages are placeholders.** Route `/owner`, `/coach` (all tenants, all viewports, roles owner and coach).
Shows "Owner home" / "Coach home", three generic cards and "This screen is a placeholder and will be built in a later task."
This is the first page after magic-link sign-in and the target of the header title link. Dead key `shell.placeholder` and the
branch in `app/[role]/[section]/page.tsx` remain. Fix: redirect to `/owner/dashboard` and `/coach/today` (as `/customer` already does) and delete the key.

### Medium

**F2 [STAR-84] Tenant primary colour as text fails contrast (demo-studio #2E8B6E, about 4.1:1).** Footer "About us" link, `.btn-secondary`,
`.btn-ghost`, tab links, on 20+ pages, 360 and 1280. Fix: derive `--primary-text` in `lib/theme-ui.ts` (darken until 4.5:1) for text on light backgrounds.

**F3 [STAR-85] Status badges fail contrast** (`.badge-ok`, `.badge-info`, some `.badge-warn`, about 120 nodes on 25+ pages, all tenants).
Fix: darker foreground tokens on the soft backgrounds.

**F4 [STAR-86] Period and view chips (`a.seg`) are 38px high.** `/owner/dashboard`, `/owner/coaches`, `/owner/members/:id`,
`/customer/schedule`, `/customer/progress` at 360 px. Fix: `.seg { min-height: var(--tap) }`.

**F5 [STAR-87] Hydration mismatch on member detail in Hindi** (`/owner/members/:id`, `/coach/members/:id`, 360, Hindi). Server renders
"27 अक्तू॰", client "27 अक्टू॰" in `GoalsPanel` check-in dates; React regenerates the tree. Fix: fixed month table for hi/kn or server-only formatting.

**F6 [STAR-88] Roll-call buttons fail label-in-name** (`/coach/sessions/:id`, `.sessions_rollMain`) and **the dashboard cohort table scroll region is not
keyboard focusable** (`/owner/dashboard`). Fix: aria-label starts with the visible text; `tabIndex=0 role=region aria-label` on the wrapper.

**F7 [STAR-89] Header truncates the business name and user line at 360 px**, all roles, all tenants (and even "Sample Empty Gym" when signed in, with the
Sign out button). The white-label name is the identity. Fix: allow two lines, move language and sign out to a second row below 400 px.

**F8 [STAR-90] Owner members table clipped at 768 px** (`.dt-wrap { overflow: hidden }` with a table wider than the area between the 640 px card
breakpoint and the side rail). Fix: scrollable focusable wrapper or later card breakpoint.

### Low (not filed as bugs)

**F9 No favicon.** The first page load of every session logs a 404 console error ("Failed to load resource"). Fix: serve the tenant logo as the icon
(`generateMetadata` icons) or a neutral icon. Tracked by `fixme` "LOW-1".

**F10 Level names wrap mid-word in the owner members table at 1280 px** ("Yello / w", "Whit / e", header "Leve / l", "Attend / ance") because
`.dt th, .dt td { overflow-wrap: anywhere }` and narrow columns. Visual only, not automated. Fix: `overflow-wrap: break-word` and `min-width` on the Level column.

**F11 Customer schedule at 360 px: Previous and Next buttons each take a full row** and push the week to the fold. Fix: put both on one row.

## Visual review (representative sample viewed)

Viewed: owner dashboard 360, studio owner home 1280, karate customer schedule 360, gym coach today 360, karate owner members 1280, empty-tenant
pages. Consistent: card style, button radius, badge shapes, tenant colour applied everywhere, side rail from 768 px, bottom bar on phones, Hindi and
Kannada render with the right fonts. Inconsistencies: F7, F10, F11; the `Compiling` badge and the Next dev button in screenshots are dev-server
artifacts; fixed bar elements (bottom nav, demo switcher) appear mid page in full-page captures (capture artifact). The demo switcher covers the
top of the page at 360 px (demo mode only, excluded from the checks).

## Notes for the team

- Empty tenant: all pages show friendly empty states with a next step ("Your dashboard will fill in as you go", "No member profile is linked to this sign-in yet").
- Forced failures never leak technical text and keep the page usable (checks 7b to 7d).
- `KNOWN` in the spec is empty. Add an entry (with its Notion bug id) only for a newly found, filed defect; findings that match no entry fail the check.

## Resolved (Frontend, branch `worktree-agent-a14547b0137a0ff24`)

All findings are fixed and `KNOWN` in `e2e/ux-audit.spec.ts` is empty, so the nine former `test.fixme` cases are now enforced by the normal checks.

| Finding | Fix |
|---|---|
| F1 STAR-83 | `/owner` redirects to `/owner/dashboard`, `/coach` to `/coach/today` (`/customer` already went to Home). `app/[role]/[section]` serves only the exercise catalog; any other section is a clean 404. Keys `shell.placeholder` and `home.*` removed in en, hi, kn. |
| F2 STAR-84 | `lib/theme-ui.ts` derives `--primary-text-l` (on white) and `--primary-text-d` (on the dark card) from the tenant colour (4.5:1, also on its 12% tint); links, secondary and ghost buttons, tabs, nav and avatars use `--primary-text`. Brand fills still use `--primary`. |
| F3 STAR-85 | Darker `--ok`, `--warn`, `--info` foregrounds on their soft backgrounds. |
| F4 STAR-86 | `.seg` is `min-height: var(--tap)`. |
| F5 STAR-87 | `shortDate` in `lib/members/view.ts` uses fixed hi/kn/en month tables (no Intl, IST for timestamps), identical on server and client. |
| F6 STAR-88 | Roll-call buttons take their accessible name from the visible text plus a hidden "Tap to change to ..." hint (no aria-label); the dashboard tables sit in a focusable `role="region"` with a label. |
| F7 STAR-89 | The header wraps and the business name and user line wrap instead of truncating. |
| F8 STAR-90 | Data tables collapse to cards below 1024px (the side rail leaves too little room), and the wrapper scrolls instead of clipping. |
| F9 | Neutral, non-branded `app/icon.svg`; no favicon 404. |
| F10 | Table cells use `overflow-wrap: break-word`, so level names no longer split mid-word. |
| F11 | Customer schedule Previous and Next share one row below the range label at 360px. |
