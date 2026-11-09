import type { Principal } from "./principal";

/**
 * Resolves the caller from `Authorization: Bearer <accessToken>`.
 * Placeholder until the magic-link task adds sessions: nobody is authenticated yet.
 */
export async function resolvePrincipal(request: Request): Promise<Principal | null> {
  void request;
  return null;
}
