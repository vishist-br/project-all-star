// One-command local setup: env file, Postgres (docker), Prisma client + schema.
import { copyFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!existsSync(".env")) {
  copyFileSync(".env.example", ".env");
  console.log("Created .env from .env.example");
}
run("npm run db:up");
run("npx prisma generate");
run("npx prisma migrate deploy");
