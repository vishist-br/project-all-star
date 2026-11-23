# Data model (final POC model, Sprint 2)

Schema: `prisma/schema.prisma`. Ten migrations in `prisma/migrations/`, the last being `20261123103819_excused_absence_declarations`. Design notes and formulas: `docs/PLAN-POC.md` (section 2 data, section 4 formulas). Database: PostgreSQL 16, Prisma 6.

## The tenant_id rule

- Every model except `Tenant` has a non-null `tenant_id` column and an index that starts with it. This is checked by `tests/schema-tenancy.test.ts`; unique constraints are tenant-first too (for example `(tenant_id, email)`), so the same email, slug or name can exist in two businesses.
- Application code reads and writes tenant data only through `forTenant(prisma, tenantId)` from `lib/tenant-scope.ts`. It derives the list of tenant-owned models from the generated Prisma metadata, so a new model is scoped automatically (asserted in `tests/plans-schema.test.ts`).
- The tenant of a request always comes from the signed-in session, never from the URL or a request body. Public reads (theme by slug) are the only exception.
- `TenantTheme` and `TenantSettings` have one row per tenant (`UNIQUE(tenant_id)`); no row means defaults.
- Each migration folder may hold a `down.sql` (generated with `prisma migrate diff`) that reverses it. Prisma ignores it; it is for local rollback only.

## ER-style summary

```
Tenant 1--* everything below (tenant_id)

User (OWNER | COACH | CUSTOMER) --- unique (tenant_id, email)
  |-- coaches --> Batch *--1 Venue, *--1 Sport
  |-- Guardian (parent; has a customer User) 1--* Member (kid)
  |-- Member.userId (adult customer login)

Sport 1--* Level (belt or level, rank)   Member *--* Level via MemberLevel (history)
Batch *--* Member via BatchMember (enrolment)
Batch 1--* Session 1--* Attendance *--1 Member        (PRESENT | ABSENT | EXCUSED + reason)
                  1--* SessionBooking *--1 Member     (BOOKED | WAITLISTED | CANCELLED)
Member 1--* ExcusedAbsence (declared in advance)      Tenant 1--* Holiday (calendar)
Member 1--* Goal 1--* GoalCheckIn                     Member 1--* Achievement
Exercise (tenant copy of the catalog)
  *--1 WorkoutPlanItem *--1 WorkoutPlanDay *--1 WorkoutPlan (coach-authored)
WorkoutPlan 1--* PlanAssignment *--1 Member
PlanAssignment 1--* WorkoutLog (one per plan item and date) *--1 Member
Member 1--* MemberUpdate (change feed)
User(coach) 1--* CoachAvailability (weekly windows) *--0..1 Venue
Tenant 1--1 TenantTheme, 1--1 TenantSettings
MagicLink, AuthSession (hashed tokens; plain user_id and tenant_id columns, no relations)
```

## Models (all tenant-scoped)

Sprint 1 tables:

| Table | Purpose and key constraints |
| --- | --- |
| `tenants` | The business. `slug` is globally unique; this is the only table without `tenant_id`. |
| `users` | Owner, coach or customer login. `UNIQUE(tenant_id, email)`. |
| `venues`, `sports` | Places (with time zone, default Asia/Kolkata) and sports. `UNIQUE(tenant_id, name)` and `UNIQUE(tenant_id, slug)`. |
| `batches` | A recurring class: one coach, venue and sport, `kind` GROUP_CLASS or ONE_ON_ONE, optional `capacity`, ISO weekdays and `HH:mm` times in the venue time zone. |
| `guardians`, `members`, `batch_members` | Parent record; the member (adult or child, `is_minor`, `guardian_id` for kids, optional `user_id` login); enrolment (`UNIQUE(tenant_id, batch_id, member_id)`). `members` carries display-only fee fields (`fee_status` PAID, DUE, OVERDUE, WAIVED; `fee_due_on`, `fee_paid_on`, `fee_paid_method` CASH or UPI; no amounts) and `leftOn`. Kids carry minimal data (name, birth year). |
| `sessions` | A dated class. `UNIQUE(tenant_id, batch_id, startsAt)`, `UNIQUE(tenant_id, client_id)` (offline idempotency), CHECK `endsAt > startsAt`. Status SCHEDULED, COMPLETED, CANCELLED. Sprint 2 adds `capacity`, `title`, `cancelled_at`, `cancel_reason`. |
| `attendance` | One row per member per session: `UNIQUE(tenant_id, session_id, member_id)` and `UNIQUE(tenant_id, client_id)`. CHECK: `reason` is required exactly when status is EXCUSED (reasons EXAM, ILLNESS, FESTIVAL, TRAVEL). `photo_ref` is nullable: one-tap roll call needs no photo. |
| `excused_absences` | Absence declared in advance by a member or parent (date range or one `session_id`, reason, optional note), CHECK `toDate >= fromDate`. `cancelled_at` is set when it is withdrawn (row kept). Migration `20261123103819_excused_absence_declarations` adds `session_id`, `cancelled_at` and two indexes (STAR-95). Screen: `/customer/absences`. |
| `holidays` | Per-tenant calendar, `UNIQUE(tenant_id, date)`. Honoured by the rules and analytics; no editor screen yet. |
| `levels`, `member_levels` | Belt or level per sport (`UNIQUE(tenant_id, sport_id, rank)` and `(... name)`) and each member's level history. |
| `goals`, `achievements` | Goals and basic achievements. Achievements store `measure_unit` (HOURS, DAYS, STREAK_DAYS, SESSIONS) and a value so both hourly and daily-streak views can be derived. |
| `exercises` | Per-tenant copy of the catalog: `source` FREE_EXERCISE_DB (Unlicense) or ORIGINAL (our drafts, `needs_trainer_review` true until a trainer clears it), `licence`, `source_commit`. `UNIQUE(tenant_id, source, source_id)`. No image column (image licence unclear). |
| `magic_links`, `auth_sessions` | Sign-in. Only SHA-256 hashes of tokens are stored (`token_hash`, `access_hash`, `refresh_hash`, all unique). Magic link: `expires_at` (15 min), `used_at` (single use). Session: access expiry 1 hour, refresh expiry 30 days, `revoked_at` on sign-out. |
| `tenant_themes` | Brand: logo URL, `#RRGGBB` primary, secondary and optional accent colours, `default_locale` en, hi or kn. The display name is `tenants.name`. |

Sprint 2 tables (migration `20261122000000_plans_bookings_analytics`):

| Table | Purpose and key constraints |
| --- | --- |
| `workout_plans` | Coach-authored plan: `cadence` DAILY, WEEKLY or MONTHLY, `status` DRAFT, ACTIVE or ARCHIVED, `version` (bumps on edit), `archived_at`, optional `sport_slug`. |
| `workout_plan_days` | A day in a plan. `day_index` is 1 for DAILY, 1-7 ISO weekday for WEEKLY, 1-31 for MONTHLY. `UNIQUE(tenant_id, plan_id, day_index)`, CHECK 1 to 31. |
| `workout_plan_items` | An exercise on a day: `sets`, `reps`, `duration_seconds`, `rest_seconds`, `position`. Items edited away are kept with `archived_at` so logs stay valid. CHECKs: reps or duration required; sets 1-20; reps 1-200; duration 1-7200 s; rest 0-900 s. |
| `plan_assignments` | A plan given to a member from `starts_on` to optional `ends_on` (CHECK `ends_on >= starts_on`), status ACTIVE, PAUSED or ENDED, `plan_version` at assignment. Partial unique index `plan_assignments_live_unique` on `(tenant_id, plan_id, member_id) WHERE status <> 'ENDED'`: one live assignment per plan and member; re-assigning after ENDED is allowed. |
| `workout_logs` | Member start, stop or complete for one plan item on one date: status STARTED, STOPPED, COMPLETED or SKIPPED, actual sets, reps and duration. `UNIQUE(tenant_id, assignment_id, plan_item_id, scheduled_for)` and `UNIQUE(tenant_id, client_id)` for idempotent offline retries. |
| `member_updates` | The change feed customers see. `kind` (PLAN_ASSIGNED, PLAN_UPDATED, PLAN_ENDED, GOAL_SET, GOAL_UPDATED, SESSION_SCHEDULED, SESSION_RESCHEDULED, SESSION_CANCELLED, BOOKING_CONFIRMED, WAITLIST_PROMOTED), `entity_type` and `entity_id`, `read_at`. `params` is strings only and never holds another member's name. |
| `coach_availability` | Weekly windows: `weekday` 1-7 (CHECK), `start_time` and `end_time` as `HH:mm` in the venue time zone (CHECK start before end), optional venue. |
| `session_bookings` | One row per member and session (`UNIQUE(tenant_id, session_id, member_id)`; re-booking reuses the row). Status BOOKED, WAITLISTED or CANCELLED. CHECK: `waitlist_position` is set if and only if status is WAITLISTED. |
| `tenant_settings` | `booking_cancel_window_minutes` (default 120, editable 0 to 2880), `waitlist_enabled` (default true), `show_missed_session_cost` (default false, display only). |
| `goal_check_ins` | Dated values for custom-metric goals (`value`, `note`, `recorded_on`). |

Columns added to existing tables in Sprint 2: `sessions.capacity/title/cancelled_at/cancel_reason`, `members.leftOn` (retention; null for current members), `goals.metric` (SESSIONS_ATTENDED, WORKOUTS_COMPLETED, LEVEL or CUSTOM; existing goals default to SESSIONS_ATTENDED), `goals.target_value/start_value/unit/starts_on`.

## Timeline rule: missed classes, excused absences and holidays

A member's progress timeline counts attended sessions.

1. A missed class (`attendance.status = ABSENT`) extends the member's timeline by one session.
2. An excused absence (`EXCUSED`, with reason exam, illness, festival or travel) does NOT extend the timeline.
3. A session on a date in the tenant's `holidays` is not counted as missed and does not extend the timeline.
4. `excused_absences` rows are absences declared in advance (a date range or one session, with a reason). They are never stored as attendance until the coach completes the roll call: until then the roll call shows the member pre-marked as EXCUSED (`preMarked`, with `declaredReason`), a mark the coach makes wins, and completing the roll call writes a real EXCUSED row (client id `pre-<declaration>-<session>`) for members still unmarked. Only a plain `ABSENT` extends the timeline (`extendsTimeline`), so a declared absence never does.

Attendance percentage everywhere is `PRESENT / (PRESENT + ABSENT)` over completed, non-holiday sessions; excused absences are excluded on both sides.

## Offline sync

`attendance.client_id` (required, unique per tenant), `sessions.client_id` (optional) and `workout_logs.client_id` are generated on the device so a retried upload is an idempotent upsert. `attendance.updated_at` supports last-write-wins reconciliation; a conflicting mark is surfaced to the coach rather than silently overwritten. The device queues (`lib/offline/*`) keep taps in the browser until they sync.

## Schedule expansion

Workout schedules are not stored per day. `lib/workouts/expand.ts` is a pure function: for an ACTIVE assignment, a date D is scheduled when D is within `starts_on`..`ends_on` and the plan has a day matching it (day_index 1 for DAILY, the ISO weekday for WEEKLY, the day of month for MONTHLY; days 29 to 31 simply do not occur in shorter months). Items with `archived_at` are skipped unless archived after D and logged on D. PAUSED assignments schedule nothing (no history of pause periods in the POC). Holidays do not remove workout items (they are home workouts) and are only flagged. An item's status on D is its `workout_logs` row, else pending. Full rules: `docs/PLAN-POC.md` section 2.5.

## Analytics formulas

The owner dashboard, member stats, coach stats, goal progress, fee stats and insights are pure functions over these tables (`lib/analytics/*`, `lib/api/member-stats.ts`), with the formulas written out in `docs/PLAN-POC.md` section 4: active members and retention (including 30, 60 and 90 day cohorts), sessions scheduled versus completed, attendance and no-show percentages by weekday and batch, engagement (a class or completed workout in the last 14 days), workout adherence, streaks (an active day is a day with a present mark or a completed workout), coach consistency and workload, goal progress per metric, fee status counts (display only), friendly check-in rules (last 3 marks absent; no activity for 14 days; under 30 percent of workouts done), renewal alerts and sessions without a roll call (ended over 2 hours ago). Wording describes visibility and progress, never penalties.

## Achievements: hourly and daily

The schema stores a measurement unit and value, and member stats expose hours attended and current and longest active-day streaks, so both hours and daily streaks can be derived. Which one the product shows is undecided (Proposed entry in Decisions & Docs).

## Demo seed

`npm run db:seed` (needs a migrated database) writes two layers for three synthetic tenants (`demo-karate`, `demo-gym`, `demo-studio`), all with `*.example.test` emails and invented names, no photos:

- Base layer (`prisma/seed/demo.ts`): tenants and themes, owner, coaches, venue, sports and belt levels, guardians, members, batches, past sessions and attendance, one holiday. Idempotent upserts with deterministic ids `seed-<slug>-...`.
- Rich layer (`prisma/seed/rich.ts`, `rich-data.ts`): about 12 weeks of history relative to today in Asia/Kolkata (`SEED_TODAY` pins it): more members with joining and leaving dates and attendance patterns, workout plans (daily, weekly, monthly, draft and archived), assignments (active, paused, ended), workout logs, goals and check-ins, upcoming sessions with bookings and one full class with a waitlist, coach availability, tenant settings, and the updates feed. Ids start with `seed-<slug>-r-`; the layer is deleted and rewritten on each run.

Both scripts refuse a non-local `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1`. `seedDemo(prisma)` (used in tests) is base-only; `seedDemo(prisma, { rich: true })` adds the rich layer.
