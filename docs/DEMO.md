# Demo script (Sprint 2: the completed POC)

Audience: someone who has never seen the app. Time: about 25 minutes for the full tour, or 10 minutes for the cross-role story (Part 6) alone. Every person, business and contact detail is invented seed data (`Sample ...`, `*.example.test`).

The app shows each role only its own view, backed by the real API and database. Positive framing throughout: it shows what was delivered and how members are progressing.

## Before you start

From a clean checkout (full detail in the README):

```
nvm use
npm install
npm run setup        # .env, Postgres in Docker, migrations
npm run db:seed      # rich demo seed (3 tenants, 12 weeks of history, bookings, plans)
npm run dev          # or: npm run start:local
```

Open http://localhost:3000 in a phone-sized window (about 390 px wide). Outside production two pickers sit at the top: **Business** (three demo tenants) and **View as** (Owner, Coach, Member / Parent). They let you tour every role without signing in. In that mode the app acts as a seeded user of that role (for the Member / Parent view, a member who has an active plan, so there is real data to see).

Seed dates are relative to today, so "today" and "this week" always have sessions. If you re-seed on another day, nothing needs editing.

### The three demo businesses

| Business (seeded name) | Slug | Colours | Sports | Booking cancel window | Cost-of-missed-sessions display |
| --- | --- | --- | --- | --- | --- |
| Sample Dojo (demo karate academy) | `demo-karate` | red, black, gold | Karate (belts White to Black) | 240 min | off |
| Sample Iron Works (demo gym) | `demo-gym` | navy, amber | Gym training | 120 min | on |
| Sample Flow Studio (demo group classes) | `demo-studio` | green, cream, pink | Yoga, dance fitness | 60 min | off |

### Demo accounts

All addresses end in `.example.test`. Sign in with a magic link (Part 7), or just use the pickers.

| Business | Owner | Coach | Customer (adult member) | Customer (parent of a child) |
| --- | --- | --- | --- | --- |
| `demo-karate` | `owner@demo-karate.example.test` | `c1@demo-karate.example.test` (kids' batch), `c2@...` (adults) | `member-a1@demo-karate.example.test` | `parent-g1@demo-karate.example.test` (parent of Sample Kid 01); also `parent-g2` to `parent-g9` |
| `demo-gym` | `owner@demo-gym.example.test` | `c1@demo-gym.example.test`, `c2@...` | `member-m1@demo-gym.example.test` (also `member-m2` to `member-m15`) | none |
| `demo-studio` | `owner@demo-studio.example.test` | `c1@demo-studio.example.test`, `c2@...` | `member-m1@demo-studio.example.test` (also `member-m2` to `member-m15`) | none |

Children have no login of their own. `member-a1` is also the best "member with a plan, a goal and a belt" in the karate tenant; The seed leaves one demo customer on the waitlist of a full class a few days out: `member-m1` in the gym and the studio, and Sample Kid 01 (`parent-g1`) in the karate academy.

## Part 1: switch business (white-label)

Use the **Business** picker. For each of the three businesses watch the heading, logo and colours change. Point out:

- the business name and logo are the business's own; no "Project All Star" branding appears anywhere (white-label);
- the **Language** box offers English, Hindi and Kannada; Hindi and Kannada show a "needs native-speaker review" banner because they are our drafts;
- the footer has an About us page that is the same for every business.

Check as you go: people from one business never appear in another.

## Part 2: owner tour

Pick **View as: Owner** (or sign in as `owner@demo-gym.example.test`). Use `demo-gym` for the whole owner tour unless noted. Bottom navigation: Dashboard, Members, Batches, Workouts, Settings.

1. **Dashboard.** Date range chips (last 7, 30, 90 days). Key numbers: active members, new members, retention, attendance, no-show rate, sessions completed out of scheduled, workout adherence, engagement, each with a change against the previous period. Then trend charts (members, joined and left, sessions scheduled and completed, attendance by week, workouts), attendance and no-show heatmaps by weekday, no-shows by batch, retention by join month, fee status donut (display only: marked by hand, no amounts), group class bookings (seats filled, booked, waitlist, cancelled), and coach workload. Below: **Insights** cards, **Friendly check-ins** (members who may welcome a message, with reason and coach), **Renewal alerts** (fee status shown with recent attendance so a renewal conversation starts from progress) and **Sessions without a roll call** (the owner-side follow-up for a coach who has not logged a session). The quick links lead to Workout plans, Coaches and Members.
2. **Members.** Table of every member with batch, level, fees and attendance; search and filters. Open a member for the full detail: profile, fee status (display only), attendance and workout adherence charts, level, goals, plan, recent attendance and updates. The owner can set goals and see everything.
3. **Batches.** Cards with sport, venue, coach, schedule and places filled (for example "8 of 12 places filled"). Filters by venue and sport.
4. **Coaches.** Reached from the dashboard quick link or Settings ("Coaches and workload"). Sort by name, members, workload or upcoming sessions. Each row shows batches, members, sessions in the next 7 days, active plan assignments, and a workload band (room for more, well balanced, fully booked). Open a coach for their stats: sessions scheduled and completed, consistency, attendance, workout adherence, goals achieved, level promotions, availability, batches and plans.
5. **Workouts.** The exercise library: 902 exercises per business (gym entries from free-exercise-db; karate, yoga and dance drafts marked "Draft: needs trainer review"). Search, filter by muscle, equipment, level and sport. Open one to read the steps. Text only, no images.
6. **Settings.** Brand (name, logo, colours, default language, read-only here) and **Booking rules**: edit the cancellation window (0 to 2880 minutes), turn the waitlist for full classes on or off, and the "Show the cost of missed sessions" toggle (display only, off by default; on in the gym demo). Save, then reload to see it persisted. Only the owner can change these; a coach opening settings gets "not available".
7. **CSV import.** Members, then "Import members from CSV". Choose `public/sample-members.csv` (11 columns, invented people; `Download CSV template` gives the blank template). Steps: Choose file, Check, Review, Import. The check shows rows in the file, new members, already in your list, rows to fix, plus notes (for example a batch name that matches no batch) that do not block the import. Try a broken file (remove the name from a row) to see "Rows to fix" with row and column. Confirm to import; run it again to see everyone reported as "Already in your list" (nothing is added twice). Imported members appear in the Members list and never in another business.

## Part 3: coach tour

Pick **View as: Coach** (or `c1@demo-karate.example.test`). Karate coach c1 has the kids' batch, so the roster includes children with a parent as guardian. Bottom navigation: Today, Members, Plans, Workouts, My record.

1. **Today.** Tabs Today, Week and Availability. Today shows sessions with status, group or one-on-one, "x of y booked", waitlist count and a "Take roll call" button; tomorrow below; earlier sessions still waiting for a roll call are listed so nothing is forgotten. **Schedule a session**: pick a batch session or a one-on-one with one of your members, date and time, optional capacity and title. A heads-up appears if it is outside your weekly availability or overlaps another session. Members who booked see changes in their updates.
2. **Availability.** Add weekly hour ranges per weekday (From, Until), save. These feed the owner's workload view.
3. **Roll call** (open a session). One tap per member moves through the statuses (Not marked, Present, Absent, Excused); **Mark everyone present** for a fast start. "More" opens a sheet for an excused absence with a reason (Exam, Illness, Festival, Travel) and a note. No photo is needed. Booked members and the waitlist are labelled; waitlisted members are not in the roll call until promoted. Then **Complete session**.
4. **Offline roll call.** In the browser dev tools set the network to Offline, keep tapping: the screen shows "n changes saved on this device, waiting for a connection" and each row says "Waiting to sync". Go back online (or press "Sync now"): the status returns to "All changes saved" and the taps reach the server in order, safely repeatable. Completing a session needs a connection and says so.
5. **Plans.** The plans list (draft, active, archived; cadence daily, weekly or monthly; members assigned). **New plan**: title, cadence, days (weekdays for weekly, days of the month for monthly), add exercises from the library with sets, reps or duration, rest. Save as draft or publish. Open a plan to edit (members get an update), **Assign** to members (start date, optional end date, note), or **Archive** (members stop seeing it; history is kept). The assignment UX is a Proposed design pending trainer interviews.
6. **Members.** Roster of your own members only: attendance, workout adherence, plan, and a "Check-in suggested" marker for members who may like a friendly message (filter "Only members who may like a check-in"). Open a member: charts, level, goals (create a goal with a target; add a check-in value for a custom goal; the member sees progress), updates sent, and **Create sign-in link**: a one-time link for the member, or for the parent of a child. It is shown once with a Copy button, works once and expires in 15 minutes. Share it on WhatsApp by hand; nothing is sent automatically.
7. **My record.** Proof of delivered sessions over the last 30 or 90 days: sessions scheduled and completed, sessions waiting to be logged, consistency, member attendance and workout adherence, goals achieved, level promotions, an 8-week chart and the list of recent completed sessions with present, absent and excused counts. Open a row to see its roll call.

A coach cannot open another coach's member (the page says "This member is not one of yours") or any owner screen.

## Part 4: customer tour (member or parent)

Pick **View as: Member / Parent**, or sign in as `member-m1@demo-gym.example.test` (adult) or `parent-g1@demo-karate.example.test` (parent of a child). Bottom navigation: Home, Workouts, Schedule, Progress, Profile. A parent sees the child's data, not their own.

1. **Home.** Today's workouts, the next session (Booked or On the waitlist), a short "What's new" with an unread count, and "Your last 30 days": an active-days streak and level.
2. **Workouts.** Assigned plans and what is coming up. On an exercise tap **Start**, then **Stop** (pause) or **Complete**; status goes To do, In progress, Paused, Done. Tap an exercise to read the steps. Rest days say so. Go offline and tap: "Saved on this phone. It will sync when you are back online." and the row shows "Waiting to sync"; it syncs on reconnect without duplicates. A workout can only be started on its own day.
3. **Updates.** Open from Home. Every change the coach makes lands here: plan assigned or edited or ended, goal set or updated, session scheduled, rescheduled or cancelled, booking confirmed, promoted from the waitlist. Opening the page marks them read.
4. **Schedule.** Week and month views of the business's sessions. **Book** a group class with places left. A full class offers **Join waiting list** (shows the position; with the waitlist turned off in Settings it says "This class is full right now"). **Cancel booking** works until the cancellation window closes (the screen shows "You can cancel until ..." and, once closed, explains and sends the member to their coach). A holiday is shown as a holiday, not as a miss. The seed leaves the demo customer on the waitlist for a full class a few days out: try Leave waiting list and Join waiting list.
5. **Progress.** Level or belt with a ring towards the next level, goals with percent complete and check-ins, attendance (current and longest streak, hours), workouts completed versus pending with weekly chart, achievements, and recent history (attended, missed, excused with reason, workout started and paused). In the gym demo (cost display on) a note explains what missed classes mean for the timeline; excused absences and holidays never count as missed. Wording stays positive.
6. **Profile.** The member's details at this business, level, and sign-out.

Switch the language to Hindi or Kannada on any screen to show the review banner.

## Part 5: privacy and role separation

- While viewing as Coach, type an owner address such as `/owner/dashboard`: you get "This screen is not available for your role" and a link to your own home. The same holds for every role pair.
- A customer cannot see other members, or other members' names, anywhere (the updates feed never names another member).
- No children's photos exist and no names are shown publicly; seed children are "Sample Kid 01" and so on.
- At 360 px width nothing scrolls sideways on any main screen.

## Part 6: the cross-role sync story (the heart of the demo)

Open three browser windows (or one normal and two private windows), each signed in by magic link as a different role of the same business, for example `demo-gym`: owner, coach `c1`, customer `member-m1`. This is exactly what `e2e/cross-role.spec.ts` automates.

1. **Plan to progress.** Coach: Plans, build "Demo plan" with two exercises, Assign to Sample Member 01. Customer: Home now shows the plan's workouts today and "What's new" has "plan assigned". Customer: Start and Complete both exercises. Coach: open Sample Member 01: workout adherence moved. Owner: Dashboard "Workout adherence" and Engagement reflect it.
2. **Edit reaches the customer.** Coach edits the plan (change reps) and saves. Customer: Updates shows "plan updated" and the new reps.
3. **Roll call to dashboards.** Coach: Today, open a session, mark Sample Member 01 Excused (reason Travel) and everyone else Present, Complete. Customer: Progress shows an excused day with its reason and no missed class; the streak and attendance update. Owner: Dashboard sessions completed and attendance move; a session that ended more than two hours ago and had no roll call drops off the "Sessions without a roll call" card. A session on a holiday is never counted as missed.
4. **Booking and waitlist.** Customer: Schedule, open a full class and Join waiting list. A second customer cancels a booking inside the window; the first is promoted automatically and sees "promoted from the waitlist" in Updates. Owner: the dashboard bookings ring and the coach card show the seats and waitlist. Owner lowers the cancellation window to 0 in Settings: a customer who tries to cancel inside the closed window is told it has closed.
5. **Goal.** Coach: member detail, New goal "Run 3 km", add check-ins. Customer: Progress shows the percent move with each check-in; Updates announces the goal.
6. **Import.** Owner imports `public/sample-members.csv`: the new members appear in the owner list and the coach roster only if assigned to a batch, and never in another business.
7. **Offline.** Coach takes a roll call offline, reconnects, and the owner dashboard reflects it; a customer's offline workout taps sync on reconnect.

## Part 7: real sign-in with a magic link

The pickers are a convenience for demos. Real sign-in:

1. As the owner or a coach, open a member and press **Create sign-in link** (Part 3). Or, in development, use the dev route:

```
curl -s -X POST http://localhost:3000/api/v1/dev/magic-link \
  -H 'content-type: application/json' \
  -d '{"tenantSlug":"demo-karate","email":"parent-g1@demo-karate.example.test"}'
```

2. Open the returned `url` in a private window. It signs that window in as that user; the bottom bar and data are now the real ones. The link works once and expires after 15 minutes: opening it again shows "This link cannot be used". The email must belong to that business (the wrong business returns 404).
3. Sessions last 1 hour (refreshed automatically) up to 30 days. **Sign out** returns to the sign-in-needed page.
4. A signed-in browser ignores the pickers: a coach cannot become an owner by changing a cookie.

On a hosted production-mode site the dev route is off; use Create sign-in link or the one-off script in the README.

## Part 8: automated proof

From a clean checkout with Postgres running (see the README and `docs/TESTING.md`): `npm run typecheck`, `npm run lint`, `npm test` (772 tests at the last full run on 2026-11-22), `npm run test:isolation` and `npm run test:e2e` (including the 15 cross-role scenarios).
