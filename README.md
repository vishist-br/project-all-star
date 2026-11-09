# Project All Star

White-label visibility tool for gyms, arenas and coaching academies. See CLAUDE.md for the standing project rules.

## Run locally

Requires Node 22+ (see `.nvmrc`) and Docker.

```
npm install
npm run start:local
```

`start:local` creates `.env` from `.env.example` if missing, starts Postgres in Docker, applies migrations, and starts the app at http://localhost:3000 (health check: `/api/health`).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Vitest |
| `npm run db:up` / `db:down` | Start / stop local Postgres |
| `npm run db:migrate` | Create a new Prisma migration in dev |
