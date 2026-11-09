import { parseCsv } from "./csv";
import {
  CSV_COLUMNS,
  ImportFailure,
  MAX_FILE_BYTES,
  MAX_PREVIEW_ROWS,
  type ImportClient,
  type ImportResult,
  type ImportRowError,
} from "./types";

const FEE_STATUS = ["paid", "due", "overdue"];
const PHONE = /^\+?[0-9][0-9 -]{8,13}[0-9]$/;

/** Pure validation of CSV text, shaped like the server's ImportResult. Exported for tests. */
export function validateCsv(text: string, dryRun: boolean): ImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ImportFailure("bad_request", "The file is empty.");
  const header = rows[0].map((h) => h.trim());
  if (!header.includes("name")) throw new ImportFailure("bad_request", 'Missing required column "name".');

  const data = rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      if ((CSV_COLUMNS as readonly string[]).includes(h)) rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });

  const errors: ImportRowError[] = [];
  data.forEach((r, idx) => {
    const row = idx + 1;
    const err = (column: string, message: string) => errors.push({ row, column, message });
    if (!r.name) err("name", "Name is required.");
    for (const col of ["phone", "guardian_phone"]) {
      if (r[col] && !PHONE.test(r[col])) err(col, "Phone number looks invalid.");
    }
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) err("email", "Email looks invalid.");
    if (r.join_date) {
      const d = new Date(`${r.join_date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.join_date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== r.join_date)
        err("join_date", "Use the date format YYYY-MM-DD.");
    }
    if (r.fee_status && !FEE_STATUS.includes(r.fee_status)) err("fee_status", "Use paid, due or overdue.");
  });

  const badRows = new Set(errors.map((e) => e.row)).size;
  const validRows = data.length - badRows;
  const result: ImportResult = {
    dryRun,
    totalRows: data.length,
    validRows,
    preview: data.slice(0, MAX_PREVIEW_ROWS),
    errors,
  };
  // All or nothing, as in the contract: rows are "saved" only when there are no row errors.
  if (!dryRun && errors.length === 0) result.importedRows = validRows;
  return result;
}

/** Stand-in for POST /members/import until the endpoint exists. Saves nothing. */
export const mockImportClient: ImportClient = {
  async importCsv(file, { dryRun }) {
    if (file.size > MAX_FILE_BYTES) throw new ImportFailure("file_too_large", "File too large.");
    return validateCsv(await file.text(), dryRun);
  },
};
