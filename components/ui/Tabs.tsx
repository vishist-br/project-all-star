import Link from "next/link";

export type TabItem = { href: string; label: string; active: boolean };

/** URL-driven tabs: each tab is a link, the page reads the URL and marks one active. */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="tab" aria-current={i.active ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/** Period chips (for example 7 / 30 / 90 days). Also link-based, so it works without JavaScript. */
export function Segmented({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav className="segmented" aria-label={label}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="seg" aria-current={i.active ? "true" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
