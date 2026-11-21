# Click-through test guide (what is built so far)

All data here is fake ("Sample ..."). No sign-in is needed when demo mode is on.

## Turn on demo mode on the hosted site
Vercel project -> Settings -> Environment Variables -> add `DEMO_MODE` = `true` (Production) -> Deployments -> Redeploy.
Local dev (`npm run dev`) has demo mode on already. Turn it off again before any real customer data is added.

## How to move around
- Top right: **Business** picks one of three sample businesses (karate academy, gym, yoga/dance studio).
- Top right: **View as** picks Owner, Coach or Member / Parent.
- Language box: English, Hindi, Kannada (Hindi and Kannada are drafts awaiting native-speaker review).
- Bottom bar: the screens of the role you are viewing.

## What to check, by role
**Owner**
- Dashboard: active members, batches, overdue fees, recent sessions, coaches.
- Members: table with batch, level, fees, attendance %. Open **Import members** (mock mode in demo): pick `/sample-members.csv`, run the check, see row errors.
- Batches: cards with sport, venue, member count, weekly schedule.
- Workouts: 902 exercises, search and filters, tap one to read the steps.
- Settings: name, logo, colours, language (read-only).

**Coach**: Today, Members, My record are placeholders. Workouts works.
**Member / Parent**: Progress, Schedule, Profile are placeholders. Workouts works.

## Things that should hold
- Switch Business: name, logo and colours change, and people from one business never show in another.
- Switch role: you only see that role's screens. Typing another role's URL shows "not allowed".
- Phone width (about 360px): no sideways scrolling.

## Not built yet
Coach roll call, member progress, attendance views, parent OTP sign-in, workout plans, editing settings, a screen for creating sign-in links.
