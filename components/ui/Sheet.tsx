"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/**
 * Modal built on the native <dialog>: bottom sheet on phones, centred dialog from 768px.
 * The browser provides focus trapping and Escape; `onClose` fires for both.
 */
export function Sheet({ open, title, closeLabel, onClose, children }: { open: boolean; title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label={closeLabel} onClick={onClose}>×</button>
      </div>
      {open && children}
    </dialog>
  );
}

/** Ask before something that cannot be undone. Cancel is first, so it is the default focus. */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  text?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} title={title} closeLabel={cancelLabel} onClose={onCancel}>
      {text && <p>{text}</p>}
      <div className="actions">
        <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Sheet>
  );
}
