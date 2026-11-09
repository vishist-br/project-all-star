/**
 * Scripts that write demo or catalog data refuse a non-local database unless
 * SEED_ALLOW_REMOTE=1 is set on purpose, so they can never hit production by accident.
 */
export function assertSafeDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example).");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const local = ["localhost", "127.0.0.1", "::1", "[::1]", "db"].includes(host);
  if (!local && env.SEED_ALLOW_REMOTE !== "1") {
    throw new Error("Refusing to write to a non-local database. Set SEED_ALLOW_REMOTE=1 to override on purpose.");
  }
}
