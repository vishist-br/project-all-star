import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./demo";
import { assertSafeDatabase } from "./guard";

// Entry point for `npm run db:seed`.
async function main() {
  assertSafeDatabase();
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
