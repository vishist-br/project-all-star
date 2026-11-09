import { PrismaClient } from "@prisma/client";
import { assertSafeDatabase } from "../seed/guard";
import { importCatalog, loadAllEntries } from "./import";

// `npm run db:import-exercises` loads the catalog into every tenant.
// `npm run db:import-exercises -- demo-gym` limits it to one tenant slug.
async function main() {
  assertSafeDatabase();
  const slug = process.argv[2];
  const prisma = new PrismaClient();
  try {
    const tenants = await prisma.tenant.findMany({ where: slug ? { slug } : {}, select: { id: true, slug: true } });
    if (tenants.length === 0) throw new Error(slug ? `No tenant with slug "${slug}".` : "No tenants yet; run npm run db:seed first.");
    const entries = loadAllEntries();
    for (const t of tenants) {
      const { total } = await importCatalog(prisma, t.id, entries);
      console.log(`${t.slug}: ${total} exercises upserted.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
