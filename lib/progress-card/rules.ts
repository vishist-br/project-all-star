/**
 * Pure rules for the parent weekly progress card (STAR-96). No database, no clock.
 * Privacy: the card shows a first name only, and free text a coach wrote is scrubbed of full names.
 */

export const NOTE_MAX_LENGTH = 280;
/** A shared link stops working after this many days (it can also be revoked at any time). */
export const LINK_LIFETIME_DAYS = 30;
/** Live links per member, so a family cannot pile up forever-open doors by mistake. */
export const MAX_LIVE_LINKS = 10;
/** Goals shown on the card. */
export const MAX_CARD_GOALS = 3;
/** 256-bit token in base64url. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** First word of a display name: the only part of a name that ever appears on a shared card. */
export function firstNameOf(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || displayName.trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Unicode-aware "whole word" match (works for Devanagari and Kannada too, where \b does not). */
const word = (w: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, "giu");

/**
 * Remove full names from free text before it goes onto a shared card: the member's full name
 * becomes the first name, a guardian's full name is dropped, and any other part of the member's
 * name (a surname) is dropped. Text is otherwise untouched.
 */
export function scrubNames(text: string, memberName: string, guardianName?: string | null): string {
  const first = firstNameOf(memberName);
  let out = text;
  if (guardianName && guardianName.trim().length > 0) out = out.replace(word(guardianName.trim()), "");
  const full = memberName.trim().replace(/\s+/g, " ");
  if (full !== first) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(full).replace(/ /g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu"), first);
  }
  const parts = full.split(" ").slice(1).filter((p) => p.length >= 3 && p.toLowerCase() !== first.toLowerCase());
  for (const p of parts) out = out.replace(word(p), "");
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

/** Monday on or before a `YYYY-MM-DD` date. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const iso = ((d.getUTCDay() + 6) % 7); // 0 = Monday
  return new Date(d.getTime() - iso * 86_400_000).toISOString().slice(0, 10);
}

export function isMonday(date: string): boolean {
  return mondayOf(date) === date;
}

export function weekEndOf(weekStart: string): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86_400_000).toISOString().slice(0, 10);
}

/** Positive framing: encouraging line key for the week, from counts only. */
export type Cheer = "great" | "steady" | "restart" | "quiet";
export function cheerFor(attended: number, held: number, streakDays: number): Cheer {
  if (held === 0 && attended === 0) return "quiet";
  if (held > 0 && attended === held) return "great";
  if (attended > 0 || streakDays > 0) return "steady";
  return "restart";
}

/** Link expiry from a creation time. */
export function linkExpiry(now: Date): Date {
  return new Date(now.getTime() + LINK_LIFETIME_DAYS * 86_400_000);
}
