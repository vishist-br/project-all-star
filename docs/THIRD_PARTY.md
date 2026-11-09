# Third-party dependencies and licenses

Policy: MIT, Apache-2.0, BSD, Unlicense or CC0 only (see CLAUDE.md). Update this file whenever a dependency or dataset is added.

## Runtime dependencies (direct)

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| next | ^16.4.5 | MIT | Web framework |
| react, react-dom | ^19.3.1 | MIT | UI library |
| @prisma/client | ^6.19.3 | Apache-2.0 | Database client |

## Dev dependencies (direct)

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| typescript | ^6.0.3 | Apache-2.0 | Type checking |
| prisma | ^6.19.3 | Apache-2.0 | Schema and migrations CLI |
| eslint | ^9.39.5 | MIT | Linting |
| eslint-config-next | ^16.4.5 | MIT | Lint rules |
| vitest | ^3.2.7 | MIT | Tests |
| tsx | see package.json | MIT | Runs the TypeScript seed and import scripts (`npm run db:seed`) |
| @types/node, @types/react, @types/react-dom | see package.json | MIT | Type definitions |

## Self-written code (no dependency)

| Item | License | Purpose |
| --- | --- | --- |
| lib/i18n (en/hi/kn) | Own code | Small i18n layer; no i18n library added, so no new dependency or licence. Hindi and Kannada strings are our own drafts, marked "needs native-speaker review". |
| data/exercises/original-sports.json | Own content | Draft exercises for karate, yoga and dance fitness. All text self-written (no text, images or videos from Hevy, Cult.fit or any commercial app). Every entry is flagged "needs trainer review". |

## Infrastructure (not bundled in the repo)

| Item | License | Purpose |
| --- | --- | --- |
| postgres:16-alpine Docker image | PostgreSQL License (BSD-style) | Local database via docker-compose |

## Transitive dependency scan (node_modules, license field)

MIT 338, Apache-2.0 29, ISC 13, BSD-2-Clause 8, BSD-3-Clause 3, CC0-1.0 1, 0BSD 1 (tslib), plus the exceptions below.

## Items needing a human look

- **@img/sharp-libvips-* (LGPL-3.0-or-later)**: RESOLVED by removal. Next.js pulls `sharp` in as an optional dependency for image optimization. We replace it with an empty MIT stub (`vendor/sharp-stub`, wired in through `overrides` in package.json) and set `images.unoptimized: true`, so no LGPL binary is installed or shipped (verified: no libvips files in node_modules). Consequence: serve pre-sized images, for example tenant logos. `npm ls sharp` prints an "invalid" warning because of the stub; builds, lint and tests pass.
- **caniuse-lite (CC-BY-4.0)**: browser-support data from the Can I Use project (https://caniuse.com), used by Next/browserslist at build time. Attribution recorded here. Proposed exception: build-time data only, not product code.
- **argparse (Python-2.0)**: dev tooling only (via eslint); permissive PSF-style licence. Flag for confirmation.
- **axe-core (MPL-2.0)**: dev only (via eslint-config-next accessibility lint rules); not shipped. Flag for confirmation.
- **Node/tooling note**: Prisma 7 and Vitest 4 reject Node 23 (the locally installed version), so Prisma 6.19.3 and Vitest 3.2.7 are pinned. `npm audit` reports moderate dev-only advisories in Vitest 3.x (`@vitest/mocker`; only reachable via Vitest browser/UI mode, which is not used). Upgrade to Prisma 7 / Vitest 4 once the team standardises on Node 22 LTS (see `.nvmrc`).

## Datasets

| Dataset | License | Pinned source commit | Use |
| --- | --- | --- | --- |
| free-exercise-db (https://github.com/yuhonas/free-exercise-db) | The Unlicense (public domain; copy in `data/free-exercise-db/LICENSE.md`) | `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` | Gym exercise text/metadata, 876 entries, vendored at `data/free-exercise-db/exercises.json` by `scripts/fetch-free-exercise-db.mjs` and loaded by `npm run db:import-exercises` |

**Images and media: NOT used.** The Unlicense covers the repository, but upstream does not state where its exercise photos came from (the README says the data was restructured from another project, wrkout/exercises.json, and the photos' own provenance and licence are not recorded). Per the reuse policy an unclear licence means we do not use it: the fetch script drops all image paths, the `exercises` table has no image column, and a Proposed decision is logged in Decisions & Docs. Exercise videos from any commercial app are never used.
