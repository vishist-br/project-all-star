// Mirrors ImportResult in docs/api/openapi.yaml (POST /members/import).
export type ImportRowError = { row: number; column?: string | null; message: string };

/** A note that does not stop the import. row 0 means the whole file (for example an unknown column). */
export type ImportWarning = { row: number; column?: string | null; message: string };

export type ImportResult = {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  /** Present only when dryRun is false and the import succeeded. */
  importedRows?: number;
  /** First rows as parsed (max 20). */
  preview?: Record<string, string>[];
  errors: ImportRowError[];
  /** Rows that match members already in the business (same name and phone). Skipped, not an error. */
  skippedRows?: number;
  warnings?: ImportWarning[];
};

/** Whole-file problems (HTTP 400 / 401 / 403 / 413 in the contract), as opposed to row errors. */
export type ImportFailureCode = "file_too_large" | "not_csv" | "bad_request" | "forbidden" | "network";
export class ImportFailure extends Error {
  constructor(public code: ImportFailureCode, message: string) {
    super(message);
  }
}

/** The screen talks to the real endpoint through this interface (same-origin bridge at /ui/members-import). */
export interface ImportClient {
  importCsv(file: File, opts: { dryRun: boolean }): Promise<ImportResult>;
}

export const CSV_COLUMNS = [
  "name",
  "phone",
  "email",
  "guardian_name",
  "guardian_phone",
  "batch_name",
  "sport",
  "level",
  "goal",
  "join_date",
  "fee_status",
] as const;

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PREVIEW_ROWS = 20;
