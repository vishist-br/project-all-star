# POC completion plan (Sprint 2)

Author: Planner agent, 2026-11-21. Status: plan for Sprint 2 ("Sprint 2: POC completion" in Notion).
Tracker: `TASKS.md`. Contract: `docs/api/openapi.yaml` v0.2.0. Rules: `CLAUDE.md` always wins.

The project owner explicitly instructed the team to complete the POC end to end, including
coach workout assignment (a "do not decide" item in CLAUDE.md). It is built on that
instruction; the model and UX below are logged in Decisions & Docs as **Proposed: coach
workout-assignment model and UX** pending the 5 trainer interviews. Nothing here is Accepted.

Contents: 1 Principles, 2 Data model, 3 Permission matrix, 4 Analytics formulas, 5 UX per role,
6 Design system, 7 Waves and file ownership, 8 Seed data, 9 Out of scope.

---

## 1. Principles

- Every screen reads real data through `lib/api/*` (server components via `getViewer()`, the
  same functions the `/api/v1` routes use). No mock data, no placeholder text at the end.
- Mutations from the UI are **Server Actions** in `app/[role]/_actions/*.ts`. Each action:
  `const { principal, db } = await getViewer(); checkRole(principal, "<operationId>");` then
  calls the lib function. The lib function does the row-level check (section 3). Route handlers
  use `withAuth("<operationId>", ...)`. So role and row rules are enforced identically on both paths.
- Tenant isolation: every new table has `tenant_id`, a tenant-first index, and is reached only
  through `forTenant(prisma, tenantId)`. Ids from another tenant answer 404, never 403.
- Visibility framing: copy talks about sessions, progress and check-ins. Never "accountability"
  or surveillance wording. Positive framing by default.
- Fees are display only: status counts and dates. No amounts, no payment processing.
- No new runtime dependency. Charts are hand-rolled SVG. Any dependency added anyway must be
  MIT/Apache-2.0/BSD/ISC/Unlicense/CC0 and recorded in `docs/THIRD_PARTY.md`.
- Dates are `YYYY-MM-DD` in the tenant timezone (`Asia/Kolkata` for all demo tenants);
  timestamps are UTC. "Today" on the server = current date in the venue timezone.

## 2. Data model additions (task STAR-58)

One migration, e.g. `prisma/migrations/20261122000000_plans_bookings_analytics/` with
`migration.sql` and `down.sql`. Only STAR-58 edits `prisma/schema.prisma` this sprint; any later
schema need gets its own task and migration (never edit a merged migration).

### 2.1 New enums

```prisma
enum PlanCadence      { DAILY WEEKLY MONTHLY }
enum PlanStatus       { DRAFT ACTIVE ARCHIVED }
enum AssignmentStatus { ACTIVE PAUSED ENDED }
enum WorkoutLogStatus { STARTED STOPPED COMPLETED SKIPPED }
enum BookingStatus    { BOOKED WAITLISTED CANCELLED }
enum GoalMetric       { SESSIONS_ATTENDED WORKOUTS_COMPLETED LEVEL CUSTOM }
enum MemberUpdateKind {
  PLAN_ASSIGNED PLAN_UPDATED PLAN_ENDED GOAL_SET GOAL_UPDATED
  SESSION_SCHEDULED SESSION_RESCHEDULED SESSION_CANCELLED BOOKING_CONFIRMED WAITLIST_PROMOTED
}
```

API enums are the lower-case forms (`plan_assigned`, ...).

### 2.2 New models

```prisma
model WorkoutPlan {
  id          String      @id @default(cuid())
  tenantId    String      @map("tenant_id")
  coachId     String      @map("coach_id")        // creator, User with role COACH or OWNER
  title       String
  description String?
  cadence     PlanCadence
  sportSlug   String?     @map("sport_slug")
  status      PlanStatus  @default(ACTIVE)
  version     Int         @default(1)
  archivedAt  DateTime?   @map("archived_at")
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @default(now()) @updatedAt
  tenant      Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  coach       User        @relation("PlanCoach", fields: [coachId], references: [id], onDelete: Restrict)
  days        WorkoutPlanDay[]
  assignments PlanAssignment[]
  @@index([tenantId, coachId, status])
  @@index([tenantId, status])
  @@map("workout_plans")
}

model WorkoutPlanDay {
  id        String   @id @default(cuid())
  tenantId  String   @map("tenant_id")
  planId    String   @map("plan_id")
  dayIndex  Int      @map("day_index")   // DAILY: 1; WEEKLY: 1-7 (ISO weekday); MONTHLY: 1-31
  title     String?
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  tenant    Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan      WorkoutPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  items     WorkoutPlanItem[]
  @@unique([tenantId, planId, dayIndex])
  @@map("workout_plan_days")
}

model WorkoutPlanItem {
  id              String    @id @default(cuid())
  tenantId        String    @map("tenant_id")
  dayId           String    @map("day_id")
  exerciseId      String    @map("exercise_id")
  position        Int
  sets            Int?
  reps            Int?
  durationSeconds Int?      @map("duration_seconds")
  restSeconds     Int?      @map("rest_seconds")
  notes           String?
  archivedAt      DateTime? @map("archived_at") // kept for history when edited away
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @default(now()) @updatedAt
  tenant   Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  day      WorkoutPlanDay @relation(fields: [dayId], references: [id], onDelete: Cascade)
  exercise Exercise       @relation(fields: [exerciseId], references: [id], onDelete: Restrict)
  logs     WorkoutLog[]
  @@index([tenantId, dayId, position])
  @@index([tenantId, exerciseId])
  @@map("workout_plan_items")
}

model PlanAssignment {
  id           String           @id @default(cuid())
  tenantId     String           @map("tenant_id")
  planId       String           @map("plan_id")
  memberId     String           @map("member_id")
  assignedById String           @map("assigned_by_id")
  status       AssignmentStatus @default(ACTIVE)
  startsOn     DateTime         @map("starts_on") @db.Date
  endsOn       DateTime?        @map("ends_on") @db.Date
  planVersion  Int              @map("plan_version")
  note         String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @default(now()) @updatedAt
  tenant     Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  plan       WorkoutPlan @relation(fields: [planId], references: [id], onDelete: Restrict)
  member     Member      @relation(fields: [memberId], references: [id], onDelete: Cascade)
  assignedBy User        @relation("AssignmentBy", fields: [assignedById], references: [id], onDelete: Restrict)
  logs       WorkoutLog[]
  @@index([tenantId, memberId, status])
  @@index([tenantId, planId, status])
  @@map("plan_assignments")
}

model WorkoutLog {
  id                    String           @id @default(cuid())
  tenantId              String           @map("tenant_id")
  assignmentId          String           @map("assignment_id")
  planItemId            String           @map("plan_item_id")
  memberId              String           @map("member_id")
  scheduledFor          DateTime         @map("scheduled_for") @db.Date
  status                WorkoutLogStatus
  startedAt             DateTime?        @map("started_at")
  completedAt           DateTime?        @map("completed_at")
  actualSets            Int?             @map("actual_sets")
  actualReps            Int?             @map("actual_reps")
  actualDurationSeconds Int?             @map("actual_duration_seconds")
  note                  String?
  clientId              String           @map("client_id")
  recordedById          String           @map("recorded_by_id")
  createdAt             DateTime         @default(now())
  updatedAt             DateTime         @default(now()) @updatedAt
  tenant     Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  assignment PlanAssignment  @relation(fields: [assignmentId], references: [id], onDelete: Cascade)
  planItem   WorkoutPlanItem @relation(fields: [planItemId], references: [id], onDelete: Restrict)
  member     Member          @relation(fields: [memberId], references: [id], onDelete: Cascade)
  recordedBy User            @relation("WorkoutLogBy", fields: [recordedById], references: [id], onDelete: Restrict)
  @@unique([tenantId, assignmentId, planItemId, scheduledFor])
  @@unique([tenantId, clientId])
  @@index([tenantId, memberId, scheduledFor])
  @@index([tenantId, status, scheduledFor])
  @@map("workout_logs")
}

// Change feed so customers see coach updates. One row per affected member.
model MemberUpdate {
  id         String           @id @default(cuid())
  tenantId   String           @map("tenant_id")
  memberId   String           @map("member_id")
  actorId    String?          @map("actor_id")
  kind       MemberUpdateKind
  entityType String           @map("entity_type") // plan | assignment | goal | session | booking
  entityId   String           @map("entity_id")
  params     Json             @default("{}")      // i18n params, strings only, no personal data of others
  readAt     DateTime?        @map("read_at")
  createdAt  DateTime         @default(now())
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  member Member @relation(fields: [memberId], references: [id], onDelete: Cascade)
  actor  User?  @relation("MemberUpdateActor", fields: [actorId], references: [id], onDelete: SetNull)
  @@index([tenantId, memberId, createdAt])
  @@index([tenantId, memberId, readAt])
  @@map("member_updates")
}

model CoachAvailability {
  id        String   @id @default(cuid())
  tenantId  String   @map("tenant_id")
  coachId   String   @map("coach_id")
  weekday   Int      // 1-7 ISO
  startTime String   @map("start_time") // "HH:mm" venue timezone
  endTime   String   @map("end_time")
  venueId   String?  @map("venue_id")
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now()) @updatedAt
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  coach  User   @relation("CoachAvailability", fields: [coachId], references: [id], onDelete: Cascade)
  venue  Venue? @relation(fields: [venueId], references: [id], onDelete: SetNull)
  @@index([tenantId, coachId, weekday])
  @@map("coach_availability")
}

model SessionBooking {
  id               String        @id @default(cuid())
  tenantId         String        @map("tenant_id")
  sessionId        String        @map("session_id")
  memberId         String        @map("member_id")
  status           BookingStatus
  waitlistPosition Int?          @map("waitlist_position")
  bookedById       String        @map("booked_by_id")
  cancelledAt      DateTime?     @map("cancelled_at")
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @default(now()) @updatedAt
  tenant   Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  session  Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  member   Member  @relation(fields: [memberId], references: [id], onDelete: Cascade)
  bookedBy User    @relation("BookingBy", fields: [bookedById], references: [id], onDelete: Restrict)
  @@unique([tenantId, sessionId, memberId]) // one row per member per session; re-booking reuses it
  @@index([tenantId, sessionId, status])
  @@index([tenantId, memberId, status])
  @@map("session_bookings")
}

model TenantSettings {
  id                         String   @id @default(cuid())
  tenantId                   String   @map("tenant_id")
  bookingCancelWindowMinutes Int      @default(120) @map("booking_cancel_window_minutes")
  waitlistEnabled            Boolean  @default(true) @map("waitlist_enabled")
  showMissedSessionCost      Boolean  @default(false) @map("show_missed_session_cost")
  createdAt                  DateTime @default(now())
  updatedAt                  DateTime @default(now()) @updatedAt
  @@unique([tenantId])
  @@map("tenant_settings")
}   // like TenantTheme: no row = defaults; plain tenantId column (no relation) is acceptable

model GoalCheckIn {
  id           String   @id @default(cuid())
  tenantId     String   @map("tenant_id")
  goalId       String   @map("goal_id")
  value        Decimal  @db.Decimal(10, 2)
  note         String?
  recordedOn   DateTime @map("recorded_on") @db.Date
  recordedById String?  @map("recorded_by_id")
  createdAt    DateTime @default(now())
  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  goal   Goal   @relation(fields: [goalId], references: [id], onDelete: Cascade)
  @@index([tenantId, goalId, recordedOn])
  @@map("goal_check_ins")
}
```

Add the reverse relations on `Tenant`, `User`, `Member`, `Exercise`, `Venue`, `Session`, `Goal`.

### 2.3 Columns added to existing models (all nullable or defaulted)

| Model | Column | Notes |
| --- | --- | --- |
| `Session` | `capacity Int?` | overrides `Batch.capacity` for this session |
| `Session` | `title String?` | e.g. "Extra sparring" |
| `Session` | `cancelledAt DateTime?`, `cancelReason String?` | set by `updateSession` cancel |
| `Member` | `leftOn DateTime? @db.Date` | set when a membership ends; drives retention. Backfill: null |
| `Goal` | `metric GoalMetric @default(SESSIONS_ATTENDED)` | existing rows keep meaning |
| `Goal` | `targetValue Decimal? @db.Decimal(10,2)`, `startValue Decimal?`, `unit String?` | `targetSessions` stays; used when `targetValue` is null |
| `Goal` | `startsOn DateTime @default(now()) @db.Date` | counting window start |

### 2.4 CHECK constraints (write by hand in `migration.sql`)

- `workout_plan_items`: `reps IS NOT NULL OR duration_seconds IS NOT NULL`;
  `sets BETWEEN 1 AND 20`, `reps BETWEEN 1 AND 200`, `duration_seconds BETWEEN 1 AND 7200`,
  `rest_seconds BETWEEN 0 AND 900` (each when not null).
- `workout_plan_days`: `day_index BETWEEN 1 AND 31`.
- `coach_availability`: `weekday BETWEEN 1 AND 7`, `start_time < end_time`.
- `session_bookings`: `(status = 'WAITLISTED') = (waitlist_position IS NOT NULL)`.
- `plan_assignments`: `ends_on IS NULL OR ends_on >= starts_on`.
- Partial unique index: one ACTIVE or PAUSED assignment per (tenant_id, plan_id, member_id):
  `CREATE UNIQUE INDEX ... ON plan_assignments(tenant_id, plan_id, member_id) WHERE status <> 'ENDED'`.

### 2.5 Schedule expansion (pure function, `lib/workouts/expand.ts`, STAR-60)

For assignment A (status ACTIVE) of plan P and each date D in [from, to]:
D is scheduled when `A.startsOn <= D` and (`A.endsOn` is null or `D <= A.endsOn`), and the
plan has a day with `dayIndex = 1` (DAILY), `= isoWeekday(D)` (WEEKLY) or `= dayOfMonth(D)`
(MONTHLY; 29-31 simply do not occur in shorter months). The items of that day with
`archivedAt` null, or archived after D with a log on D, are the scheduled items. PAUSED
assignments schedule nothing while paused (no history of pause periods is kept in the POC; past
dates while now paused are excluded too: documented simplification). Holidays do not remove
workout items (they are home workouts); they are flagged on the day.

Item status on D: the `WorkoutLog` for (A, item, D) if any, else `pending`.

### 2.6 Change feed writer (`lib/api/member-updates.ts`, STAR-58 writer, STAR-65 reader)

`recordMemberUpdates(tx, { memberIds, kind, entityType, entityId, actorId, params })` inserts one
row per member inside the caller's transaction. Writers: plans/assignments (STAR-60), sessions
(STAR-61), bookings (STAR-62), goals (STAR-65). `params` holds only strings such as plan title,
session date and time; never another member's name.

## 3. Permission matrix

Legend: **A** all rows in tenant; **Own** coach's own (batches where `Batch.coachId = me`,
members enrolled in them, sessions where `Session.coachId = me`, plans where
`WorkoutPlan.coachId = me`); **Self** customer's own member row or a child where
`Guardian.userId = me`; **-** 403. Any id outside the tenant is 404.

`lib/auth/policy.ts` must contain exactly these operationIds (STAR-57). Existing 16 unchanged.

| operationId | Method and path | owner | coach | customer |
| --- | --- | --- | --- | --- |
| updateTenantSettings | PUT /tenant/settings | A | - | - |
| listExercises | GET /exercises | A | A | A |
| getExercise | GET /exercises/{id} | A | A | A |
| listCoaches | GET /coaches | A | - | - |
| getCoachStats | GET /coaches/{id}/stats | A | self only | - |
| listCoachAvailability | GET /coaches/{id}/availability | A | self only | - |
| replaceCoachAvailability | PUT /coaches/{id}/availability | A | self only | - |
| listWorkoutPlans | GET /workout-plans | A | Own | - |
| createWorkoutPlan | POST /workout-plans | A (owner is creator) | Own | - |
| getWorkoutPlan | GET /workout-plans/{id} | A | Own, or assigned to an Own member | Self (assigned, any status) |
| updateWorkoutPlan | PUT /workout-plans/{id} | A | Own | - |
| archiveWorkoutPlan | POST /workout-plans/{id}/archive | A | Own | - |
| listPlanAssignments | GET /plan-assignments | A | members in Own batches or Own plans | Self |
| createPlanAssignments | POST /plan-assignments | A | Own members and visible plans | - |
| updatePlanAssignment | PATCH /plan-assignments/{id} | A | Own members | - |
| getMemberSchedule | GET /members/{id}/schedule | A | Own members | Self |
| listWorkoutLogs | GET /members/{id}/workout-logs | A | Own members | Self |
| recordWorkoutLog | PUT /workout-logs | - | Own members | Self |
| getMemberStats | GET /members/{id}/stats | A | Own members | Self |
| listGoals | GET /members/{id}/goals | A | Own members | Self |
| createGoal | POST /members/{id}/goals | A | Own members | - |
| updateGoal | PATCH /goals/{id} | A | Own members | - |
| addGoalCheckIn | POST /goals/{id}/check-ins | A | Own members | - |
| listMemberUpdates | GET /members/{id}/updates | A | Own members | Self |
| markMemberUpdatesRead | POST /members/{id}/updates/read | - | - | Self |
| createSession | POST /sessions | A (any coach) | Own batches / Own members, coachId = self | - |
| getSession | GET /sessions/{id} | A + roster | Own + roster | Self's batches; no roster, only own bookings and attendance |
| updateSession | PATCH /sessions/{id} | A | Own | - |
| recordAttendance | PUT /sessions/{id}/attendance | A | Own | - |
| bookSession | POST /sessions/{id}/bookings | A | Own sessions | Self, enrolled batches only |
| cancelBooking | POST /bookings/{id}/cancel | A (before start) | Own sessions (before start) | Self, before the cancel window |
| getOwnerOverview | GET /analytics/overview | A | - | - |
| getOwnerTrends | GET /analytics/trends | A | - | - |
| getCoachWorkload | GET /analytics/coaches | A | - | - |
| getFeeStats | GET /analytics/fees | A | - | - |
| getOwnerInsights | GET /analytics/insights | A | - | - |

Implementation: add `planWhere(p)`, `assignmentWhere(p)`, `bookingWhere(p)`, and
`assertCanManageMember(db, p, memberId)` (owner any, coach Own, customer never) to
`lib/auth/access.ts` (STAR-60 adds plan/assignment helpers, STAR-62 booking helpers; each task
appends its own functions only). Use the existing `memberWhere` / `assertCanViewMember` for read
rules. A coach "Own member" means enrolled (no `leftOn`) in a batch the coach runs, today.

Privacy rules that are not just role checks: customers never receive other members' names
(getSession has no roster for customers; MemberUpdate params never name others; waitlist shows
only a position). Kids' names are not shown on any shareable page.

## 4. Analytics and stats formulas

All formulas are pure functions in `lib/analytics/*` (STAR-66) or `lib/api/member-stats.ts`
(STAR-65), unit-tested with fixtures. Notation: period P = [from, to] inclusive, tenant dates.
Default P = last 30 days ending today. "Past" = `startsAt < now`. `pct(a, b)` = `round(100*a/b, 1)`,
null when b = 0. Holiday sessions = sessions whose date is in `Holiday` for the tenant.

### 4.1 Owner overview (`getOwnerOverview`)

| Metric | Formula |
| --- | --- |
| Active members at date d | members with `joinedOn <= d` and (`leftOn` null or `leftOn > d`) and `isActive` (for d = today); for past d ignore `isActive`, use `leftOn` only |
| members.active | active at `to` |
| members.new | `joinedOn` in P |
| members.left | `leftOn` in P |
| netGrowthPercent | `pct(active(to) - active(from - 1), active(from - 1))` |
| sessions.scheduled | past sessions with start in P, status != CANCELLED, not holiday sessions |
| sessions.completed | of those, status = COMPLETED |
| sessions.cancelled | status = CANCELLED, start in P |
| sessions.unlogged | of scheduled, still SCHEDULED and `endsAt < now - 2h` |
| completionPercent | `pct(completed, scheduled)` |
| attendance.percent | over Attendance rows of COMPLETED non-holiday sessions in P: `pct(PRESENT, PRESENT + ABSENT)` (EXCUSED excluded both sides; same rule as `MemberSummary.attendancePercent`) |
| noShowPercent | `pct(ABSENT, PRESENT + ABSENT)` |
| byWeekday[w] | attendance.percent restricted to sessions on ISO weekday w, plus session count |
| Engaged member | active member with >= 1 PRESENT attendance or >= 1 COMPLETED workout log in the last 14 days ending `to` |
| engagement.engagedMembers / percent | count; `pct(engaged, members.active)` |
| workouts.scheduled | expanded items (2.5) for all active-at-the-time assignments on dates in P up to today |
| workouts.completed | WorkoutLog COMPLETED with `scheduledFor` in P |
| adherencePercent | `pct(completed, scheduled)` |
| activeAssignments, membersWithPlan | ACTIVE assignments at `to`; distinct members holding one |
| retention.percent (customer retention rate) | `pct(active(to) - new, active(from - 1))` |
| retention.cohorts | for each of the last 6 join months M: joined = members with `joinedOn` in M; retainedN = `pct(count(leftOn null or leftOn > joinedOn + N days, and joinedOn + N <= today), count(joinedOn + N <= today))` for N = 30, 60, 90; null when no member is old enough |
| bookings | in P: booked, waitlisted, cancelled counts; `fillPercent = pct(sum booked, sum capacity)` over group sessions with a capacity |
| previous / changePercent | same metric for the same-length period immediately before P; `changePercent = pct(value - previous, previous)` |

### 4.2 Member stats (`getMemberStats`) and coach stats

- attendance: attended = PRESENT, missed = ABSENT, excused = EXCUSED in P (completed, non-holiday
  sessions); `percent = pct(attended, attended + missed)`; `hoursAttended` = sum of
  `(endsAt - startsAt)` of PRESENT sessions, in hours, 1 decimal (supports hourly achievements).
- workouts: scheduled = expanded items on dates in [from, min(to, today)]; completed / skipped /
  pending = by log status (STARTED and STOPPED count as pending); `adherencePercent =
  pct(completed, scheduled)`; upcoming = expanded items after today up to `to`.
- streaks: an active day = a date with a PRESENT attendance or >= 1 COMPLETED log.
  `currentActiveDays` = consecutive active days ending today or yesterday; `longestActiveDays` =
  longest run ever (supports daily-streak achievements; which one the product shows stays open).
- level: current `MemberLevel` (latest), next rank in the same sport, `progressPercent` =
  existing `MemberDetail.progressPercent` rule.
- weekly: Monday-start buckets from..to.
- Coach stats (`getCoachStats` and each `getCoachWorkload` row), for Own sessions in P:
  scheduled/completed/cancelled/unlogged as 4.1; `consistencyPercent = pct(completed, scheduled)`;
  `attendancePercent` over Own sessions; `workoutAdherencePercent` over Own members' assignments;
  `availabilityHoursPerWeek` = sum of availability slot hours; `bookedHoursNext7d` = hours of Own
  sessions in the next 7 days; `loadPercent = pct(bookedHoursNext7d, availabilityHoursPerWeek)`;
  memberOutcomes = goals ACHIEVED in P, ACTIVE now, MemberLevel rows in P awarded by the coach.

### 4.3 Goal progress

| Metric | currentValue | progressPercent |
| --- | --- | --- |
| SESSIONS_ATTENDED | PRESENT count since `startsOn` | `min(100, pct(current, targetValue ?? targetSessions))` |
| WORKOUTS_COMPLETED | COMPLETED logs since `startsOn` | `min(100, pct(current, targetValue))` |
| LEVEL | current level rank | 100 when reached target level rank, else `pct(currentRank - startRank, targetRank - startRank)` (startRank = rank at `startsOn`) |
| CUSTOM | latest check-in value | `clamp(0, 100, pct(current - startValue, targetValue - startValue))` (works for decreasing targets too) |

Status ACHIEVED always reports 100; DROPPED reports the last computed value.

### 4.4 Fee stats (`getFeeStats`, display only)

Over active members: counts by `feeStatus` (PAID, DUE, OVERDUE, WAIVED); `dueNext7Days` =
DUE with `feeDueOn` in [today, today + 7]; `paidThisMonth` = `feePaidOn` in the current month;
`paidByMethod` by `feePaidMethod` (null = unknown); `paidPercent = pct(PAID, active - WAIVED)`.
No amounts exist in the schema and none are added.

### 4.5 Insights (`getOwnerInsights`)

- followUps (friendly check-in, not a penalty): `consecutive_absences` = last 3 marked
  attendances all ABSENT; `inactive_14_days` = active member, no PRESENT and no COMPLETED log in
  14 days, joined > 14 days ago; `workouts_pending` = adherence < 30% over last 14 days with >= 5
  scheduled items. Each with the member's coach (first active batch). Max 20, worst first.
- renewals: active members with OVERDUE, or DUE and `feeDueOn <= today + 7`, with 30-day attendance %.
- unloggedSessions: SCHEDULED sessions with `endsAt < now - 2h` in the last 14 days (this is the
  automatic owner alert when a coach has not logged a class, group classes flagged).
- cards (rule list, evaluate in order, max 6, deterministic):
  1. `best_weekday` (positive): weekday with highest attendance % (min 3 sessions).
  2. `low_weekday` (attention): lowest weekday if >= 15 points below the average.
  3. `attendance_trend` (positive or attention): this period vs previous, |change| >= 5 points.
  4. `new_members` (positive): new > 0 in P.
  5. `coach_consistency` (positive): coaches with 100% consistency and >= 4 sessions.
  6. `plan_adherence` (neutral or positive): overall adherence and members with a plan.
  7. `follow_ups` (attention): count of followUps when > 0.
  Titles are i18n keys + params; wording describes visibility and progress only.

## 5. UX outline per role

Nav (max 5 per role, `lib/nav.ts`, STAR-59). Each section is a static folder
`app/[role]/<section>/page.tsx` (static segments beat `[section]`) that first checks the role
and renders `NotAllowed` otherwise. Section names are unique across roles so no two tasks own the
same folder. The generic `[section]` page and `shell.placeholder` are removed at the end.

| Role | Sections (label) | Owner task |
| --- | --- | --- |
| owner | dashboard (Dashboard), members (Members), coaches (Coaches), batches (Batches), settings (Settings) | STAR-72, existing + STAR-71 detail + STAR-64 import, STAR-73, STAR-73, STAR-73 |
| coach | today (Today), roster (Members), plans (Plans), calendar (Schedule), record (My record) | STAR-68, STAR-71, STAR-67, STAR-68, STAR-71 |
| customer | home (Today), schedule (Schedule), progress (Progress), updates (Updates), profile (Profile) | STAR-69, STAR-70, STAR-70, STAR-69, STAR-59 (simple: name, batches, fee status, language) |

The exercise library (`workouts`) stays reachable from Plans (coach), Settings (owner) and
exercise links (customer `app/[role]/exercise/[id]`), not from the bottom bar.

### 5.1 Owner

- **Dashboard**: period chips (7 / 30 / 90 days). Row 1 KPI tiles: active members, attendance %,
  sessions completed / scheduled, engaged %, workout adherence, retention % (each with change vs
  previous). Row 2: active members line + new vs left bars (trends, 12 weeks); sessions scheduled
  vs completed bars. Row 3: attendance % line; attendance by weekday bars; workouts completed vs
  scheduled. Row 4: fee status donut (counts, "display only") with due-in-7-days and overdue
  links; retention cohort table; bookings fill. Right column (desktop) or bottom (mobile):
  insights panel (cards, follow-ups, renewals, unlogged sessions).
- **Members**: existing table + search/filters, row links to member detail (shared component
  from STAR-71), Import button (STAR-64).
- **Coaches**: workload table/cards per 4.2, sort by load or consistency; detail = record view.
- **Batches**: schedule, coach, venue, capacity, members, next session.
- **Settings**: theme (existing), booking rules, missed-session cost toggle, links to the
  exercise library and CSV import.

### 5.2 Coach (Proposed UX)

- **Today**: today's and tomorrow's sessions (time, batch, booked/capacity, waitlist), "Take roll
  call" button; unlogged past sessions banner; members needing a check-in (own followUps subset
  computed from member stats); quick stats (sessions this week, adherence of own members).
- **Roll call** (`sessions/[sessionId]`): big tappable rows, one tap toggles present/absent,
  menu for excused + reason, note, Complete. Offline queue banner.
- **Members (roster)**: list with attendance %, adherence %, active plan; member detail: stats
  tiles, weekly chart, goals (create, edit, status, check-in), assignments (assign, pause, end),
  workout history, recent attendance.
- **Plans**: list; builder (cadence, days, exercise search, items with steppers for sets, reps,
  duration, rest, notes, reorder); assign sheet (members from own batches, dates, note).
- **Schedule (calendar)**: week view; New session (batch or one-on-one member); cancel and
  reschedule; Availability tab (weekly slots).
- **My record**: delivered sessions, consistency, attendance, outcomes, weekly chart; shareable
  summary (no member names).

### 5.3 Customer (member or parent)

- **Today (home)**: child switcher for parents; today's items grouped by plan with
  sets x reps / duration and rest; Start, Stop, Complete, Skip; rest timer; next session card;
  "What's new" with unread badge; empty state when no plan ("Your coach has not shared a plan yet").
- **Schedule**: 7-day list and month grid; sessions with Book / Join waitlist / Cancel (until the
  window closes); workout items per day.
- **Progress**: level ring and timeline, goals with bars, attendance %, workouts completed vs
  pending vs skipped donut, streaks and hours, weekly charts, history list.
- **Updates**: feed of coach changes, newest first; opening marks them read.
- **Profile**: name, batches, coach names, fee status (display only), language.

Every screen: `loading.tsx` skeleton, `EmptyState` with a next step, `ErrorState` with retry
(`error.tsx`), works at 360 px, tap targets >= 44 px, offline-tolerant writes where noted.

## 6. Design system (STAR-59)

### 6.1 Tokens (`app/globals.css`, `:root`)

- Brand (from tenant theme, injected as today): `--primary`, `--secondary`, `--accent`, plus
  derived `--primary-contrast` (#fff or #111 by contrast >= 4.5:1) and `--primary-soft`
  (`color-mix(in srgb, var(--primary) 12%, white)`).
- Neutrals: `--bg #f7f8fa`, `--card #fff`, `--fg #14181f`, `--muted #5b6472`, `--line #e1e4ea`,
  `--line-strong #c9ced8`.
- Status (fixed, not tenant): `--ok #1a7f37`, `--warn #9a6700`, `--danger #c62828`,
  `--info #0969da`, each with a `-soft` background.
- Chart series (fixed, colour-blind safe, used in this order): `--c1 var(--primary)`,
  `--c2 #6b7280`, `--c3 #0f9d8a`, `--c4 #d97706`, `--c5 #7c3aed`; "missed/absent" always
  `--c2` (neutral grey, not red: positive framing).
- Space scale 4/8/12/16/24/32 px (`--s1`..`--s6`); radius `--r-sm 6px`, `--r 10px`, `--r-lg 16px`;
  shadow `--shadow-1 0 1px 2px rgb(0 0 0 / .06)`; font sizes `--fs-xs .75rem` .. `--fs-xl 1.5rem`;
  `--fs-kpi 1.75rem`; system font stack incl. Noto Devanagari and Kannada (existing).
- Dark mode is out of scope for the POC (tenant colours are designed for light).

### 6.2 Components (`components/ui/*`, server components unless interactive)

`Button` (primary, secondary, ghost, danger; sizes md 44px, lg 48px; loading), `IconButton`,
`Card` (header, body, footer), `StatTile` (label, value, previous, change arrow, sparkline slot),
`Badge` (neutral, ok, warn, danger, info), `ProgressBar`, `PageHeader` (title, subtitle,
actions), `SectionHeader`, `Tabs` (links, URL-driven), `Segmented` (period chips), `Table`
(responsive: cards under 640px), `List`/`ListItem`, `EmptyState` (icon, title, text, action),
`ErrorState` (message, retry), `Skeleton` (line, tile, chart, table), `Sheet` (bottom sheet on
mobile, dialog on desktop), `ConfirmDialog`, `FormField`, `TextInput`, `NumberStepper`
(sets/reps/duration/rest), `Select`, `Toggle`, `DateInput`, `Toast` (aria-live polite),
`Avatar` (initials only, never photos), `OfflineBanner`, `UnreadDot`.
Feature CSS goes in `*.module.css` next to the component, so tasks do not edit `globals.css`
after STAR-59.

### 6.3 Charts (`components/charts/*`)

Hand-rolled SVG, no dependency. Server-renderable pure functions of data. Components:
`LineChart` (1-3 series, optional area), `BarChart` (grouped), `StackedBar`, `Donut`
(max 5 slices + centre label), `Sparkline`, `ProgressRing`, `WeekdayBars` or `WeekdayHeatmap`,
`CohortTable` (HTML table with tinted cells). Rules: `viewBox` with width 100% and fixed aspect;
y axis starts at 0 for counts, 0-100 for percentages; max 5 gridlines; labels in `--fs-xs`;
tooltips via `<title>` only (no JS needed); every chart has `role="img"`, an `aria-label`
summary and a visually hidden `<table>` with the same numbers; nulls render as gaps, never 0;
legends only when > 1 series. Unit tests render each chart with a fixture and assert path counts
and the hidden table.

### 6.4 i18n

Split messages into `lib/i18n/messages/{en,hi,kn}/{common,owner,coach,customer,plans,sessions,analytics}.ts`
merged by the existing `en.ts`/`hi.ts`/`kn.ts`. Each feature task edits only its own feature
file. Hindi and Kannada drafts keep the "needs native-speaker review" marker.

## 7. Waves, dependencies and file ownership

Max 3 agents in parallel, each in its own worktree and branch, one task per agent. A task can
start when its dependencies are In Review **and merged into the integration branch**. Waves are
the earliest start tier; within a wave, take the highest priority first.

| Wave | Tasks (STAR) | Needs |
| --- | --- | --- |
| 0 | 56 Planner: this plan + contract | - |
| 1 | 57 Backend policy sync (do first, 1 pt); 58 Backend schema; 59 Frontend design system | 56 |
| 2 | 60 Backend plans; 61 Backend sessions + roll call; 62 Backend bookings + availability + settings; 63 Backend seed; 64 Frontend import live | 57+58 (63: 58; 64: 59) |
| 3 | 65 Backend progress (logs, schedule, stats, goals, feed); 66 Backend analytics; 67 Frontend coach plans; 68 Frontend coach today/roll call/calendar | 60, 61, 62 (67: 59+60; 68: 59+61+62) |
| 4 | 69 Frontend customer home/workouts/updates; 70 Frontend customer schedule/progress; 71 Frontend coach roster/member detail/record; 72 Frontend owner dashboard; 73 Frontend owner coaches/settings/batches; 74 QA API matrix | 65/66 as listed per task |
| 5 | 75 QA cross-role e2e; 76 QA UX audit; 77 Docs | all Frontend + 63 |
| 6 | 78 Docs handoff | everything else In Review |

Suggested 3-lane schedule: Lane A (Backend) 57 -> 58 -> 60 -> 65 -> 66 ... ; Lane B (Backend)
picks 61 -> 62 -> 63 after 58; Lane C (Frontend) 59 -> 64 -> 67 -> 68 -> 69 -> 70 -> 71 -> 72 -> 73;
QA and Docs take a lane once backend lanes free up.

File ownership (to keep worktrees conflict-free):

| Owner task | Files |
| --- | --- |
| 57 | `lib/auth/policy.ts`, `lib/auth/errors.ts` |
| 58 | `prisma/schema.prisma`, the new migration, `lib/api/member-updates.ts` (writer) |
| 59 | `app/globals.css`, `components/ui/**`, `components/charts/**`, `components/AppShell.tsx`, `lib/nav.ts`, `lib/i18n/**` structure, `app/[role]/layout.tsx`, `loading.tsx`, `error.tsx`, stub folders |
| 60 | `lib/api/{exercises,workout-plans,assignments}.ts`, `lib/workouts/**`, routes under `exercises`, `workout-plans`, `plan-assignments`; append plan helpers to `lib/auth/access.ts` |
| 61 | `lib/api/{session-write,session-detail,attendance}.ts`, `app/api/v1/sessions/route.ts` (POST), `sessions/[sessionId]/route.ts`, `.../attendance` |
| 62 | `lib/api/{bookings,availability,tenant-settings}.ts`, `lib/api/sessions.ts` (listSessions fields), `lib/api/me.ts` or tenant route fields, routes under `.../bookings`, `bookings`, `coaches/[coachId]/availability`, `tenant/settings`; append booking helpers to `lib/auth/access.ts` |
| 63 | `prisma/seed/**` |
| 64 | `components/ImportMembers.tsx`, `app/[role]/members/import/**`, `app/ui/members-import/**`, `lib/import/http-client.ts` |
| 65 | `lib/api/{schedule,workout-logs,member-stats,goals}.ts`, `lib/api/member-updates.ts` (reader), routes under `members/[memberId]/{schedule,workout-logs,stats,goals,updates}`, `workout-logs`, `goals` |
| 66 | `lib/analytics/**`, `lib/api/{analytics,coaches}.ts`, routes under `analytics`, `coaches/route.ts`, `coaches/[coachId]/stats` |
| 67 | `app/[role]/plans/**`, `components/plans/**`, `app/[role]/_actions/plans.ts` |
| 68 | `app/[role]/{today,calendar,sessions}/**`, `components/sessions/**`, `lib/offline/**`, `app/[role]/_actions/sessions.ts` |
| 69 | `app/[role]/{home,updates,exercise}/**`, `components/customer/{workout,updates}/**`, `app/[role]/_actions/workouts.ts` |
| 70 | `app/[role]/{schedule,progress}/**`, `components/customer/{schedule,progress}/**`, `app/[role]/_actions/bookings.ts` |
| 71 | `app/[role]/{roster,record}/**`, `app/[role]/members/[memberId]/**`, `components/member/**`, `components/coach/**`, `app/[role]/_actions/goals.ts` |
| 72 | `app/[role]/dashboard/**`, `components/owner/dashboard/**` |
| 73 | `app/[role]/{coaches,settings,batches}/**`, `components/owner/{coaches,settings,batches}/**`; removes `components/owner/OwnerScreens.tsx` remnants and the generic `[section]` page once all sections exist |
| 74, 75, 76 | `tests/*sprint2*`, `e2e/**`, `package.json` test scripts only |
| 77, 78 | `README.md`, `docs/**` (not `docs/api/openapi.yaml` unless a Backend task asks) |

Shared-file rule: `lib/auth/access.ts` and `package.json` may be appended by several tasks;
append only, rebase before merge. Contract changes after this plan need a comment on the
affected tasks and a policy update in the same commit.

Note: `tests/auth-policy.test.ts` is red from the moment the contract v0.2.0 lands until STAR-57
is merged. STAR-57 is first in wave 1 for that reason.

## 8. Seed data (STAR-63)

All fake. Anchor `SEED_TODAY` (env, default = today in Asia/Kolkata). Deterministic ids from keys
(`id("plan-<tenant>-<n>")`), upserts, idempotent. Per demo tenant (`demo-karate`, `demo-gym`,
`demo-studio`):

- Members: existing ones; `joinedOn` spread over the last 9 months (so cohorts and growth have
  data), 2-3 with `leftOn` in the last 90 days and `isActive = false`; fee statuses mixed with
  `feeDueOn` around today (some within 7 days, some overdue), `feePaidOn` and `feePaidMethod`
  for PAID.
- Sessions: for each batch schedule, every slot from today - 84 to today + 14. Past ones
  COMPLETED with attendance (about 80% present, 12% absent, 8% excused with reasons) except 2
  per tenant left SCHEDULED (unlogged alert) and 1 CANCELLED; holiday sessions kept as is.
- Availability: every coach has 3-5 weekly slots covering their batches.
- Plans: per coach >= 1, per tenant >= 3 (one DAILY, one WEEKLY, one MONTHLY), 3-6 items per day
  from the tenant's catalog sport (`gym` for demo-gym and demo-studio, `karate` for demo-karate),
  realistic sets/reps/duration/rest.
- Assignments: >= 70% of active members, startsOn 2-8 weeks ago; one PAUSED, one ENDED.
- Workout logs: for past scheduled items about 65% COMPLETED, 10% SKIPPED, rest pending; a few
  STARTED today for the demo customer.
- Goals: every member >= 1; each metric type present in each tenant; CUSTOM goals with 3-5
  check-ins; 1-2 ACHIEVED.
- Bookings: on upcoming group-class sessions; one session per tenant full with 2 waitlisted.
- Member updates: plan_assigned for each assignment, a few plan_updated and goal_set, some unread
  for the demo customer.
- The demo customer user and the demo parent each see data on every customer screen.

## 9. Out of scope this sprint (stays open)

Parent phone OTP (not in scope this sprint), parent weekly progress card, owner-verified
credential badges, holiday calendar editor and pre-declared excused absences UI, photo on roll
call, QR check-in and the other stretch items, payments, push or WhatsApp delivery (shareable
links only), dark mode. A human decides whether these join a later sprint.
