"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveProgressNoteAction } from "@/app/[role]/_actions/progress-card";
import { Button, Card, useToast } from "@/components/ui";
import { useI18n } from "@/lib/i18n/client";
import { NOTE_MAX_LENGTH } from "@/lib/progress-card/rules";
import s from "./progress-card.module.css";

/** Coach (own members) or owner: the short positive note on this week's family card. Empty text removes it. */
export function CoachNoteCard({ memberId, week, initial }: { memberId: string; week: string; initial: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  const tooLong = text.trim().length > NOTE_MAX_LENGTH;

  function save() {
    if (tooLong) return;
    start(async () => {
      const res = await saveProgressNoteAction(memberId, week, text);
      toast(res.ok ? (res.data.note ? t("pc.coach.saved") : t("pc.coach.cleared")) : t("pc.coach.err"), res.ok ? "ok" : "warn");
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card title={t("pc.coach.title")}>
      <div className={s.share}>
        <p className="muted">{t("pc.coach.hint")}</p>
        <label className="field-label" htmlFor={`note-${memberId}`}>{t("pc.coach.label")}</label>
        <textarea
          id={`note-${memberId}`}
          className={`input ${s.textarea}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-invalid={tooLong || undefined}
          data-testid="coach-note"
        />
        <p className={s.count} role={tooLong ? "alert" : undefined}>{tooLong ? t("pc.coach.tooLong") : t("pc.coach.count", { n: text.trim().length })}</p>
        <div>
          <Button loading={pending} disabled={tooLong} onClick={save} data-testid="save-note">{t("pc.coach.save")}</Button>
        </div>
      </div>
    </Card>
  );
}
