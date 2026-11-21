import { MAX_FILE_BYTES, type ImportResult, type ImportWarning } from "./types";

/** Pure helpers for the owner import screen (no React, no network). */

export type FileProblem = "tooLarge" | "notCsv";

/** Quick check before uploading: size first, then "does it look like a CSV". */
export function checkFile(file: { name: string; size: number; type?: string }): FileProblem | null {
  if (file.size > MAX_FILE_BYTES) return "tooLarge";
  const csvName = /\.csv$/i.test(file.name);
  const csvType = file.type === "text/csv" || file.type === "application/csv";
  return csvName || csvType ? null : "notCsv";
}

/** New members a real import would add: rows without errors, minus rows already in the business. */
export function newMembers(r: Pick<ImportResult, "validRows" | "skippedRows">): number {
  return Math.max(0, r.validRows - (r.skippedRows ?? 0));
}

export type StepKey = "choose" | "check" | "review" | "import";
export const STEPS: readonly StepKey[] = ["choose", "check", "review", "import"];

export type Phase = "idle" | "checking" | "review" | "importing" | "done";
export function stepIndex(phase: Phase): number {
  return phase === "idle" ? 0 : phase === "checking" ? 1 : phase === "review" ? 2 : 3;
}

/** Can the owner confirm the real import? Needs no row errors and at least one new member. */
export function canConfirm(r: ImportResult): boolean {
  return r.errors.length === 0 && newMembers(r) > 0;
}

export type WarningKind = "column" | "batchMissing" | "batchMany" | "sport" | "levelNoSport" | "level" | "other";

/** Map the server's English warning to a kind, so the screen can show friendly translated wording. */
export function warningKind(w: ImportWarning): WarningKind {
  if (w.row === 0) return "column";
  const m = w.message;
  if (w.column === "batch_name") return /more than one/i.test(m) ? "batchMany" : "batchMissing";
  if (w.column === "sport") return "sport";
  if (w.column === "level") return /known sport/i.test(m) ? "levelNoSport" : "level";
  return "other";
}

/** Columns worth showing in the preview: those with at least one value, in file order. */
export function previewColumns(rows: Record<string, string>[]): string[] {
  if (rows.length === 0) return [];
  return Object.keys(rows[0]).filter((c) => rows.some((r) => (r[c] ?? "").trim() !== ""));
}
