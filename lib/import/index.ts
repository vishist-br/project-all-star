import { createHttpImportClient } from "./http-client";
import { mockImportClient } from "./mock-client";
import type { ImportClient } from "./types";

/** Mock by default. Set NEXT_PUBLIC_API_MODE=live to use the real endpoint once it exists. */
export function getImportClient(): ImportClient {
  return process.env.NEXT_PUBLIC_API_MODE === "live" ? createHttpImportClient() : mockImportClient;
}

export * from "./types";
