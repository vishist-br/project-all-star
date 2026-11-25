# Plan: sport-agnostic workout engine (Proposed, not started)

Status: Proposed. The user wants this in the POC ahead of the Sprint 4 stretch features. Nothing here is built.
Scope note: this reverses the earlier "full workout logger with charts is out of the POC" line. Log the reversal in Decisions & Docs as Proposed.
Reuse rule stays: we copy no Hevy UI, text, images or videos. We build the capabilities in our own design.

## Model: one engine, sport packs

A plan item has a metric type. Each sport pack picks the defaults.

| Metric type | Logged per set or run | Used by |
|---|---|---|
| WEIGHT_REPS | kg, reps, set type (warm-up, normal, drop, to-failure) | gym, strength |
| REPS | reps, optional each side | karate kihon, yoga, calisthenics |
| TIME | seconds, rest seconds | badminton drills, planks, footwork |
| DISTANCE_TIME | metres, split time | swimming, running, cycling |
| SCORE | made out of attempts, or match score | badminton smash drill, cricket nets, football |
| CHECKLIST | coach sign-off, 1-4 rating | karate kata, belt skills, technique work |

Data: `WorkoutSet` (log id, set number, set type, weight, reps, seconds, metres, score fields), `supersetGroup` and `rounds` on `WorkoutPlanItem`, `metricType` on `Exercise`, `SkillChecklist` and `SkillSignOff` for belts and levels (reuse the existing level/belt timeline).
Records (best weight, estimated max, best volume, best split, best score) are pure functions over the set history.

## Group classes

1. A class (session) can carry a class workout (a plan day) chosen by the coach.
2. Finishing the roll call publishes a class summary: present members get what they did, a coach note and home practice; absent members get what they missed (excused ones get a softer wording).
3. Members and parents see it in Today and Updates; a share link works for families (reuses the weekly card token model).
4. Owner class insights (positive framing, visibility only): fill rate, attendance, waitlist demand, quiet slots, classes with a workout sent, and plain suggestions (add a class where the waitlist is long, move a quiet slot toward requested times).

## Phases (one after another, each touches the model)

1. Per-set logging and live workout screen, offline queue.
2. Metric types and sport packs (gym, karate, badminton, swimming, plus a generic pack); sport-specific exercise drafts marked "needs trainer review".
3. Supersets and rounds in the plan builder and live workout.
4. Coach send step: several members, repeat schedule, note, WhatsApp link; member inbox; coach results view.
5. Group class workout attach plus after-class summary and absent-member catch-up.
6. History, records, charts per exercise; belt and skill checklists.
7. Owner class insights and suggestions.
8. Folders and templates, body measurements, muscle-group volume (gym).

## Open questions
- Trainer interviews (5) should confirm the sport packs and the send step before phase 4.
- Parent view of a child's class summary needs the DPDP decision (STAR-98 is skipped for now).
