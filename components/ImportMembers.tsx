"use client";
import { useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { CSV_COLUMNS, ImportFailure, getImportClient, type ImportResult } from "@/lib/import";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "checked"; file: File; result: ImportResult }
  | { kind: "done"; result: ImportResult }
  | { kind: "failed"; message: "import.err.tooLarge" | "import.err.badFile" | "import.err.network" };

export function ImportMembers() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const client = getImportClient();

  async function run(file: File, dryRun: boolean) {
    setState({ kind: "busy" });
    try {
      const result = await client.importCsv(file, { dryRun });
      if (dryRun) setState({ kind: "checked", file, result });
      else if (result.errors.length === 0) setState({ kind: "done", result });
      else setState({ kind: "checked", file, result });
    } catch (e) {
      const code = e instanceof ImportFailure ? e.code : "bad_request";
      setState({
        kind: "failed",
        message: code === "file_too_large" ? "import.err.tooLarge" : code === "network" ? "import.err.network" : "import.err.badFile",
      });
    }
  }

  function reset() {
    if (input.current) input.current.value = "";
    setState({ kind: "idle" });
  }

  const busy = state.kind === "busy";
  const checked = state.kind === "checked" ? state : null;

  return (
    <div className="import">
      <p>{t("import.intro")}</p>
      <p>
        <a className="btn btn-outline" href="/sample-members.csv" download="sample-members.csv">
          {t("import.template")}
        </a>
      </p>
      <p className="muted small">{t("import.columns", { columns: CSV_COLUMNS.join(", ") })}</p>

      <label className="file-pick">
        <span>{t("import.choose")}</span>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f, true);
          }}
        />
      </label>

      <div aria-live="polite">
        {busy && <p>{t("app.loading")}</p>}
        {state.kind === "failed" && <p role="alert" className="msg-error">{t(state.message)}</p>}

        {checked && (
          <>
            <h2>{t("import.summary")}</h2>
            <p>{t("import.counts", { total: checked.result.totalRows, valid: checked.result.validRows, errors: checked.result.errors.length })}</p>

            {checked.result.errors.length > 0 && (
              <>
                <h2>{t("import.errors")}</h2>
                <ul className="card-list">
                  {checked.result.errors.map((e, i) => (
                    <li key={i} className="card msg-error-card">
                      <strong>{t("import.row", { row: e.row })}</strong>
                      {e.column ? ` · ${e.column}` : ""}
                      <div>{e.message}</div>
                    </li>
                  ))}
                </ul>
                <p className="muted">{t("import.fixHint")}</p>
              </>
            )}

            {checked.result.preview && checked.result.preview.length > 0 && (
              <>
                <h2>{t("import.preview")}</h2>
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t("import.preview")}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {Object.keys(checked.result.preview[0]).map((c) => <th key={c}>{c}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {checked.result.preview.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          {Object.keys(checked.result.preview![0]).map((c) => <td key={c}>{r[c]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={checked.result.errors.length > 0 || checked.result.validRows === 0}
                onClick={() => void run(checked.file, false)}
              >
                {t("import.confirm", { count: checked.result.validRows })}
              </button>
              <button type="button" className="btn btn-outline" onClick={reset}>{t("import.another")}</button>
            </div>
          </>
        )}

        {state.kind === "done" && (
          <>
            <p role="status" className="msg-ok">{t("import.done", { count: state.result.importedRows ?? state.result.validRows })}</p>
            <button type="button" className="btn btn-outline" onClick={reset}>{t("import.another")}</button>
          </>
        )}
      </div>
    </div>
  );
}
