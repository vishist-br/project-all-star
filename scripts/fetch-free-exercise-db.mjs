// Refreshes data/free-exercise-db/exercises.json from the pinned upstream commit.
// Usage: node scripts/fetch-free-exercise-db.mjs [commitSha]
// Image paths are dropped on purpose: the licence of the image files is not stated upstream,
// so we do not use them (see docs/THIRD_PARTY.md).
import { mkdirSync, writeFileSync } from "node:fs";

const PINNED = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
const commit = process.argv[2] ?? PINNED;
const base = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${commit}`;

const res = await fetch(`${base}/dist/exercises.json`);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const raw = await res.json();
const exercises = raw.map((e) => {
  const copy = { ...e };
  delete copy.images;
  return copy;
});

mkdirSync("data/free-exercise-db", { recursive: true });
writeFileSync(
  "data/free-exercise-db/exercises.json",
  JSON.stringify({ source: "https://github.com/yuhonas/free-exercise-db", license: "Unlicense", commit, exercises }) + "\n",
);
console.log(`Wrote ${exercises.length} exercises from commit ${commit}`);
