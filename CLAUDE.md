# Project All Star: standing rules for every agent

These rules apply to every session and every subagent, every time. Task-specific work lives in Notion (Tasks database), not here.

## What we are building

A white-label visibility tool for small and medium gyms, sports arenas, fitness centres and kids' coaching academies in India. It gives owners, coaches and customers (parents, for kids) a shared view of sessions, attendance, progress and follow-ups. It is a visibility tool, not an accountability or surveillance tool. Never use "accountability" or surveillance wording in UI or copy.

## Source of truth: Notion workspace "Project All Star"

1. Read the Agent Playbook first and follow it exactly. Then read the Product Brief, Team & Working Agreement, and Decisions & Docs.
2. Every piece of work is a task in the Tasks database. If it is not a task, it is not happening.
3. Architecture, scope and pricing choices go in Decisions & Docs as Proposed, never Accepted.

## Fixed product decisions (aligned in the Nov 7 meeting)

- Mobile-optimized web app first. No native app.
- White-label: zero builder branding. Each business sets its own name, logo and colors.
- Fixed three-way hierarchy: owner, coach, customer.
- Core focus: trainer visibility, session completion, client outcomes, no-show patterns, member follow-ups, including group classes.
- Attendance is part of member progress.
- Preloaded exercise catalog for the supported sports.
- Legacy data migration via Excel or CSV (PDF later).
- Broadcast channel is optional, not in the POC.
- Out of scope for the product: maintenance tasks, POS, inventory, payroll, payments processing.
- Scope guard: every feature must feed the owner, coach or customer view. If it does not, it does not belong in the POC.

## Do not decide (write a Proposed entry and move on)

- Trainer workout-assignment UI and UX (waiting on 5 trainer interviews and the UI engineer)
- Hourly vs daily-streak achievements (model data to support both)
- Any pricing choice
- Whether photo upload is the primary attendance record (we propose one-tap roll call with an optional photo)

## POC scope

### Core

- Tenants, roles, white-label theming, venues, sports, batches, members, CSV import
- Coach session log with one-tap roll call (optional photo), works offline and syncs later
- Member progress page: level or belt, goal, attendance, progress bar, achievements (basic; data supports hourly and daily)
- A missed class extends the member's timeline, except excused absences and holidays
- Fee status on the member profile (display only; cash or UPI marked paid by hand; optional UPI QR from the owner's own ID)
- Owner dashboard: sessions scheduled vs completed, no-show patterns, follow-up flags, renewal alerts with recent attendance
- Automatic owner alert when a coach misses a group-class follow-up
- Coach Insight Directory (profile: sessions completed, consistency, member outcomes; owner-verified credential badges)
- Coach "my record" view as proof of delivered sessions
- Preloaded exercise catalog (gym from free-exercise-db; other sports drafted by us, marked "needs trainer review")
- Member-side start/stop/complete of coach-assigned micro-workouts
- Group classes: timetable, capacity, booking, cancellation window, basic waitlist
- Kids and sports: level or belt progress timeline; parent role is the customer view
- Parent weekly progress card: shareable image or page with attendance, level and a coach note
- Excused-absence status with reason (exam, illness, festival, travel) and a per-tenant holiday calendar
- About Us page (no per-business customization)
- Two or three demo tenants with different branding (e.g. karate academy, gym, group classes)

### Stretch (only if core is done)

Configurable no-show policy engine (off by default), QR check-in, anonymous class and coach feedback, owner-only trainer scorecard.

### Out of the POC

Payments processing, native app, multi-center passes, ROI calculator, nutrition, broadcast, Hevy import, a full workout logger with charts.

## India market rules

- WhatsApp-first: customers and parents open a magic link in a mobile web page. No install, no passwords. For the POC, generate shareable links and cards only. Do not integrate the WhatsApp Business API.
- UI strings in English, Hindi and Kannada through an i18n layer. Mark Hindi and Kannada drafts "needs native-speaker review".
- Low-end Android, slow networks, offline-capable roll call.
- Positive progress framing by default. The "cost of missed sessions" display is a per-tenant toggle, display only, off by default.

## Privacy and safety

- Seed or fake data only. No real names, photos or children's data.
- Photos are optional. No public display of children's names or photos.
- Parent account is verified by OTP. Collect minimal child data. Log a Proposed decision on the DPDP consent flow and flag the open legal question (whether sports academies are exempt from parental consent) for a lawyer.
- No secrets in the repo. Use environment variables and a .env.example.

## Reuse policy

- Reuse only your own code and dependencies or data under MIT, Apache-2.0, BSD, Unlicense or CC0.
- Never put AGPL or GPL code in the product. Study it as reference only.
- Never copy code, UI designs, images, text, exercise videos or branding from Hevy, Cult.fit or any commercial app. Reimplement mechanisms (waitlist, cancellation window) in our own code and UI.
- Record every third-party dependency and dataset with its license in docs/THIRD_PARTY.md. Verify image and media licenses separately from the dataset license.
- If a license is unclear, do not use it. Write a Proposed decision and move on.
- Gym exercise catalog: import free-exercise-db (Unlicense) with a script.

## Proposed stack (log as Proposed, then proceed)

Next.js + TypeScript, Postgres + Prisma, tenant_id on every table, theme from tenant config, object storage for photos, a dev environment deploy.

## Team and workflow

- Agents match Notion's Assigned Agent values: Planner, Backend, Frontend, QA, Docs.
- Per sprint: Planner creates or refines tasks, then implementers claim one task each, then QA tests every In Review task, then Docs updates the README and demo script, then write a handoff summary on the Sprint page (done, blocked, proposed decisions, what needs a human).
- Maximum 3 agents in parallel, each in its own git worktree and branch. Backend and Frontend agree on an API contract file before building in parallel.
- Task flow: claim (In Progress), do only what the task says, commit, add the link in PR / Link, comment a short summary, set In Review.

## Hard rules

- Never mark a task Done. Never delete tasks, sprints or docs.
- Do not change Priority, Sprint or Assignee on tasks you did not create.
- If requirements are unclear, comment on the task and move to another one. Do not guess.
- Stop and report when: a task is blocked on a human, the same test fails twice, or you would need an architecture, scope or pricing decision.

## Definition of done for the POC

- One documented command starts the app locally with seed data.
- Switching tenant changes name, logo and colors.
- Owner, coach and customer can each log in and see only their own view.
- A coach can log a session and mark attendance, and the member's progress and the owner dashboard update.
- A CSV of members imports without errors.
- Tests pass and the README demo script works from a clean checkout.
