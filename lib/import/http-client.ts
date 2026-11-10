import { ImportFailure, type ImportClient, type ImportResult } from "./types";

/** Real client for POST /members/import (docs/api/openapi.yaml). Not used until the endpoint exists. */
export function createHttpImportClient(baseUrl = "/api/v1", getToken?: () => string | null, path = "/members/import"): ImportClient {
  return {
    async importCsv(file, { dryRun }) {
      const body = new FormData();
      body.append("file", file);
      const token = getToken?.();
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}?dryRun=${dryRun}`, {
          method: "POST",
          body,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch {
        throw new ImportFailure("network", "Network error.");
      }
      if (res.status === 413) throw new ImportFailure("file_too_large", "File too large.");
      if (!res.ok) throw new ImportFailure("bad_request", "The file could not be read.");
      return (await res.json()) as ImportResult;
    },
  };
}
