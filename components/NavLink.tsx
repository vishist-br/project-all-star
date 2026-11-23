"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** `exact`: highlight only on this very page (another nav item lives below it). `secondary`: side rail and More only. */
export function NavLink({
  href, icon, children, exact, secondary, moreLink,
}: { href: string; icon: string; children: ReactNode; exact?: boolean; secondary?: boolean; moreLink?: boolean }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className="nav-link" data-secondary={secondary ? "" : undefined} data-more={moreLink ? "" : undefined} aria-current={active ? "page" : undefined}>
      <span aria-hidden="true" className="nav-icon">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}
