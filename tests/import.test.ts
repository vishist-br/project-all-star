import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../lib/import/csv";
import { mockImportClient, validateCsv } from "../lib/import/mock-client";
import { CSV_COLUMNS, ImportFailure, MAX_FILE_BYTES } from "../lib/import/types";

const HEADER = CSV_COLUMNS.join(",");

describe("parseCsv", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

describe("validateCsv", () => {
  it("accepts the downloadable sample template with no errors", () => {
    const text = readFileSync("public/sample-members.csv", "utf8");
    const r = validateCsv(text, true);
    expect(r.errors).toEqual([]);
    expect(r.totalRows).toBe(3);
    expect(r.validRows).toBe(3);
    expect(r.importedRows).toBeUndefined();
    expect(text.split("\n")[0]).toBe(HEADER);
  });

  it("reports errors by 1-based data row and column", () => {
    const text = `${HEADER}\n,,,,,,,,,2026-13-40,paid\nOk Name,+919000000009,,,,,,,,2026-01-01,maybe`;
    const r = validateCsv(text, true);
    expect(r.errors).toEqual([
      { row: 1, column: "name", message: expect.any(String) },
      { row: 1, column: "join_date", message: expect.any(String) },
      { row: 2, column: "fee_status", message: expect.any(String) },
    ]);
    expect(r.validRows).toBe(0);
  });

  it("caps the preview at 20 rows", () => {
    const rows = Array.from({ length: 25 }, (_, i) => `Member ${i}`).join("\n");
    expect(validateCsv(`name\n${rows}`, true).preview).toHaveLength(20);
  });

  it("commits all or nothing", () => {
    const good = validateCsv("name\nA\nB", false);
    expect(good.importedRows).toBe(2);
    const bad = validateCsv("name,fee_status\nA,paid\nB,zzz", false);
    expect(bad.importedRows).toBeUndefined();
    expect(bad.errors).toHaveLength(1);
  });

  it("fails the whole file when empty or the name column is missing", () => {
    expect(() => validateCsv("", true)).toThrow(ImportFailure);
    expect(() => validateCsv("phone\n+919000000001", true)).toThrow(ImportFailure);
  });

  it("mock client rejects files over the size limit", async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.csv");
    await expect(mockImportClient.importCsv(big, { dryRun: true })).rejects.toMatchObject({ code: "file_too_large" });
  });
});
