import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * One client per server instance. On Vercel (serverless) point DATABASE_URL at the pooled
 * (pgbouncer) Neon host and keep `connection_limit` small in the URL (for example 5) so many
 * warm lambdas do not exhaust Postgres; the direct host is only for `prisma migrate` (see README).
 * PERF_LOG=1 prints one `PQ <ms>` line per query so scripts can count queries per page.
 */
function warnOnPoolConfig(): void {
  if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) return;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    const notes: string[] = [];
    if (!url.hostname.includes("-pooler")) notes.push("host is not a Neon pooled (-pooler) host");
    if (!url.searchParams.has("connection_limit")) notes.push("no connection_limit");
    if (url.hostname.includes("-pooler") && url.searchParams.get("pgbouncer") !== "true") notes.push("no pgbouncer=true");
    // Names only, never the URL or any part of its value.
    if (notes.length) console.warn(`[db] DATABASE_URL pool settings: ${notes.join("; ")}`);
  } catch {
    // An unparsable URL fails loudly on the first query anyway.
  }
}

function createClient(): PrismaClient {
  warnOnPoolConfig();
  if (process.env.PERF_LOG !== "1") return new PrismaClient();
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  client.$on("query", (e) => console.log(`PQ ${e.duration}`));
  return client as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
