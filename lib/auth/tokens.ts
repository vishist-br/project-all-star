import { createHash, randomBytes } from "node:crypto";

/** Opaque random token (256 bits). Only its hash is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
