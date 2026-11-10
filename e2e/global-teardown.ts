import { dropScratchDb } from "./db";

export default async function globalTeardown() {
  await dropScratchDb().catch(() => {});
}
