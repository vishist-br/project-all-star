import type { Page } from "@playwright/test";

/**
 * Page fact collection for the UX audit (STAR-76). `collectFacts` reads everything the checks need
 * from the rendered page, so the spec can crawl once and assert per category afterwards.
 */

export type Viewport = 360 | 768 | 1280;

export type Facts = {
  tenant: string;
  role: string;
  path: string;
  locale: string;
  viewport: Viewport;
  status: number;
  title: string;
  htmlLang: string;
  texts: string; // visible text of the page, demo switcher excluded
  attrTexts: string; // alt, aria-label, title, placeholder attributes, meta descriptions
  h1Count: number;
  headings: { level: number; text: string }[];
  emptyHeadings: number;
  overflowPx: number;
  offenders: string[];
  clipped: string[];
  smallTargets: string[];
  brokenImages: string[];
  stateTitles: string[];
  alerts: string[];
  mainItems: number; // li + table rows + cards + articles inside <main>
  charts: number;
  mainLinks: string[];
  reviewBannerVisible: boolean;
  landmarks: { main: number; nav: number; header: number; footer: number };
  consoleErrors: string[];
  failedRequests: string[];
  axe?: { id: string; impact: string; help: string; nodes: string[] }[];
  focusIssues?: string[];
};

export type FactsBase = Pick<Facts, "tenant" | "role" | "path" | "locale" | "viewport" | "status" | "consoleErrors" | "failedRequests">;

let axePath: string | undefined;
function axeSource(): string {
  axePath ??= require.resolve("axe-core/axe.min.js");
  return axePath;
}

export async function runAxe(page: Page) {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ path: axeSource() });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe;
    const res = await axe.run(document, {
      exclude: [[".demo-switcher"], ["nextjs-portal"]],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return res.violations.map((v: { id: string; impact: string; help: string; nodes: { target: unknown[] }[] }) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => String(n.target.join(" "))),
    }));
  });
}

/** Tab through the first controls and report any that show no visible focus indicator. */
export async function focusIssues(page: Page, steps = 7): Promise<string[]> {
  const issues: string[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.tagName.toLowerCase() === "nextjs-portal") return null; // dev overlay
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow !== "none" && cs.boxShadow !== "";
      const sib = el.nextElementSibling ? getComputedStyle(el.nextElementSibling) : null;
      const sibRing = !!sib && ((sib.outlineStyle !== "none" && parseFloat(sib.outlineWidth) > 0) || sib.boxShadow !== "none");
      const demo = !!el.closest(".demo-switcher");
      const label = `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}"`;
      return { ok: outline || shadow || sibRing, demo, label };
    });
    if (r && !r.demo && !r.ok) issues.push(r.label);
  }
  return issues;
}

export async function collectFacts(page: Page, base: FactsBase): Promise<Facts> {
  const dom = await page.evaluate(() => {
    const skip = (el: Element | null) => !!el?.closest(".demo-switcher, script, style, noscript, nextjs-portal");
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const desc = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.textContent || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28)}"`;

    const out: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const p = n.parentElement;
      const t = (n.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || !p || skip(p) || !visible(p)) continue;
      out.push(t);
    }
    const attrs: string[] = [];
    document.querySelectorAll("[alt],[aria-label],[title],[placeholder]").forEach((el) => {
      if (skip(el)) return;
      for (const a of ["alt", "aria-label", "title", "placeholder"]) {
        const v = el.getAttribute(a);
        if (v) attrs.push(v);
      }
    });
    document.querySelectorAll('meta[name="description"],meta[property^="og:"]').forEach((m) => attrs.push(m.getAttribute("content") || ""));

    const allH = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => !skip(h) && visible(h));
    const headings = allH.map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent || "").trim() }));

    const vw = window.innerWidth;
    const scrollable = (el: Element | null) => {
      for (let e = el?.parentElement; e && e !== document.body; e = e.parentElement) {
        const o = getComputedStyle(e).overflowX;
        if (o === "auto" || o === "scroll") return true;
        if ((o === "hidden" || o === "clip") && e.scrollWidth > e.clientWidth) return true;
      }
      return false;
    };
    const offenders: string[] = [];
    const clipped: string[] = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (skip(el) || !visible(el)) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if ((r.right > vw + 1 || r.left < -1) && !scrollable(el) && cs.position !== "fixed") offenders.push(desc(el));
      if (!el.closest(".sr-only, thead") && (cs.overflowX === "hidden" || cs.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1 && (el.textContent || "").trim()) {
        clipped.push(`${desc(el)}${cs.textOverflow === "ellipsis" ? " (ellipsis)" : ""}`);
      }
    });

    const small: string[] = [];
    const sel =
      'button, .btn, .icon-btn, select, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), summary, [role="tab"], [role="button"], nav a, .tab, .seg, .chip, header a, footer a';
    document.querySelectorAll(sel).forEach((el) => {
      if (skip(el) || !visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.height < 43.5 || r.width < 43.5) small.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    document.querySelectorAll('input[type="checkbox"], input[type="radio"]').forEach((el) => {
      if (skip(el)) return;
      const lab = el.closest("label") as HTMLElement | null;
      const r = (lab ?? (el as HTMLElement)).getBoundingClientRect();
      if (r.width > 0 && r.height < 43.5) small.push(`${desc(el)} (checkbox/radio) ${Math.round(r.width)}x${Math.round(r.height)}`);
    });

    const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && visible(i)).map((i) => i.getAttribute("src") || "");
    const main = document.querySelector("main");
    const q = (s: string) => document.querySelectorAll(s).length;
    return {
      title: document.title,
      htmlLang: document.documentElement.lang,
      texts: out.join("\n"),
      attrTexts: attrs.join("\n"),
      h1Count: headings.filter((h) => h.level === 1).length,
      headings,
      emptyHeadings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(
        (h) => !skip(h) && visible(h) && !(h.textContent || "").trim() && !h.querySelector("img[alt]:not([alt=''])") && !h.getAttribute("aria-label"),
      ).length,
      overflowPx: document.documentElement.scrollWidth - vw,
      offenders: offenders.slice(0, 6),
      clipped: clipped.slice(0, 6),
      smallTargets: small.slice(0, 12),
      brokenImages: broken,
      stateTitles: [...document.querySelectorAll(".state-title")].filter((e) => !skip(e)).map((e) => (e.textContent || "").trim()),
      alerts: [...document.querySelectorAll('[role="alert"]')].filter((e) => !skip(e)).map((e) => (e.textContent || "").trim().slice(0, 160)),
      mainItems: main ? main.querySelectorAll("li, tbody tr, .card, article").length : 0,
      charts: q('svg[role="img"]'),
      mainLinks: main ? [...main.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") || "") : [],
      reviewBannerVisible: !!document.querySelector(".review-banner") && visible(document.querySelector(".review-banner")!),
      landmarks: { main: q("main, [role=main]"), nav: q("nav, [role=navigation]"), header: q("header, [role=banner]"), footer: q("footer, [role=contentinfo]") },
    };
  });
  return { ...base, ...dom };
}
