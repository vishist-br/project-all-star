# Workout engine contract (STAR-107)

For the UI agents. This is the human-readable companion of `docs/api/openapi.yaml` (version 0.3.0, the source of truth for field names and schemas). Everything below is implemented, tested and seeded. Plan: `docs/PLAN-WORKOUT-ENGINE.md`. Nothing here copies Hevy or any commercial app; wording is about visibility, never surveillance or accountability.

## 0. Conventions that apply to every operation

- Base path `/api/v1`, `Authorization: Bearer <accessToken>`. Roles: `owner`, `coach`, `customer`. A coach only reaches members enrolled in a batch they run; a customer only reaches themselves or their children. Errors use the `Error` schema (400, 401, 403, 404, 409). Another tenant's id is always 404.
- Dates are `YYYY-MM-DD` in the tenant timezone (Asia/Kolkata), timestamps are ISO UTC. Weight is kg (decimals allowed), time is seconds, distance is metres, a split is seconds per 100 m.
- Enums in responses: `metricType` is UPPERCASE (`WEIGHT_REPS`, `REPS`, `TIME`, `DISTANCE_TIME`, `SCORE`, `CHECKLIST`); every other enum is lowercase (`setType`: `normal|warmup|drop|failure`, log `status`, attendance `status`: `present|absent|excused`).
- Text the API produces for people is never English prose: it is a **message key plus params** (`titleKey`, `bodyKey`, `messageKey`, `params`). Translate with `translate(locale, key, params)` from `lib/i18n`. The keys live in `lib/i18n/messages/en/workout-engine.ts` (hi and kn drafts are marked needs native-speaker review). Param values are plain strings or numbers and never contain another member's name.
- Offline: every write that can be queued carries a device-generated `clientId` (8..64 chars, a UUID is fine) and is idempotent. Replaying a queued request answers 200 with the same rows; a `clientId` that is already stored on a different row answers 409. The existing item-level `recordWorkoutLog` flow and its queue are unchanged.
- Ordering below is the order a UI build usually needs the operations.

### Role summary

| Operation | Method and path | owner | coach | customer |
| --- | --- | --- | --- | --- |
| `getExercise`, `listExercises` (now with `metricType`) | existing | yes | yes | yes |
| `createWorkoutPlan`, `updateWorkoutPlan`, `getWorkoutPlan` (new item fields, `blocks`) | existing | yes | yes | read own |
| `getMemberSchedule` (new item fields, `blocks`) | existing | yes | yes | own |
| `recordWorkoutSets` | PUT `/workout-sets` | no | own members | self or child |
| `listWorkoutSets` | GET `/members/{memberId}/workout-sets` | yes | own | own |
| `getExerciseHistory` | GET `/members/{memberId}/exercises/{exerciseId}/history` | yes | own | own |
| `sendPlanToMembers` | POST `/plan-assignments/bulk` | yes | own plan, own members | no |
| `getPlanResults` | GET `/workout-plans/{planId}/results` | yes | own plan | no |
| `attachSessionWorkout` | PUT `/sessions/{sessionId}/workout` | yes | own sessions | no |
| `getSessionWorkout` | GET `/sessions/{sessionId}/workout` | yes | own sessions | sessions of own batches |
| `publishClassSummary` | POST `/sessions/{sessionId}/summary` | yes | own sessions | no |
| `getClassSummary` | GET `/sessions/{sessionId}/summary` | yes | own sessions | own member (`memberId` required) |
| `getMemberClassSummaries` | GET `/members/{memberId}/class-summaries` | yes | own | own |
| `createClassSummaryShare` | POST `/sessions/{sessionId}/summary/shares` | yes | own sessions | own member |
| `getSharedClassSummary` | GET `/public/class-summaries/{token}` | public | public | public |
| `listSkillChecklists` | GET `/skill-checklists` | yes | yes | yes |
| `getMemberSkillProgress` | GET `/members/{memberId}/skill-progress` | yes | own | own |
| `signOffSkill` | PUT `/members/{memberId}/skill-sign-offs/{skillItemId}` | yes | own members | no |
| `clearSkillSignOff` | DELETE same path (204) | yes | own members | no |
| `getClassInsights` | GET `/analytics/classes` | yes | no | no |

`recordWorkoutSets` mirrors `recordWorkoutLog`: owner is not allowed (403), the coach acts for a member in their own batch, a customer for themselves or their child. The role matrix and tenant isolation of every operation are tested in `tests/api-matrix.test.ts`; behaviour in `tests/workout-engine-api.test.ts`.

## 1. Exercises, metric types and sport packs

`Exercise` and `ExerciseSummary` carry `metricType`. It decides which fields a set screen shows:

| metricType | Fields per set | Used by |
| --- | --- | --- |
| `WEIGHT_REPS` | `weightKg`, `reps`, `setType` | gym (every catalog gym exercise, including plank: gym stays weight and reps) |
| `REPS` | `reps` | karate kihon, yoga, calisthenics, drills counted in reps |
| `TIME` | `seconds` | holds, footwork, split-steps, treading water, dance steps |
| `DISTANCE_TIME` | `meters`, `seconds` | swimming sets |
| `SCORE` | `scoreMade` out of `scoreOf` | badminton smash target drill |
| `CHECKLIST` | `rating` 1 to 4 | karate kata walk-through (use the skill sign-off for the belt itself) |

Sport packs in the catalog: gym (free-exercise-db), karate, yoga, dance fitness, badminton, swimming (our own drafts, all `needsTrainerReview: true`). Bodyweight, time and distance fields can be combined on one set when a screen wants to.

## 2. Plans: supersets, rounds and targets

`PlanItem` (input and output) gained, all optional and nullable: `supersetGroup` (label such as `"A"`), `rounds` (1..20), `targetWeightKg`, `targetDistanceMeters`. `metricType` is returned (read only). `createWorkoutPlan` and `updateWorkoutPlan` accept the new fields; validation errors come back as 400 with `details[].field` such as `days[0].items[1].supersetGroup`.

Superset rules (`lib/workouts/supersets.ts`): a group needs 2+ items, they must be next to each other by `position` (nothing else between them), every item of a group has the same `rounds`, `rounds` needs a `supersetGroup`, labels are 1 to 4 letters or digits. An item needs `reps`, `durationSeconds` or `targetDistanceMeters` (distance work needs no reps).

Rendering: do not group items yourself. `PlanDay` responses (`getWorkoutPlan`, create, update) have `blocks`, and `ScheduleDay` (`getMemberSchedule`) has `blocks` too:

```json
"blocks": [
  { "type": "single",   "label": null, "rounds": null, "items": [ { ...item } ] },
  { "type": "superset", "label": "A",  "rounds": 3,    "items": [ { ...item }, { ...item } ] }
]
```

`items` stays as before (flat list), so existing screens keep working. In a schedule day, a superset only groups items of the same assignment. A plan item's `sets` still means the number of sets; for a superset the UI shows `rounds` rounds of the items back to back.

## 3. Live workout: per-set logging

`PUT /workout-sets` (`recordWorkoutSets`), body `WorkoutSetsInput`:

```json
{
  "clientId": "uuid of the log, used when the log is created",
  "assignmentId": "...", "planItemId": "...", "scheduledFor": "2026-11-25",
  "note": "optional member note, max 280",
  "complete": false,
  "sets": [
    { "clientId": "uuid", "setNumber": 1, "setType": "warmup", "weightKg": 20, "reps": 10 },
    { "clientId": "uuid", "setNumber": 2, "weightKg": 40, "reps": 8 },
    { "clientId": "uuid", "setNumber": 3, "seconds": 45 },
    { "clientId": "uuid", "setNumber": 4, "meters": 50, "seconds": 61 },
    { "clientId": "uuid", "setNumber": 5, "scoreMade": 12, "scoreOf": 20 },
    { "clientId": "uuid", "setNumber": 6, "rating": 3 }
  ]
}
```

- 1..60 sets per call. A set needs at least one of `weightKg, reps, seconds, meters, scoreMade+scoreOf, rating`. `scoreMade` and `scoreOf` go together and `scoreMade <= scoreOf`. `setType` defaults to `normal`. `completedAt` (ISO) is optional and clamped to now plus 5 minutes.
- Upsert by each set's `clientId`: a repeated set is updated, a new one is added. Send the whole current set list or just the new sets; both work. Sets are never deleted by this call (a delete operation is not part of this contract; edit a wrong set by sending it again with the same `clientId`).
- Creates the workout log for (assignment, item, date) on the first call (status `started`). `complete: true` moves it to `completed` (409 if the log is skipped). `note` is the member's note and shows in `getPlanResults`.
- `scheduledFor` must be a date on which the item is scheduled and not in the future (400 otherwise), like `recordWorkoutLog`.
- The log's `actualSets` (work sets, warm-ups are not counted), `actualReps` and `actualDurationSeconds` are **derived from the sets**; once a log has sets, item-level `actual*` values sent through `recordWorkoutLog` are ignored. A log without sets behaves exactly as before.
- Response `WorkoutLogWithSets`: the usual `WorkoutLog` plus `sets[]` (all sets of the log, in order) and `newBests[]`: records this log broke, `{ metric, value, previous }` with `metric` one of `heaviest_weight, one_rep_max, best_set_volume, session_volume, most_reps, longest_time, best_split, best_score`. The first ever session of an exercise is a baseline and reports nothing. Show them as "new best" chips (`we.best.*` keys).
- 409 cases: a set `clientId` already stored on another log, the log `clientId` already used for another item or date, a skipped log.

`GET /members/{memberId}/workout-sets` (`listWorkoutSets`): `?logId=&exerciseId=&from=&to=&limit=&cursor=`. Newest day first, sets in order. Each item is a `WorkoutSet` plus `scheduledFor`, `exerciseId`, `exerciseName`.

## 4. History, series and records

`GET /members/{memberId}/exercises/{exerciseId}/history?range=3m|1y|all` (`getExerciseHistory`, default `3m`; other values are 400):

```json
{
  "memberId": "...", "exerciseId": "...", "exerciseName": "Barbell Squat", "metricType": "WEIGHT_REPS",
  "range": "3m", "from": "2026-08-25",
  "sessions": [ { "logId": "...", "date": "2026-11-20", "status": "completed", "note": null, "sets": [ WorkoutSet ] } ],
  "series": {
    "heaviestWeight": [ { "date": "2026-09-01", "value": 60 } ],
    "oneRepMax": [], "bestSetVolume": [], "sessionVolume": [], "totalReps": [],
    "bestTime": [], "bestSplit": [], "bestScore": []
  },
  "records": {
    "heaviestWeight": { "value": 90, "date": "2026-11-13" },
    "oneRepMax": null, "bestSetVolume": null, "bestSessionVolume": null, "mostReps": null,
    "longestTime": null, "bestSplit": null, "bestScore": null,
    "weightAtReps": [ { "reps": 5, "weightKg": 85, "date": "2026-11-06" } ]
  },
  "newBests": [ { "logId": "...", "date": "2026-11-13", "metric": "heaviest_weight", "value": 90, "previous": 85 } ]
}
```

- `sessions` newest first (list); each `series` array is oldest first (charts), one point per session, empty when the metric has no data (use `metricType` to decide which charts to show).
- Definitions: `heaviestWeight` heaviest work set; `oneRepMax` best Epley estimate `w * (1 + reps / 30)` (one rep is the weight); `bestSetVolume` best weight x reps of one set; `sessionVolume` sum of weight x reps; `totalReps` sum of reps; `bestTime` longest single set in seconds; `bestSplit` lowest seconds per 100 m (lower is better); `bestScore` best made-out-of ratio as a percent. Warm-up sets never count.
- `records` always cover the whole history; `series`, `sessions` and `newBests` follow `range`. `records.weightAtReps` is the heaviest weight at each rep count, ascending by reps.

## 5. Coach send step and results

`POST /plan-assignments/bulk` (`sendPlanToMembers`):

```json
{ "planId": "...", "memberIds": ["..."], "startsOn": "2026-11-26",
  "repeat": { "mode": "ongoing | once | weeks | until", "weeks": 4, "endsOn": "2026-12-31" },
  "note": "Start on Monday" }
```

- One transaction, one `plan_assigned` update per member (with the note), 1..100 members. `repeat` only decides the end date: `ongoing` (default, no end), `once` (end = start), `weeks` (`weeks` 1..52, end = start + weeks x 7 - 1), `until` (`endsOn`). Which weekdays or month days are used comes from the plan's own days and cadence.
- Response: `{ planId, planTitle, startsOn, endsOn, results: [{ memberId, memberName, status, assignmentId }], sentCount, alreadySentCount, skippedCount }`. Per member `status`: `sent`; `already_sent` (same plan, member and `startsOn`: nothing changes, so a double tap or retry is safe); `skipped_active` (the plan is still active for that member from another start date).
- All-or-nothing validation: unknown plan or member 404, plan or member outside the caller's own view 403, inactive member 400, archived or draft plan 409. Nothing is written in those cases.
- The WhatsApp link per member is the existing `POST /members/{memberId}/magic-link` (`createMemberMagicLink`); call it per member after sending.

`GET /workout-plans/{planId}/results?memberId=&from=&to=` (`getPlanResults`, owner or the plan's coach): default the last 28 days, at most 92 days. Returns `{ planId, from, to, items: [ { assignmentId, memberId, memberName, status, startsOn, endsOn, note, itemsCompleted, itemsSkipped, daysLogged, setCount, newBestCount, days: [ { date, items: [ { logId, planItemId, exerciseId, exerciseName, metricType, status, note, actualSets, actualReps, actualDurationSeconds, sets: [WorkoutSet], newBests: [..] } ] } ] } ] }`. `note` on an item is the member's note. Days are newest first.

## 6. Class workouts and after-class summaries

1. Before or after class: `PUT /sessions/{sessionId}/workout` (`attachSessionWorkout`) with `{ "planDayId": "..." }` (or `null` to detach). The plan must be visible to the caller and not archived and the day needs at least one exercise. Response `SessionWorkout`: `{ sessionId, planDayId, workout: { planId, planTitle, dayTitle, blocks } | null }` where `blocks` are as in section 2. `GET` on the same path (`getSessionWorkout`) is readable by the customers of that class's batch (show "today's class workout"). The plain `Session` DTOs do not carry `planDayId`; call `getSessionWorkout` when a screen needs it.
2. Finishing the roll call (`recordAttendance` with `complete: true`, the existing flow) **publishes the summary automatically when a workout is attached** and the session moves from scheduled to completed. Every marked member gets one `MemberUpdate`: present `class_summary`, absent `class_catchup`, excused `class_catchup_excused` (softer wording: `upd.class_catchup_excused`, `cs.excused.*`). The summary coach note defaults to the session's `coachNote`. A class without a workout publishes nothing by itself.
3. `POST /sessions/{sessionId}/summary` (`publishClassSummary`): `{ coachNote?, homePractice? }` (max 1000 each, `null` clears). Creates or updates the summary and tells members who were not told yet; repeating never tells a member twice. 409 before the class has started or when cancelled. It re-snapshots the attached workout. Use it to add a note and home practice after the automatic publish, or to publish a class that had no workout.
4. `GET /sessions/{sessionId}/summary?memberId=` (`getClassSummary`): 404 until published. **Customers must pass `memberId`** (their own or their child; 400 without it, 403 for someone else's). Response `ClassSummary`: `{ id, sessionId, batchName, startsAt, endsAt, coachNote, homePractice, publishedAt, workout (frozen at publish), counts, forMember }`. `forMember`: `{ memberId, status, titleKey, bodyKey, params: { firstName, batchName, date } }`, with keys `cs.present.*`, `cs.absent.*`, `cs.excused.*`. `counts` (`{ present, absent, excused }`) is for owner and coach only (null for customers) and appears whether or not `memberId` is given. Never contains another member's name.
5. `GET /members/{memberId}/class-summaries` (`getMemberClassSummaries`): paged, newest class first, each item a `ClassSummary` with `forMember` set (`counts` null). Use it for Today and Updates ("Class summaries").
6. Member updates: `MemberUpdateKind` gained `class_summary`, `class_catchup`, `class_catchup_excused`; `entityType` gained `class_summary` with `entityId` = the session id; `params` are `{ batchName, date }` only. Open `getClassSummary` with `sessionId = entityId` and the member's id. Message keys `upd.class_summary`, `upd.class_catchup`, `upd.class_catchup_excused`; `title` keeps an English fallback.
7. Share link: `POST /sessions/{sessionId}/summary/shares` with `{ memberId }` (`createClassSummaryShare`, 201) returns `{ url, expiresAt }`; the url is `APP_BASE_URL/share/class/{token}`. Only the SHA-256 of the token is stored, links last 30 days, the member must have been marked in that class. **The UI agent builds the page `/share/class/[token]`**: it calls the public `GET /api/v1/public/class-summaries/{token}` (`getSharedClassSummary`, no sign-in) which returns `{ tenantName, tenantSlug, firstName, batchName, startsAt, endsAt, status, titleKey, bodyKey, params, coachNote, homePractice, workout, expiresAt }`. Unknown, revoked and expired tokens are one 404 (show `cs.share.expired`). The API answers with `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`; the page must also set `robots: noindex` and show first name only. Brand the page with `getTenantTheme(tenantSlug)`.

## 7. Skills and belts

Checklists are tied to the existing belt timeline: a `SkillChecklist` may point at a `Level` (the belt it leads to), otherwise it is a free-standing list for a sport. Checklists and items are seeded; there is no create or edit operation in this contract (owner editing is a later task).

- `GET /skill-checklists?sportId=&levelId=` (`listSkillChecklists`): `{ items: [ { id, sportId, sportSlug, sportName, levelId, levelName, levelRank, levelColorHex, title, sortOrder, items: [ { id, title, description, sortOrder } ] } ] }`.
- `GET /members/{memberId}/skill-progress?sportId=` (`getMemberSkillProgress`): `{ memberId, currentLevels: [ { sportId, levelId, levelName, rank, achievedOn } ], checklists: [ { checklistId, ..., isNextLevel, doneCount, totalCount, percent, complete, items: [ { skillItemId, title, signedOff, rating, note, signedOffAt, signedOffByName } ] } ] }`. `isNextLevel` marks the checklist of the member's next belt. `complete` means every skill is signed off ("ready for the next level", `sk.checklistDone`); promoting the member stays the coach's existing level action.
- `PUT /members/{memberId}/skill-sign-offs/{skillItemId}` (`signOffSkill`): `{ rating: 1..4, note? }`, replaces an earlier sign-off. Rating labels `sk.rating.1..4`. Coach only for own members, owner any member.
- `DELETE` on the same path (`clearSkillSignOff`): 204, also when nothing was signed off.

## 8. Owner class insights

`GET /analytics/classes?range=7d|28d|90d` (`getClassInsights`, default `28d`): `{ range, from, to, overall: { classesHeld, avgFillRate, attendanceRate, workoutSentShare }, slots: [ { batchId, batchName, sportId, sportName, daysOfWeek, startTime, endTime, capacity, sessionCount, avgFillRate, attendanceRate, workoutSentShare, waitlistCount, quietSlot } ], suggestions: [ { kind, messageKey, batchId, params } ] }`. Rates are percents (one decimal) or null.

- Slots are active group-class batches. `sessionCount` counts classes held (roll call completed) in the range. `avgFillRate` is the average of people present divided by capacity (capped at 100). `attendanceRate` is present out of present plus absent (excused excluded). `workoutSentShare` is the share of held classes that had a class workout attached. `waitlistCount` is people currently waitlisted for upcoming classes of the slot.
- `quietSlot` ("room to grow", never "failing"): at least 3 classes held, average fill under 40 percent and nobody waiting.
- Suggestions: `add_class` (`ci.addClass`, params `batchName, waitlistCount`) when 3 or more are waiting; `move_slot` (`ci.moveSlot`, params `batchName, targetBatchName, waitlistCount`) for a quiet slot when another slot of the same sport has 2 or more waiting. Longest waitlist first, at most 5. No coach is named or ranked anywhere.

## 9. Demo data

Run `npm run db:seed` (rich seed, idempotent). Open the app, pick the business and "View as", or sign in with the accounts from `docs/DEMO.md` (all `*.example.test`, magic link).

| What to see | Business | Account / URL |
| --- | --- | --- |
| Months of per-set history, charts and records (squat, bench, row, deadlift; warm-up, drop and failure sets; a bench and row superset in a finished 24-week block, then the current full-body plan) | `demo-gym` | customer `member-m1@demo-gym.example.test` (Sample Member 01), also `member-m2` (smaller). Coach `c1@demo-gym.example.test` sees them as members. Open the Barbell Squat history. |
| Badminton drill plan (time, score, reps, a smash and net-drops superset), logged by Sample Member 03 | `demo-gym` | coach `c1@demo-gym.example.test` > plan "Badminton Footwork and Smash Drills" > results; customer `member-m3@...` |
| Swimming set (distance and time) logged by Sample Member 04 | `demo-gym` | plan "Swim Endurance Set"; customer `member-m4@...` |
| Karate kids class with an attached class workout (a punch and block superset, kata check), two published summaries, catch-up updates for absent members, one upcoming class with the workout attached | `demo-karate` | coach `c1@demo-karate.example.test` (kids batch, plan "Kids Class: Kihon Circuit"); parent `parent-g1@demo-karate.example.test` (Sample Kid 01) and other parents for the Updates feed; owner `owner@demo-karate.example.test` |
| Belt checklists (Yellow, Orange, Green) with partial sign-offs | `demo-karate` | Sample Kid 01 (3 of 6 Yellow skills), Kid 02 (5 of 6), Kid 03 (Orange 1 of 6), Kid 05 (Green 2 of 6), Kid 06 (4 of 6); the checklist is on the member progress |
| Owner class insights | `demo-gym` (and the others) | `owner@demo-gym.example.test`, `GET /api/v1/analytics/classes` |
| Class workout attach in the coach flow | any | pick a recent completed kids' class in `demo-karate` as coach |

Share-link page: create one with `createClassSummaryShare` for a session id from `getMemberClassSummaries` of Sample Kid 01 and open the returned `url` (the page is built by the UI agent).

## 10. Decisions and gaps to know about

- The weekly progress card share model referenced in the task does not exist in this checkout, so the class summary share (`ClassSummaryShare`) was built with the same primitives (`newToken`, `hashToken`, 30 days, hash-only storage, first name only, noindex). It can be folded into a common share model later.
- A summary snapshots the class workout when published (`ClassSummary.workoutSnapshot`), so later plan edits do not rewrite what a class did.
- Customers must name the member for `getClassSummary` (a parent can have several children).
- `publishClassSummary` is allowed once the class has started (not only when completed), so a coach can publish a note for a class whose roll call is still open; members are told once.
- Bulk send validates the whole request first (404/403 fail it all); only the per-member outcomes `sent`, `already_sent` and `skipped_active` are partial. Idempotency is by lookup of (plan, member, startsOn), not a database unique key, so two truly simultaneous identical requests could both insert; a unique index was left out to keep the migration safe on existing data.
- `WorkoutPlanItem` target check was relaxed (`reps`, `durationSeconds` or `targetDistanceMeters`); the API message still starts with "reps or durationSeconds is required".
- Gym catalog exercises are all `WEIGHT_REPS` (as asked), so a plank logged by a gym member stores `seconds` on a `WEIGHT_REPS` exercise. Charts should follow the data (`series.bestTime`) as well as `metricType`.
- Skill checklists have no create or edit API yet; the Sprint UI is read and sign-off only.
- The migration (`20261125090000_workout_engine_core`) is additive, has a `down.sql` for local rollback, and was applied only to a local scratch database.
