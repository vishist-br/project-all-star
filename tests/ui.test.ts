import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Avatar, Badge, ProgressBar } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, StatTile } from "../components/ui/Card";
import { DataTable } from "../components/ui/DataTable";
import { FormField, TextInput } from "../components/ui/Form";
import { PageSkeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("design system components", () => {
  it("DataTable renders data-label on every cell so rows can collapse to cards", () => {
    const html = render(
      h(DataTable<{ id: string; name: string; n: number }>, {
        rows: [{ id: "a", name: "Asha", n: 3 }],
        rowKey: (r) => r.id,
        columns: [
          { key: "name", header: "Name", render: (r) => r.name },
          { key: "n", header: "Count", align: "end", render: (r) => r.n },
        ],
      }),
    );
    expect(html).toContain('data-label="Name"');
    expect(html).toContain('data-label="Count"');
    expect(html).toContain("<tbody>");
  });

  it("Button shows a spinner and disables itself while loading", () => {
    const html = render(h(Button, { loading: true, children: "Save" }));
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("spinner");
  });

  it("StatTile shows change with a text arrow, never colour alone, and an optional sparkline", () => {
    const html = render(h(StatTile, { label: "Attendance", value: "82%", change: 5, trend: [1, 2, 3] }));
    expect(html).toContain("▲");
    expect(html).toContain("+5");
    expect(html).toContain("sparkline");
  });

  it("Badge, ProgressBar and Avatar expose accessible output", () => {
    expect(render(h(Badge, { tone: "ok", children: "Paid" }))).toContain("badge-ok");
    const bar = render(h(ProgressBar, { value: 40, label: "Attendance" }));
    expect(bar).toContain('role="progressbar"');
    expect(bar).toContain('aria-valuenow="40"');
    expect(render(h(Avatar, { name: "Asha Rao" }))).toContain(">AR<");
  });

  it("FormField links the label to the control and the error to aria-describedby", () => {
    const html = render(h(FormField, { label: "Name", error: "Required", children: (p: object) => h(TextInput, p) }));
    const id = /for="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`aria-describedby="${id}-err"`);
    expect(html).toContain('aria-invalid="true"');
  });

  it("states: EmptyState has a heading, ErrorState is an alert with a retry button", () => {
    expect(render(h(EmptyState, { title: "Nothing here yet.", text: "Add one." }))).toContain("<h2");
    const err = render(h(ErrorState, { title: "Oops", retryLabel: "Try again", onRetry: () => {} }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("Try again");
  });

  it("PageSkeleton is one busy status region; Card renders its title", () => {
    expect(render(h(PageSkeleton, { label: "Loading..." }))).toContain('aria-busy="true"');
    expect(render(h(Card, { title: "Hello" }, "x"))).toContain("Hello");
  });

  it("globals.css defines the plan's tokens and the 640px table collapse", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const token of ["--primary-soft", "--ok", "--warn", "--danger", "--info", "--c1", "--c5", "--s6", "--r-lg", "--fs-kpi"])
      expect(css, token).toContain(`${token}:`);
    expect(css).toContain("max-width: 639px");
    expect(css).toContain("prefers-color-scheme: dark");
  });
});
