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

- STAR-64 | Owner CSV import screen live in every mode, show skippedRows and warnings | Frontend | STAR-59 | 2
- STAR-68 | Coach today, calendar, roll call with offline queue, schedule session, availability | Frontend | STAR-59, STAR-61, STAR-62 | 3
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

- STAR-70 | Customer schedule and progress: booking and waitlist, goals, stats, history | Frontend | STAR-59, STAR-62, STAR-65 | 4 | Notion In Review. Routes /customer/{schedule,progress,profile} (other roles keep the generic section page); app/[role]/_actions/bookings.ts; components/customer/{schedule,progress}/*; lib/customer/{schedule,progress,bookings,achievements}.ts; demo viewer (lib/viewer.ts) now picks a customer with a linked member and an active plan. tests/customer-schedule.test.ts (13) + e2e/customer-schedule.spec.ts (9); vitest 618, typecheck, lint, build, e2e 49 pass.
- STAR-66 | API: owner analytics, coaches list, coach stats | Backend | STAR-60, STAR-61, STAR-62 | 3 | Notion In Review. getOwnerOverview, getOwnerTrends, getCoachWorkload, getFeeStats, getOwnerInsights, listCoaches, getCoachStats; lib/analytics/{formulas,load}.ts, lib/api/{analytics,coaches}.ts; tests/analytics.test.ts (27 tests); contract adds attendance.byBatch and byWeekday.noShowPercent; full suite 558 passed, typecheck and lint clean.
- STAR-69 | Customer home and workouts: today's items, start/stop/complete, exercise detail, updates feed | Frontend | STAR-59, STAR-65 | 4 | Notion In Review. Routes /customer/{home,workouts,updates,exercise/[id]}, POST-free bridge PUT /ui/workout-log, customer nav Home/Workouts/Schedule/Progress/Profile; lib/customer/*, components/customer/**; tests/customer-*.test.ts (25 tests), e2e/customer-workouts.spec.ts (7); full suite 558 passed, typecheck, lint, build, e2e 38 passed.
- STAR-65 | API: workout logs, member schedule, member stats, goals with progress, updates feed | Backend | STAR-60, STAR-61, STAR-62 | 3 | Notion In Review. getMemberSchedule, listWorkoutLogs, recordWorkoutLog, getMemberStats, listGoals, createGoal, updateGoal, addGoalCheckIn, listMemberUpdates, markMemberUpdatesRead; lib/api/{schedule,workout-logs,member-stats,goals,member-updates}.ts; tests/progress-api.test.ts (20 tests); full suite 531 passed, typecheck and lint clean.
- STAR-63 | Seed: plans, assignments, logs, goals, bookings, availability, join/leave history (3 tenants) | Backend | STAR-58 | 2 | Notion In Review. prisma/seed/{rich,rich-data,dates}.ts; `npm run db:seed` = base + rich layer (about 1-3 s); `seedDemo(prisma)` stays base-only and removes the rich layer, `seedDemo(prisma, { rich: true, today? })` adds it. tests/seed.test.ts extended; npm test 480 passed, typecheck, lint, test:e2e 31 passed.
- STAR-67 | Coach plans: list, builder with exercise picker, assign, edit, archive | Frontend | STAR-59, STAR-60 | 3 | Notion In Review. Routes /[role]/plans, /plans/new, /plans/[planId]; app/[role]/_actions/plans.ts; components/plans/*; lib/plans/*; tests/plans-form.test.ts (20 tests) + e2e/coach-plans.spec.ts (2); typecheck, lint, vitest 515, build, e2e 33 pass.
- STAR-61 | API: create/detail/update session and one-tap roll call attendance | Backend | STAR-57, STAR-58 | 2 | Notion In Review. createSession, getSession, updateSession, recordAttendance; lib/api/{session-detail,session-write,attendance}.ts; tests/sessions-write-api.test.ts (15 tests); full suite 461 passed, typecheck and lint clean.
- STAR-56 | POC plan, TASKS.md and OpenAPI v0.2.0 extension (36 operations) | Planner | - | 0 | Notion In Review. Contract refs validated; tests/auth-policy.test.ts is expected red until STAR-57 lands.
- STAR-57 | Sync lib/auth/policy.ts and error codes with contract v0.2.0 | Backend | STAR-56 | 1 | Notion In Review. 52 operations in policy.ts, `conflict` (409) added; tests/auth-policy.test.ts green.
- STAR-58 | Prisma schema and migration: plans, assignments, logs, updates, availability, bookings, settings, goal metrics | Backend | STAR-56 | 1 | Notion In Review. Migration 20261122000000_plans_bookings_analytics (+down.sql); tests/plans-schema.test.ts.
- STAR-60 | API: exercises, workout plans, plan assignments, schedule expansion | Backend | STAR-57, STAR-58 | 2 | Notion In Review. 10 operations, lib/workouts/expand.ts; tests/plans-api.test.ts + tests/workout-expand.test.ts; typecheck, lint, npm test green (463 tests).
- STAR-59 | Design system, SVG chart kit and app shell v2 | Frontend | STAR-56 | 1 | Notion In Review. Tokens and components in app/globals.css, components/ui, components/charts; shell rebuilt; i18n split per feature. lib/nav.ts left unchanged on purpose (see Notion comment). typecheck, lint, build, e2e (31) pass; vitest 253 pass, only tests/auth-policy.test.ts red (expected until STAR-57).
- STAR-62 | API: bookings (capacity, waitlist, cancellation window), coach availability, tenant settings | Backend | STAR-57, STAR-58 | 2 | Notion In Review. bookSession, cancelBooking, list/replaceCoachAvailability, updateTenantSettings; GET /tenant now returns booking settings; listSessions adds kind/capacity/bookedCount/waitlistCount/myBookingStatus; lib/api/{bookings,availability,tenant-settings}.ts; tests/bookings-api.test.ts (16 tests); full suite 477 passed, typecheck and lint clean.

## Epics (for reference, not claimable)

STAR-50 S2-E1 plan, contract and schema; STAR-51 S2-E2 coach workout plans; STAR-52 S2-E3 sessions, roll call, booking, availability; STAR-53 S2-E4 customer view; STAR-54 S2-E5 owner analytics; STAR-55 S2-E6 design system and validation.
