import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Scratch database for the smoke test. Local Postgres only (docker compose db, credentials
 * from .env.example). It never reads .env/.env.local or DATABASE_URL, so it cannot touch a
 * cloud or production database.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3211);
export const E2E_DB_NAME = process.env.E2E_DB_NAME ?? "allstar_e2e_smoke";
const ADMIN_URL =
  process.env.E2E_ADMIN_URL ?? "postgresql://allstar:allstar_local_dev@localhost:5432/postgres?schema=public";

export function scratchUrl(): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${E2E_DB_NAME}`;
  return u.toString();
}

function assertSafe() {
  const host = new URL(ADMIN_URL).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`E2E refuses non-local database host: ${host}`);
  if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(E2E_DB_NAME)) throw new Error("E2E_DB_NAME must be a lowercase name containing 'e2e'");
}

async function admin<T>(fn: (p: PrismaClient) => Promise<T>): Promise<T> {
  const p = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  try {
    return await fn(p);
  } finally {
    await p.$disconnect();
  }
}

export async function dropScratchDb() {
  assertSafe();
  await admin((p) => p.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${E2E_DB_NAME}" WITH (FORCE)`));
}

/** Fresh database, migrations applied, demo tenants seeded. */
export async function createSeededDb() {
  assertSafe();
  await dropScratchDb();
  await admin((p) => p.$executeRawUnsafe(`CREATE DATABASE "${E2E_DB_NAME}"`));
  const env = { ...process.env, DATABASE_URL: scratchUrl() };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "inherit" });
  execFileSync("npm", ["run", "db:seed"], { env, stdio: "inherit" });
}
