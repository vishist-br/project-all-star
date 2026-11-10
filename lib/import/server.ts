import { ApiError } from "../auth/errors";
import type { TenantClient } from "../tenant-scope";
import { parseCsv } from "./csv";
import { CSV_COLUMNS, MAX_FILE_BYTES, MAX_PREVIEW_ROWS, type ImportResult, type ImportRowError } from "./types";

/**
 * Server side of POST /members/import (docs/api/openapi.yaml).
 *
 * Rules (decided in STAR-37, see the PR comment):
 *  - Only `name` is a required column. A row may have no contact details at all.
 *  - All or nothing: rows are written in one transaction, and only when there are no row errors.
 *  - Re-import is idempotent: a row whose (name, contact phone) already exists in the caller's
 *    tenant is SKIPPED (counted in `skippedRows`), not an error and not a duplicate.
 *    Contact phone = the member's own phone for adults, the guardian's phone for children.
 *  - The same (name, contact) twice inside one file is a row error ("Duplicate of row N").
 *  - Excel and PDF are explicitly not handled; CSV (UTF-8) only.
 *  - batch_name / sport / level that do not exist yet are NOT created (batches need a venue and
 *    a coach); the row is still imported and a warning explains what was not linked.
 *  - email is validated but not stored (members have no email column; minimal data).
 */

export const MAX_ROWS = 2000;
const FEE: Record<string, "PAID" | "DUE" | "OVERDUE"> = { paid: "PAID", due: "DUE", overdue: "OVERDUE" };
const PHONE = /^\+?[0-9][0-9 -]{8,13}[0-9]$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type ImportWarning = { row: number; column?: string | null; message: string };
export type ServerImportResult = ImportResult & { skippedRows: number; warnings: ImportWarning[] };

type Row = Record<string, string>;
type Planned = {
  name: string;
  phone: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  joinedOn: Date | null;
  feeStatus: "PAID" | "DUE" | "OVERDUE" | null;
  batchId: string | null;
  levelId: string | null;
  sportId: string | null;
  goal: string | null;
};

const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const keyOf = (name: string, contact: string) => `${norm(name)}|${digits(contact)}`;

/** Reject oversized, Excel and PDF uploads with a clear message. */
export function assertCsvUpload(file: File, text: string): void {
  if (file.size > MAX_FILE_BYTES) throw new ApiError("payload_too_large", "File is larger than 2 MB.");
  const binary = text.startsWith("PK") || text.startsWith("%PDF") || text.includes("\u0000");
  if (/\.(xlsx?|xlsm|pdf)$/i.test(file.name) || binary) {
    throw new ApiError(
      "validation_failed",
      "Excel and PDF files are not supported yet. Please save the file as CSV (UTF-8) and upload it again.",
    );
  }
}

async function plan(db: TenantClient, text: string, dryRun: boolean): Promise<{ result: ServerImportResult; planned: Planned[] }> {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new ApiError("validation_failed", "The file is empty.");
  const header = rows[0].map((h) => h.trim());
  if (!header.includes("name")) throw new ApiError("validation_failed", 'Missing required column "name".');
  if (rows.length - 1 > MAX_ROWS) throw new ApiError("validation_failed", `Too many rows (maximum ${MAX_ROWS} per file).`);
  const known = CSV_COLUMNS as readonly string[];
  const warnings: ImportWarning[] = header
    .filter((h) => h && !known.includes(h))
    .map((c) => ({ row: 0, column: c, message: `Column "${c}" is not recognised and was ignored.` }));

  const data: Row[] = rows.slice(1).map((cells) => {
    const rec: Row = {};
    for (const c of CSV_COLUMNS) rec[c] = "";
    header.forEach((h, i) => {
      if (known.includes(h)) rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });

  // Reference data, read through the tenant-scoped client (caller's tenant only).
  const [existing, batches, sports, levels] = await Promise.all([
    db.member.findMany({ select: { displayName: true, phone: true, guardian: { select: { phone: true } } } }),
    db.batch.findMany({ select: { id: true, name: true } }),
    db.sport.findMany({ select: { id: true, name: true, slug: true } }),
    db.level.findMany({ select: { id: true, sportId: true, name: true } }),
  ]);
  const existingKeys = new Set(existing.map((m) => keyOf(m.displayName, m.phone ?? m.guardian?.phone ?? "")));
  const batchByName = new Map<string, string[]>();
  for (const b of batches) batchByName.set(norm(b.name), [...(batchByName.get(norm(b.name)) ?? []), b.id]);

  const errors: ImportRowError[] = [];
  const planned: Planned[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;

  data.forEach((r, idx) => {
    const row = idx + 1;
    const rowErrors: ImportRowError[] = [];
    const err = (column: string, message: string) => rowErrors.push({ row, column, message });
    if (!r.name) err("name", "Name is required.");
    else if (r.name.length > 120) err("name", "Name is too long (maximum 120 characters).");
    for (const col of ["phone", "guardian_phone"]) if (r[col] && !PHONE.test(r[col])) err(col, "Phone number looks invalid.");
    if (r.email && !EMAIL.test(r.email)) err("email", "Email looks invalid.");
    let joinedOn: Date | null = null;
    if (r.join_date) {
      const d = new Date(`${r.join_date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.join_date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== r.join_date)
        err("join_date", "Use the date format YYYY-MM-DD.");
      else joinedOn = d;
    }
    if (r.fee_status && !FEE[r.fee_status]) err("fee_status", "Use paid, due or overdue.");
    if (r.guardian_phone && !r.guardian_name) err("guardian_name", "Guardian name is required when a guardian phone is given.");
    if (r.guardian_name && r.phone) err("phone", "A child's phone is not stored; use guardian_phone for children.");

    if (rowErrors.length === 0) {
      const key = keyOf(r.name, r.guardian_name ? r.guardian_phone : r.phone);
      const first = seen.get(key);
      if (first !== undefined) err("name", `Duplicate of row ${first} in this file.`);
      else {
        seen.set(key, row);
        if (existingKeys.has(key)) {
          skipped++;
          return;
        }
      }
    }
    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }

    // Optional links. Never created here; unresolved values become warnings.
    const warn = (column: string, message: string) => warnings.push({ row, column, message });
    let batchId: string | null = null;
    if (r.batch_name) {
      const ids = batchByName.get(norm(r.batch_name));
      if (ids?.length === 1) batchId = ids[0];
      else warn("batch_name", ids ? "More than one batch has this name; member was not enrolled." : "No batch with this name; member was not enrolled.");
    }
    let sportId: string | null = null;
    if (r.sport) {
      const s = sports.find((x) => norm(x.name) === norm(r.sport) || x.slug === norm(r.sport));
      if (s) sportId = s.id;
      else warn("sport", "No sport with this name; sport was not linked.");
    }
    let levelId: string | null = null;
    if (r.level) {
      const l = sportId ? levels.find((x) => x.sportId === sportId && norm(x.name) === norm(r.level)) : undefined;
      if (l) levelId = l.id;
      else warn("level", sportId ? "No level with this name for that sport; level was not recorded." : "Level needs a known sport; level was not recorded.");
    }
    planned.push({
      name: r.name.replace(/\s+/g, " "),
      phone: r.guardian_name ? null : r.phone || null,
      guardianName: r.guardian_name || null,
      guardianPhone: r.guardian_phone || null,
      joinedOn,
      feeStatus: r.fee_status ? FEE[r.fee_status] : null,
      batchId,
      levelId,
      sportId,
      goal: r.goal || null,
    });
  });

  const badRows = new Set(errors.map((e) => e.row)).size;
  return {
    planned,
    result: {
      dryRun,
      totalRows: data.length,
      validRows: data.length - badRows,
      preview: data.slice(0, MAX_PREVIEW_ROWS),
      errors,
      skippedRows: skipped,
      warnings,
    },
  };
}

async function write(tx: TenantClient, planned: Planned[]): Promise<void> {
  const guardianCache = new Map<string, string>();
  const existingGuardians = await tx.guardian.findMany({ select: { id: true, name: true, phone: true } });
  for (const g of existingGuardians) guardianCache.set(keyOf(g.name, g.phone ?? ""), g.id);
  const today = new Date(new Date().toISOString().slice(0, 10));
  for (const p of planned) {
    let guardianId: string | null = null;
    if (p.guardianName) {
      const gk = keyOf(p.guardianName, p.guardianPhone ?? "");
      guardianId = guardianCache.get(gk) ?? null;
      if (!guardianId) {
        guardianId = (await tx.guardian.create({ data: { name: p.guardianName, phone: p.guardianPhone } as never, select: { id: true } })).id;
        guardianCache.set(gk, guardianId);
      }
    }
    const day = p.joinedOn ?? today;
    const member = await tx.member.create({
      data: {
        displayName: p.name,
        phone: p.phone,
        isMinor: Boolean(p.guardianName),
        guardianId,
        joinedOn: day,
        ...(p.feeStatus ? { feeStatus: p.feeStatus } : {}),
      } as never,
      select: { id: true },
    });
    if (p.batchId) await tx.batchMember.create({ data: { batchId: p.batchId, memberId: member.id, joinedOn: day } as never });
    if (p.levelId) await tx.memberLevel.create({ data: { memberId: member.id, levelId: p.levelId, achievedOn: day } as never });
    if (p.goal) await tx.goal.create({ data: { memberId: member.id, sportId: p.sportId, title: p.goal } as never });
  }
}

export async function importMembers(db: TenantClient, tenantId: string, text: string, dryRun: boolean): Promise<ServerImportResult> {
  if (dryRun) return (await plan(db, text, true)).result;
  return db.$transaction(
    async (rawTx) => {
      const tx = rawTx as unknown as TenantClient;
      // One import per tenant at a time, so two concurrent uploads cannot both create the same member.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
      const { result, planned } = await plan(tx, text, false);
      if (result.errors.length > 0) return result;
      await write(tx, planned);
      result.importedRows = planned.length;
      return result;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}
