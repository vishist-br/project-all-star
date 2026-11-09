"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, icon, children }: { href: string; icon: string; children: ReactNode }) {
  const active = usePathname() === href;
  return (
    <Link href={href} className="nav-link" aria-current={active ? "page" : undefined}>
      <span aria-hidden="true" className="nav-icon">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}
