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
| @types/node, @types/react, @types/react-dom | see package.json | MIT | Type definitions |

## Infrastructure (not bundled in the repo)

| Item | License | Purpose |
| --- | --- | --- |
| postgres:16-alpine Docker image | PostgreSQL License (BSD-style) | Local database via docker-compose |

## Transitive dependency scan (node_modules, license field)

MIT 338, Apache-2.0 29, ISC 13, BSD-2-Clause 8, BSD-3-Clause 3, CC0-1.0 1, 0BSD 1 (tslib), plus the exceptions below.

## Items needing a human look

- **@img/sharp-libvips-* (LGPL-3.0-or-later)**: optional prebuilt native binary pulled in by Next.js via `sharp` (image optimization). It is a dynamically linked prebuilt library, not our code, but LGPL is not on the allowed list. Not used by any code in this scaffold. A Proposed decision is needed on whether to keep it, or to exclude it (for example `npm i --omit=optional` in deploys, or `images.unoptimized`).
- **caniuse-lite (CC-BY-4.0)**: browser-support data used by Next/browserslist at build time; attribution licence, not shipped as product code. Flag for confirmation.
- **argparse (Python-2.0)**: dev tooling only (via eslint); permissive PSF-style licence. Flag for confirmation.
- **axe-core (MPL-2.0)**: dev only (via eslint-config-next accessibility lint rules); not shipped. Flag for confirmation.
- **Node/tooling note**: Prisma 7 and Vitest 4 reject Node 23 (the locally installed version), so Prisma 6.19.3 and Vitest 3.2.7 are pinned. `npm audit` reports moderate dev-only advisories in Vitest 3.x (`@vitest/mocker`; only reachable via Vitest browser/UI mode, which is not used). Upgrade to Prisma 7 / Vitest 4 once the team standardises on Node 22 LTS (see `.nvmrc`).

## Datasets

None yet (free-exercise-db, Unlicense, is imported by a later task).
