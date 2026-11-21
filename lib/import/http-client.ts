import { ImportFailure, type ImportClient, type ImportResult } from "./types";

/**
 * Client for POST /members/import (docs/api/openapi.yaml), through the same-origin bridge
 * (app/ui/members-import/route.ts). The bridge resolves the signed-in viewer on the server, in
 * every mode, so no token ever reaches the browser.
 */
export function createHttpImportClient(baseUrl = "/ui", path = "/members-import"): ImportClient {
  return {
    async importCsv(file, { dryRun }) {
      const body = new FormData();
      body.append("file", file);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}?dryRun=${dryRun}`, { method: "POST", body });
      } catch {
        throw new ImportFailure("network", "Network error.");
      }
      if (res.status === 413) throw new ImportFailure("file_too_large", "File too large.");
      if (res.status === 401 || res.status === 403) throw new ImportFailure("forbidden", "Only the owner can import members.");
      if (!res.ok) {
        let message = "The file could not be read.";
        try {
          const j = (await res.json()) as { error?: { message?: string } };
          if (j.error?.message) message = j.error.message;
        } catch {
          /* keep the generic message */
        }
        throw new ImportFailure(/excel|pdf/i.test(message) ? "not_csv" : "bad_request", message);
      }
      const r = (await res.json()) as ImportResult;
      return { ...r, skippedRows: r.skippedRows ?? 0, warnings: r.warnings ?? [] };
    },
  };
}
