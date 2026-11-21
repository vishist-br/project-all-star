import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCsv } from "../lib/import/csv";
import { createHttpImportClient } from "../lib/import/http-client";
import { CSV_COLUMNS, ImportFailure, MAX_FILE_BYTES } from "../lib/import/types";
import { canConfirm, checkFile, newMembers, previewColumns, stepIndex, warningKind } from "../lib/import/view";

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("sample template", () => {
  it("has exactly the columns the importer knows, in order", () => {
    const text = readFileSync("public/sample-members.csv", "utf8");
    expect(text.split("\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(parseCsv(text)).toHaveLength(4);
  });
});

describe("checkFile", () => {
  it("accepts csv by name or type, rejects other types and big files", () => {
    expect(checkFile({ name: "members.csv", size: 10 })).toBeNull();
    expect(checkFile({ name: "MEMBERS.CSV", size: 10 })).toBeNull();
    expect(checkFile({ name: "export", size: 10, type: "text/csv" })).toBeNull();
    expect(checkFile({ name: "members.xlsx", size: 10 })).toBe("notCsv");
    expect(checkFile({ name: "notes.txt", size: 10, type: "text/plain" })).toBe("notCsv");
    expect(checkFile({ name: "members.csv", size: MAX_FILE_BYTES + 1 })).toBe("tooLarge");
    expect(checkFile({ name: "members.xlsx", size: MAX_FILE_BYTES + 1 })).toBe("tooLarge");
  });
});

describe("result helpers", () => {
  const base = { dryRun: true, totalRows: 5, validRows: 5, errors: [] };
  it("counts new members as valid rows minus skipped", () => {
    expect(newMembers({ validRows: 5, skippedRows: 2 })).toBe(3);
    expect(newMembers({ validRows: 1, skippedRows: 4 })).toBe(0);
    expect(newMembers({ validRows: 3 })).toBe(3);
  });
  it("lets the owner confirm only with no errors and something new", () => {
    expect(canConfirm({ ...base, skippedRows: 2 })).toBe(true);
    expect(canConfirm({ ...base, skippedRows: 5 })).toBe(false);
    expect(canConfirm({ ...base, errors: [{ row: 1, message: "x" }] })).toBe(false);
    expect(canConfirm({ ...base, totalRows: 0, validRows: 0 })).toBe(false);
  });
  it("maps phases to steps", () => {
    expect(["idle", "checking", "review", "importing", "done"].map((p) => stepIndex(p as never))).toEqual([0, 1, 2, 3, 3]);
  });
  it("classifies server warnings for friendly wording", () => {
    expect(warningKind({ row: 0, column: "nickname", message: "Column ..." })).toBe("column");
    expect(warningKind({ row: 2, column: "batch_name", message: "No batch with this name; member was not enrolled." })).toBe("batchMissing");
    expect(warningKind({ row: 2, column: "batch_name", message: "More than one batch has this name; member was not enrolled." })).toBe("batchMany");
    expect(warningKind({ row: 2, column: "sport", message: "No sport with this name; sport was not linked." })).toBe("sport");
    expect(warningKind({ row: 2, column: "level", message: "Level needs a known sport; level was not recorded." })).toBe("levelNoSport");
    expect(warningKind({ row: 2, column: "level", message: "No level with this name for that sport; level was not recorded." })).toBe("level");
    expect(warningKind({ row: 2, column: "goal", message: "Something new" })).toBe("other");
  });
  it("shows only preview columns that have values", () => {
    expect(previewColumns([])).toEqual([]);
    expect(previewColumns([{ name: "A", phone: "", goal: "g" }, { name: "B", phone: "", goal: "" }])).toEqual(["name", "goal"]);
  });
});

describe("http import client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const file = new File(["name\nA"], "m.csv");
  const stub = (res: Response | Error) => vi.stubGlobal("fetch", vi.fn(async () => { if (res instanceof Error) throw res; return res; }));

  it("posts to the same-origin bridge and fills in skippedRows and warnings", async () => {
    const fetchMock = vi.fn(async () => Response.json({ dryRun: true, totalRows: 1, validRows: 1, errors: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await createHttpImportClient().importCsv(file, { dryRun: true });
    expect(fetchMock).toHaveBeenCalledWith("/ui/members-import?dryRun=true", expect.objectContaining({ method: "POST" }));
    expect(r.skippedRows).toBe(0);
    expect(r.warnings).toEqual([]);
  });
  it("keeps what the server sends", async () => {
    stub(Response.json({ dryRun: false, totalRows: 2, validRows: 2, importedRows: 1, skippedRows: 1, warnings: [{ row: 0, column: "x", message: "m" }], errors: [] }));
    const r = await createHttpImportClient().importCsv(file, { dryRun: false });
    expect(r).toMatchObject({ importedRows: 1, skippedRows: 1, warnings: [{ row: 0 }] });
  });
  it("maps failures to codes", async () => {
    const code = async () => createHttpImportClient().importCsv(file, { dryRun: true }).catch((e: ImportFailure) => e.code);
    stub(new Error("offline"));
    expect(await code()).toBe("network");
    stub(Response.json({}, { status: 413 }));
    expect(await code()).toBe("file_too_large");
    stub(Response.json({}, { status: 403 }));
    expect(await code()).toBe("forbidden");
    stub(Response.json({ error: { code: "validation_failed", message: "Excel and PDF files are not supported yet." } }, { status: 400 }));
    expect(await code()).toBe("not_csv");
    stub(Response.json({ error: { code: "validation_failed", message: 'Missing required column "name".' } }, { status: 400 }));
    expect(await code()).toBe("bad_request");
  });
});
