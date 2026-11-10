import { spawn } from "node:child_process";
import { createSeededDb, dropScratchDb, E2E_PORT, scratchUrl } from "./db";

/**
 * Started by Playwright (webServer). Seeds a scratch DB, then serves the app on a free port.
 * `next dev` (not `next start`) is used on purpose: POST /api/v1/dev/magic-link answers 404
 * when NODE_ENV=production, so the real magic-link API can only be exercised in non-production.
 * DEMO_MODE=true keeps the tenant/role switcher visible either way.
 */
async function main() {
  await createSeededDb();
  const child = spawn("npx", ["next", "dev", "--port", String(E2E_PORT), "--hostname", "127.0.0.1"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: scratchUrl(),
      APP_BASE_URL: `http://127.0.0.1:${E2E_PORT}`,
      DEMO_MODE: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  });
  const stop = () => {
    child.kill("SIGTERM");
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  child.on("exit", async (code) => {
    await dropScratchDb().catch(() => {});
    process.exit(code ?? 0);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
