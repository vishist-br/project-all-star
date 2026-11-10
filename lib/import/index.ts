import { createHttpImportClient } from "./http-client";
import { mockImportClient } from "./mock-client";
import type { ImportClient } from "./types";

/**
 * Real endpoint (through the same-origin bridge that adds the session cookie) when the page says the
 * visitor is really signed in, or NEXT_PUBLIC_API_MODE=live. The demo switcher uses the mock.
 */
export function getImportClient(live = false): ImportClient {
  return live || process.env.NEXT_PUBLIC_API_MODE === "live" ? createHttpImportClient("/ui", undefined, "/members-import") : mockImportClient;
}

export * from "./types";
