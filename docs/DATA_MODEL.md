# Data model notes

Schema lives in `prisma/schema.prisma`. Rules that apply to every table:

- Every model except `Tenant` has a non-null `tenant_id` and a tenant-first index
  (checked by `tests/schema-tenancy.test.ts`).
- Application code reads and writes tenant data through `forTenant(prisma, tenantId)`
  from `lib/tenant-scope.ts`.
- Each migration folder may hold a `down.sql` (generated with `prisma migrate diff`) that
  reverses it. Prisma ignores it; it is for local rollback only.

## Timeline rule: missed classes, excused absences and holidays

A member's progress timeline counts attended sessions. The rule (logic itself is a later task):

1. A missed class (`Attendance.status = ABSENT`) extends the member's timeline by one session.
2. An excused absence (`Attendance.status = EXCUSED`, with a `reason` of exam, illness,
   festival or travel) does NOT extend the timeline.
3. A session on a date in the tenant's `Holiday` calendar does NOT count as missed and does
   not extend the timeline.
4. `ExcusedAbsence` rows are absences declared in advance (a date range and reason); a later
   task converts them to `EXCUSED` attendance for sessions inside the range.

## Offline sync

`Attendance.clientId` (required, unique per tenant) and `Session.clientId` (optional) are
generated on the device so a retried upload is an idempotent upsert. `Attendance.updatedAt`
supports last-write-wins reconciliation. `photoRef` is nullable: one-tap roll call needs no photo.

## Achievements: hourly and daily

The schema stores a measurement unit and value so both hours and daily streaks can be
derived. Which one the product shows is undecided (see the Proposed entry in Decisions & Docs).

## Tenant theme and demo seed

`TenantTheme` (one row per tenant, table `tenant_themes`) holds brand name, logo URL and
`#RRGGBB` colours. `npm run db:seed` (needs a migrated local DB) upserts three synthetic
tenants (`demo-karate`, `demo-gym`, `demo-studio`) with owner, coaches, batches, members,
past sessions and attendance. It is idempotent (deterministic ids, upserts) and refuses a
non-local `DATABASE_URL` unless `SEED_ALLOW_REMOTE=1`. Demo logins use `*.example.test` emails.

## Sprint 2 additions (migration `20261122000000_plans_bookings_analytics`)

New tables, all with `tenant_id` and a tenant-first index (`docs/PLAN-POC.md` section 2):

- `workout_plans`, `workout_plan_days`, `workout_plan_items`: coach-authored plans. Cadence DAILY,
  WEEKLY (ISO weekday 1-7) or MONTHLY (day 1-31). Items reference the tenant's `exercises`; edited-away
  items are kept with `archived_at` so history stays valid. `version` bumps on edit.
- `plan_assignments`: a plan given to a member. At most one ACTIVE or PAUSED assignment per plan and
  member (partial unique index `plan_assignments_live_unique`); re-assigning after ENDED is allowed.
- `workout_logs`: member start/stop/complete per assignment item and date. `client_id` is unique per
  tenant for idempotent offline retries.
- `member_updates`: change feed so customers see coach changes (plans, goals, sessions, bookings).
  `params` is strings only and never holds another member's name.
- `coach_availability`: weekly windows (`HH:mm` in the venue timezone).
- `session_bookings`: one row per member and session; re-booking reuses it. A waitlist position is set
  if and only if status is WAITLISTED.
- `tenant_settings`: per-tenant booking cancel window, waitlist on/off, missed-session-cost toggle
  (off by default). No row means defaults, like `tenant_themes`.
- `goal_check_ins`: dated values for custom-metric goals.

Columns added to existing tables: `sessions.capacity/title/cancelled_at/cancel_reason`,
`members."leftOn"` (retention; null for current members), `goals.metric/target_value/start_value/unit/starts_on`
(existing goals default to `SESSIONS_ATTENDED`).

CHECK constraints (hand written in `migration.sql`, exercised by `tests/plans-schema.test.ts`):
plan item needs reps or duration, sets 1-20, reps 1-200, duration 1-7200 s, rest 0-900 s; plan day index
1-31; availability weekday 1-7 and start before end; waitlist position rule; assignment `ends_on >= starts_on`.

`lib/tenant-scope.ts` needs no model list: it derives tenant-owned models from the generated Prisma
metadata, so the new models are scoped automatically (asserted in `tests/plans-schema.test.ts`).
