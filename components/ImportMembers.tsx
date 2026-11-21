"use client";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, StatGrid, StatTile } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { SectionHeader } from "@/components/ui/PageHeader";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import { CSV_COLUMNS, ImportFailure, importClient, type ImportResult, type ImportRowError, type ImportWarning } from "@/lib/import";
import { STEPS, canConfirm, checkFile, newMembers, previewColumns, stepIndex, warningKind, type Phase } from "@/lib/import/view";
import s from "./ImportMembers.module.css";

type FailureKey = "tooLarge" | "notCsv" | "badFile" | "network" | "forbidden";
type Failure = { key: FailureKey; detail?: string; retry?: { file: File; dryRun: boolean } };

const MAX_ERRORS_SHOWN = 100;
const MAX_WARNINGS_SHOWN = 50;
const PREVIEW_COLLAPSED = 5;

/**
 * Owner CSV import, in four steps: choose file, check (dry run), review, import. Talks to the real
 * endpoint through the same-origin bridge in every mode (demo included), so what you see is what
 * is saved. Nothing is saved until the owner confirms.
 */
export function ImportMembers({ demo = false }: { demo?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Move focus to the new step's heading so keyboard and screen-reader users land on the result.
  useEffect(() => {
    if (phase === "review" || phase === "done") headingRef.current?.focus();
  }, [phase]);

  const plural = (n: number, one: MessageKey, other: MessageKey) => t(n === 1 ? one : other, { count: n });

  function fail(e: unknown, retry: Failure["retry"]) {
    const code = e instanceof ImportFailure ? e.code : "network";
    const key: FailureKey =
      code === "file_too_large" ? "tooLarge" : code === "not_csv" ? "notCsv" : code === "network" ? "network" : code === "forbidden" ? "forbidden" : "badFile";
    setFailure({ key, detail: code === "bad_request" && e instanceof Error ? e.message : undefined, retry: key === "network" ? retry : undefined });
  }

  async function check(f: File) {
    setFailure(null);
    const problem = checkFile(f);
    if (problem) {
      setFailure({ key: problem });
      return;
    }
    setFile(f);
    setResult(null);
    setShowAll(false);
    setPhase("checking");
    try {
      setResult(await importClient.importCsv(f, { dryRun: true }));
      setPhase("review");
    } catch (e) {
      fail(e, { file: f, dryRun: true });
      setPhase("idle");
    }
  }

  async function doImport() {
    if (!file) return;
    setConfirmOpen(false);
    setFailure(null);
    setPhase("importing");
    try {
      const r = await importClient.importCsv(file, { dryRun: false });
      setResult(r);
      if (r.errors.length === 0) {
        setPhase("done");
        router.refresh();
      } else setPhase("review");
    } catch (e) {
      fail(e, { file, dryRun: false });
      setPhase("review");
    }
  }

  function reset() {
    if (input.current) input.current.value = "";
    setFile(null);
    setResult(null);
    setFailure(null);
    setPhase("idle");
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (phase === "idle" || phase === "review")) void check(f);
  }

  const busy = phase === "checking" || phase === "importing";
  const current = stepIndex(phase);
  const fresh = result ? newMembers(result) : 0;
  const warnings = result?.warnings ?? [];
  const skipped = result?.skippedRows ?? 0;

  return (
    <div className={s.root}>
      <ol className={s.steps} aria-label={t("imp.steps")}>
        {STEPS.map((key, i) => {
          const state = phase === "done" || i < current ? s.done : i === current ? s.current : "";
          return (
            <li key={key} className={`${s.step} ${state}`} aria-current={i === current && phase !== "done" ? "step" : undefined}>
              <span className={s.dot} aria-hidden="true">{phase === "done" || i < current ? "✓" : i + 1}</span>
              <span className={s.label}>{t(`imp.step.${key}` as MessageKey)}</span>
            </li>
          );
        })}
      </ol>

      {demo && (
        <p className={`${s.note} ${s.noteInfo}`} data-testid="demo-note">{t("imp.demo")}</p>
      )}

      <div aria-live="polite" className={s.root}>
        {busy && (
          <div className={s.busy} role="status">
            <span className="spinner" aria-hidden="true" />
            <span>{phase === "checking" ? t("imp.checking", { file: file?.name ?? "" }) : t("imp.importing")}</span>
          </div>
        )}
      </div>

      {failure && (
        <div className={`${s.note} ${s.noteDanger}`} role="alert" data-testid="import-failure">
          <span className={s.noteTitle}>{t("imp.err.title")}</span>
          {t(`imp.err.${failure.key}` as MessageKey)}
          {failure.detail && <span className="muted"> {t("imp.err.detail", { message: failure.detail })}</span>}
          {failure.retry && (
            <div className="actions">
              <Button
                variant="secondary"
                onClick={() => (failure.retry!.dryRun ? void check(failure.retry!.file) : void doImport())}
              >
                {t("imp.retry")}
              </Button>
            </div>
          )}
        </div>
      )}

      {(phase === "idle" || phase === "checking" || phase === "review") && (
        <label
          className={`${s.drop} ${dragging ? s.dropActive : ""} ${busy ? s.dropDisabled : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="dropzone"
        >
          <span className={s.dropIcon} aria-hidden="true">⇪</span>
          <span className={s.dropTitle}>{dragging ? t("imp.drop.active") : phase === "review" ? t("imp.another") : t("imp.drop.title")}</span>
          <span className="muted small">{t("imp.drop.or")}</span>
          <span className="btn btn-secondary">{t("imp.drop.button")}</span>
          <input
            ref={input}
            className={s.hidden}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            data-testid="file-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void check(f);
              e.target.value = "";
            }}
          />
          <span className={s.dropHint}>{t("imp.drop.hint")}</span>
        </label>
      )}

      {phase === "idle" && (
        <>
          <Card title={t("imp.template.title")}>
            <p>{t("imp.template.text")}</p>
            <p>
              <a className="btn btn-secondary" href="/sample-members.csv" download="sample-members.csv">{t("imp.template.button")}</a>
            </p>
            <h3 className="small" style={{ margin: "0 0 var(--s2)" }}>{t("imp.columns")}</h3>
            <ul className={s.chips}>
              {CSV_COLUMNS.map((c) => (
                <li key={c} className={`${s.chip} ${c === "name" ? s.chipReq : ""}`}>
                  {c}
                  {c === "name" && <span>{t("imp.required")}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {phase === "review" && result && file && (
        <div className={s.section} data-testid="review">
          <h2 ref={headingRef} tabIndex={-1} className={s.focusHead}>{t("imp.review")}</h2>
          <p className={s.fileName}>{t("imp.file", { file: file.name })}</p>

          <StatGrid>
            <StatTile label={t("imp.sum.total")} value={result.totalRows} />
            <StatTile label={t("imp.sum.new")} value={fresh} />
            <StatTile label={t("imp.sum.skipped")} value={skipped} />
            <StatTile label={t("imp.sum.errors")} value={new Set(result.errors.map((e) => e.row)).size} />
          </StatGrid>

          {canConfirm(result) && <p className={`${s.note} ${s.noteOk}`} role="status">{plural(fresh, "imp.ready.one", "imp.ready.other")}</p>}
          {result.errors.length === 0 && fresh === 0 && result.totalRows > 0 && <p className={`${s.note} ${s.noteInfo}`}>{t("imp.allSkipped")}</p>}

          {result.errors.length > 0 && <ErrorsTable errors={result.errors} />}
          {skipped > 0 && (
            <div className={`${s.note} ${s.noteInfo}`} data-testid="skipped-note">
              <span className={s.noteTitle}>{t("imp.skipped.title")}</span>
              {plural(skipped, "imp.skipped.one", "imp.skipped.other")}
            </div>
          )}
          {warnings.length > 0 && <WarningsList warnings={warnings} />}

          {result.preview && result.preview.length > 0 && (
            <Preview rows={result.preview} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
          )}

          <div className={s.actions}>
            {canConfirm(result) && (
              <Button size="lg" onClick={() => setConfirmOpen(true)} data-testid="confirm-import">
                {plural(fresh, "imp.confirm.one", "imp.confirm.other")}
              </Button>
            )}
            <Button variant="secondary" onClick={reset}>{t("imp.another")}</Button>
          </div>

          <ConfirmDialog
            open={confirmOpen}
            title={t("imp.confirm.title")}
            text={`${plural(fresh, "imp.ready.one", "imp.ready.other")} ${t("imp.confirm.text")}${demo ? ` ${t("imp.demo")}` : ""}`}
            confirmLabel={t("imp.confirm.yes")}
            cancelLabel={t("imp.confirm.no")}
            onConfirm={() => void doImport()}
            onCancel={() => setConfirmOpen(false)}
          />
        </div>
      )}

      {phase === "done" && result && (
        <div className={s.section} data-testid="done">
          <div className={s.doneBox}>
            <span className={s.doneIcon} aria-hidden="true">✓</span>
            <h2 ref={headingRef} tabIndex={-1} className={s.focusHead}>{t("imp.done.title")}</h2>
            <p role="status">
              {(result.importedRows ?? 0) > 0
                ? plural(result.importedRows ?? 0, "imp.done.added.one", "imp.done.added.other")
                : t("imp.done.none")}
            </p>
          </div>
          <StatGrid>
            <StatTile label={t("imp.done.imported")} value={result.importedRows ?? 0} />
            <StatTile label={t("imp.done.skipped")} value={skipped} />
            <StatTile label={t("imp.done.notes")} value={warnings.length} />
          </StatGrid>
          {warnings.length > 0 && <WarningsList warnings={warnings} />}
          <div className={s.actions}>
            <ButtonLink href="/owner/members" size="lg">{t("imp.done.view")}</ButtonLink>
            <Button variant="secondary" onClick={reset}>{t("imp.done.again")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ErrorsTable({ errors }: { errors: ImportRowError[] }) {
  const { t } = useI18n();
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  return (
    <div className={s.section} data-testid="errors">
      <SectionHeader title={t("imp.errors.title")} />
      <p className={`${s.note} ${s.noteWarn}`}>{t("imp.errors.text")}</p>
      <DataTable
        caption={t("imp.errors.title")}
        rows={shown}
        rowKey={(e) => `${e.row}-${e.column ?? ""}-${e.message}`}
        columns={[
          { key: "row", header: t("imp.col.row"), render: (e) => e.row },
          { key: "column", header: t("imp.col.column"), render: (e) => e.column ?? t("imp.col.none") },
          { key: "message", header: t("imp.col.message"), render: (e) => e.message },
        ]}
      />
      {errors.length > shown.length && <p className="muted small">{t("imp.errors.more", { count: errors.length - shown.length })}</p>}
    </div>
  );
}

function WarningsList({ warnings }: { warnings: ImportWarning[] }) {
  const { t } = useI18n();
  const shown = warnings.slice(0, MAX_WARNINGS_SHOWN);
  return (
    <div className={s.section} data-testid="warnings">
      <SectionHeader title={t("imp.warn.title")} />
      <p className="muted small">{t("imp.warn.text")}</p>
      <ul className={s.list}>
        {shown.map((w, i) => {
          const kind = warningKind(w);
          return (
            <li key={`${w.row}-${w.column ?? ""}-${i}`} className={s.listItem}>
              <span>
                <Badge tone="info">{w.row === 0 ? t("imp.warn.file") : `${t("imp.warn.row")} ${w.row}`}</Badge>
                {w.column && <> <code>{w.column}</code></>}
              </span>
              <span>{kind === "other" ? w.message : t(`imp.warn.${kind}` as MessageKey, { column: w.column ?? "" })}</span>
            </li>
          );
        })}
      </ul>
      {warnings.length > shown.length && <p className="muted small">{t("imp.errors.more", { count: warnings.length - shown.length })}</p>}
    </div>
  );
}

function Preview({ rows, showAll, onToggle }: { rows: Record<string, string>[]; showAll: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const cols = previewColumns(rows);
  const shown = showAll ? rows : rows.slice(0, PREVIEW_COLLAPSED);
  return (
    <div className={s.section} data-testid="preview">
      <SectionHeader title={t("imp.preview.title")} />
      <p className="muted small">{t("imp.preview.text")}</p>
      <div className={s.previewWrap} tabIndex={0} role="region" aria-label={t("imp.preview.title")}>
        <table className={s.preview}>
          <thead>
            <tr>
              <th scope="col">#</th>
              {cols.map((c) => <th key={c} scope="col">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                {cols.map((c) => <td key={c}>{r[c]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > PREVIEW_COLLAPSED && (
        <div>
          <Button variant="ghost" onClick={onToggle}>{showAll ? t("imp.preview.less") : t("imp.preview.all", { count: rows.length })}</Button>
        </div>
      )}
    </div>
  );
}
