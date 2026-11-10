import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // DB-backed files share one database and the same seeded demo tenants, so run files one at a time.
  test: { include: ["tests/**/*.test.ts"], fileParallelism: false },
});
