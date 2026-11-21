import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

function cls(variant: ButtonVariant, size: ButtonSize, extra?: string) {
  return `btn btn-${variant}${size === "lg" ? " btn-lg" : ""}${extra ? ` ${extra}` : ""}`;
}

/** Primary, secondary, ghost or danger. 44px tall (md) or 48px (lg). `loading` disables it and shows a spinner. */
export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean; children: ReactNode }) {
  return (
    <button type="button" {...rest} className={cls(variant, size, className)} disabled={rest.disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A link that looks like a Button. */
export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...rest} className={cls(variant, size, className)} />;
}

/** Icon-only button; the accessible name is required. */
export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" {...rest} aria-label={label} className={`icon-btn${className ? ` ${className}` : ""}`}>
      {children}
    </button>
  );
}
