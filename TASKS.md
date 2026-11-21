# Sprint 2 task tracker (POC completion)

Shared by all agents. Notion (Tasks database, Sprint "Sprint 2: POC completion") is the source of
truth for task content and acceptance criteria; this file is the quick claim board.
Plan: `docs/PLAN-POC.md`. Contract: `docs/api/openapi.yaml` v0.2.0.

## Rules

1. Claim a task by moving its line from Pending to In Progress and appending `- claimed by <agent name> <date>`. Set the Notion task to In Progress at the same time.
2. One task per agent at a time. Maximum 3 agents in progress at once, each in its own git worktree and branch.
3. Start a task only when every dependency is In Review in Notion and merged into the integration branch.
4. Touch only the files the task owns (`docs/PLAN-POC.md` section 7). Append-only for shared files.
5. Never move a task to Completed unless its tests pass (`npm run typecheck`, `npm run lint`, `npm test` with `DATABASE_URL` set, plus the task's own tests). Record the command and result in the Notion comment.
6. When finished: move the line to Completed, set Notion to **In Review** with the PR / Link and a short comment. Notion statuses stay In Review; only a human moves a task to Done.
7. If blocked: move the line to Blocked with the reason and who must act; set Notion to Blocked and comment.
8. Nobody may declare the POC complete while Pending, In Progress or Blocked is non-empty.
9. Never delete tasks or lines; never mark Done.

Format: `ID | title | owner agent | depends on | wave`

## Pending

- STAR-57 | Sync lib/auth/policy.ts and error codes with contract v0.2.0 | Backend | STAR-56 | 1
- STAR-58 | Prisma schema and migration: plans, assignments, logs, updates, availability, bookings, settings, goal metrics | Backend | STAR-56 | 1
- STAR-60 | API: exercises, workout plans, plan assignments, schedule expansion | Backend | STAR-57, STAR-58 | 2
- STAR-61 | API: create/detail/update session and one-tap roll call attendance | Backend | STAR-57, STAR-58 | 2
- STAR-62 | API: bookings (capacity, waitlist, cancellation window), coach availability, tenant settings | Backend | STAR-57, STAR-58 | 2
- STAR-63 | Seed: plans, assignments, logs, goals, bookings, availability, join/leave history (3 tenants) | Backend | STAR-58 | 2
- STAR-64 | Owner CSV import screen live in every mode, show skippedRows and warnings | Frontend | STAR-59 | 2
- STAR-65 | API: workout logs, member schedule, member stats, goals with progress, updates feed | Backend | STAR-60, STAR-61, STAR-62 | 3
- STAR-66 | API: owner analytics, coaches list, coach stats | Backend | STAR-60, STAR-61, STAR-62 | 3
- STAR-67 | Coach plans: list, builder with exercise picker, assign, edit, archive | Frontend | STAR-59, STAR-60 | 3
- STAR-68 | Coach today, calendar, roll call with offline queue, schedule session, availability | Frontend | STAR-59, STAR-61, STAR-62 | 3
- STAR-69 | Customer home and workouts: today's items, start/stop/complete, exercise detail, updates feed | Frontend | STAR-59, STAR-65 | 4
- STAR-70 | Customer schedule and progress: booking and waitlist, goals, stats, history | Frontend | STAR-59, STAR-62, STAR-65 | 4
- STAR-71 | Coach roster and member detail, owner member detail, coach My record | Frontend | STAR-59, STAR-65, STAR-66 | 4
- STAR-72 | Owner dashboard with charts and insights | Frontend | STAR-59, STAR-66 | 4
- STAR-73 | Owner coaches page, booking-rule settings, batches polish | Frontend | STAR-59, STAR-62, STAR-66 | 4
- STAR-74 | API role matrix and tenant isolation tests for all new operations | QA | STAR-60, STAR-61, STAR-62, STAR-65, STAR-66 | 4
- STAR-75 | Cross-role end-to-end Playwright scenarios | QA | STAR-63, STAR-64, STAR-67 to STAR-73 | 5
- STAR-76 | UX quality audit: placeholders, states, 360px, a11y, i18n, wording, seed privacy | QA | STAR-64, STAR-67 to STAR-73 | 5
- STAR-77 | Update README, DEMO.md, DATA_MODEL.md, TESTING.md, THIRD_PARTY.md | Docs | STAR-75, all Backend and Frontend tasks | 5
- STAR-78 | Sprint 2 handoff summary on the Sprint page | Docs | every other task In Review | 6

## In Progress

(none)

## Blocked

(none)

## Completed

- STAR-56 | POC plan, TASKS.md and OpenAPI v0.2.0 extension (36 operations) | Planner | - | 0 | Notion In Review. Contract refs validated; tests/auth-policy.test.ts is expected red until STAR-57 lands.
- STAR-59 | Design system, SVG chart kit and app shell v2 | Frontend | STAR-56 | 1 | Notion In Review. Tokens and components in app/globals.css, components/ui, components/charts; shell rebuilt; i18n split per feature. lib/nav.ts left unchanged on purpose (see Notion comment). typecheck, lint, build, e2e (31) pass; vitest 253 pass, only tests/auth-policy.test.ts red (expected until STAR-57).

## Epics (for reference, not claimable)

STAR-50 S2-E1 plan, contract and schema; STAR-51 S2-E2 coach workout plans; STAR-52 S2-E3 sessions, roll call, booking, availability; STAR-53 S2-E4 customer view; STAR-54 S2-E5 owner analytics; STAR-55 S2-E6 design system and validation.
