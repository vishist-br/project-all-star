import { PrismaClient } from "@prisma/client";

/** Returns a connected client, or null when DATABASE_URL is unset/unreachable. */
export async function tryConnect(): Promise<PrismaClient | null> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "[skip] DATABASE_URL is not set; run `npm run db:up` and `npm run db:deploy`, then set DATABASE_URL to the local docker DB.",
    );
    return null;
  }
  const client = new PrismaClient();
  try {
    await client.$queryRaw`SELECT 1`;
    await client.tenant.count();
    return client;
  } catch {
    console.warn(
      "[skip] Database unreachable or not migrated; run `npm run db:up` and `npm run db:deploy` to enable DB tests.",
    );
    await client.$disconnect().catch(() => undefined);
    return null;
  }
}
