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
