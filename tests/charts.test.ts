import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BarChart, Donut, LineChart, ProgressRing, Sparkline, StackedBar, WeekdayHeatmap } from "../components/charts";
import { niceMax, ticks } from "../components/charts/scale";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("chart scale helpers", () => {
  it("rounds axis ends up to tidy values and uses at most 5 gridlines", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(130)).toBe(200);
    expect(ticks(10)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(ticks(1).length).toBeLessThanOrEqual(5);
  });
});

describe("chart kit (server-rendered SVG)", () => {
  const labels = ["Mon", "Tue", "Wed"];

  it("LineChart: role=img, aria-label, one path per run, nulls make gaps, hidden table has the numbers", () => {
    const html = render(
      h(LineChart, {
        ariaLabel: "Attendance trend",
        labels,
        series: [
          { name: "Present", values: [1, 2, 3] },
          { name: "Marked", values: [2, null, 4] },
        ],
      }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Attendance trend"');
    expect(count(html, /class="chart-line"/g)).toBe(3); // 1 run + 2 runs split by the null
    expect(count(html, /<circle/g)).toBe(5); // the null draws no point
    expect(html).toContain("sr-only");
    expect(count(html, /<tr>/g)).toBe(1 + labels.length);
    expect(html).toContain("<td>–</td>"); // null shown as a dash, never 0
    expect(html).toContain("chart-legend"); // more than one series
  });

  it("LineChart: single series has no legend, area adds a fill path, percent axis ends at 100", () => {
    const html = render(h(LineChart, { ariaLabel: "x", labels, series: [{ name: "A", values: [10, 50, 90] }], area: true, percent: true }));
    expect(html).not.toContain("chart-legend");
    expect(count(html, /class="chart-area"/g)).toBe(1);
    expect(html).toContain("100%");
  });

  it("BarChart: one rect per non-null value; StackedBar stacks to the sum", () => {
    const series = [
      { name: "Present", values: [3, 4, null] },
      { name: "Excused", values: [1, 1, 2] },
    ];
    const grouped = render(h(BarChart, { ariaLabel: "b", labels, series }));
    expect(count(grouped, /class="chart-bar"/g)).toBe(5);
    const stacked = render(h(StackedBar, { ariaLabel: "s", labels, series }));
    expect(count(stacked, /class="chart-bar"/g)).toBe(5);
    expect(stacked).toContain(">5<"); // axis end covers the tallest stack (4 + 1) rounded up
    expect(count(grouped, /<tr>/g)).toBe(1 + labels.length);
  });

  it("Donut: one arc per non-zero slice (max 5), centre label, hidden table", () => {
    const html = render(
      h(Donut, {
        ariaLabel: "Fees",
        valueLabel: "Count",
        centerLabel: "12",
        slices: [
          { label: "Paid", value: 8 },
          { label: "Due", value: 3 },
          { label: "Overdue", value: 1 },
          { label: "None", value: 0 },
        ],
      }),
    );
    expect(count(html, /class="chart-arc"/g)).toBe(3);
    expect(html).toContain(">12<");
    expect(count(html, /<tr>/g)).toBe(1 + 4);
    expect(html).toContain("<th scope=\"col\">Count</th>");
  });

  it("ProgressRing: arc length follows the value, null shows a dash and no arc", () => {
    const some = render(h(ProgressRing, { ariaLabel: "r", label: "Attendance", valueLabel: "Value", maxLabel: "Of", value: 50 }));
    expect(count(some, /class="chart-arc"/g)).toBe(1);
    expect(some).toContain(">50<");
    const none = render(h(ProgressRing, { ariaLabel: "r", label: "Attendance", valueLabel: "Value", maxLabel: "Of", value: null }));
    expect(count(none, /class="chart-arc"/g)).toBe(0);
    expect(none).toContain(">–<");
  });

  it("Sparkline: labelled, null-safe", () => {
    const html = render(h(Sparkline, { ariaLabel: "Trend", values: [1, null, 3, 4] }));
    expect(html).toContain('aria-label="Trend"');
    expect(count(html, /<path/g)).toBe(2);
  });

  it("WeekdayHeatmap: one cell per label, empty cells for null, hidden table", () => {
    const html = render(h(WeekdayHeatmap, { ariaLabel: "Weekdays", valueLabel: "Sessions", labels: ["M", "T", "W"], values: [4, null, 2] }));
    expect(count(html, /class="chart-cell"/g)).toBe(2);
    expect(count(html, /class="chart-cell-empty"/g)).toBe(1);
    expect(count(html, /<tr>/g)).toBe(1 + 3);
  });
});
