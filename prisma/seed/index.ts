import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo";

// Entry point for `npm run db:seed`. Refuses to touch a non-local database unless
// SEED_ALLOW_REMOTE=1 is set on purpose, so demo data can never land in production by accident.
async function main() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(host);
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
  if (!local && process.env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to seed a non-local database. Set SEED_ALLOW_REMOTE=1 to override on purpose.");
  }
  const prisma = new PrismaClient();
  try {
    const ids = await seedDemo(prisma);
    console.log(`Seeded ${ids.length} demo tenants.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
