"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/lib/i18n/client";
import { selectChildAction } from "@/app/[role]/_actions/workouts";
import s from "./Customer.module.css";

/** Parents with several children pick whose day they see. Hidden when there is only one member. */
export function ChildSwitcher({ members, selectedId }: { members: { id: string; name: string }[]; selectedId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (members.length < 2) return null;
  return (
    <div className={s.switcher} role="group" aria-label={t("cu.child.group")} aria-busy={pending || undefined}>
      {members.map((m) => (
        <button
          key={m.id}
          type="button"
          className={s.chip}
          aria-pressed={m.id === selectedId}
          disabled={pending}
          onClick={() => {
            if (m.id === selectedId) return;
            start(async () => {
              const res = await selectChildAction(m.id);
              if (res.ok) router.refresh();
            });
          }}
        >
          {m.name}
        </button>
      ))}
    </div>
  );
}
