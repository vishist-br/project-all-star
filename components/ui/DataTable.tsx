import type { Key, ReactNode } from "react";

export type Column<T> = { key: string; header: string; render: (row: T) => ReactNode; align?: "end" };

/**
 * A real table on wide screens. Under 640px every row becomes a card and each cell shows its
 * column header (data-label), so nothing scrolls sideways on a phone. The first column is the row title.
 */
export function DataTable<T>({ columns, rows, rowKey, caption }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => Key; caption?: string }) {
  return (
    <div className="dt-wrap">
      <table className="dt">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.align === "end" ? "dt-end" : undefined}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c, i) => (
                <td key={c.key} data-label={c.header} className={`${i === 0 ? "dt-title" : ""}${c.align === "end" ? " dt-end" : ""}`.trim() || undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
