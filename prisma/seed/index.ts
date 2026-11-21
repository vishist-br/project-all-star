import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo";
import { assertSafeDatabase } from "./guard";

// Entry point for `npm run db:seed`: base demo seed plus the rich layer (plans, logs, goals,
// bookings, ...). Set SEED_TODAY=YYYY-MM-DD to pin the anchor date.
async function main() {
  assertSafeDatabase();
  const prisma = new PrismaClient();
  try {
    const started = Date.now();
    const ids = await seedDemo(prisma, { rich: true });
    console.log(`Seeded ${ids.length} demo tenants (with plans, logs, goals, bookings) in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
