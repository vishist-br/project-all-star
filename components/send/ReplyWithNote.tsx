"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { replyWithNoteAction } from "@/app/[role]/_actions/send-classes";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/Form";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/lib/i18n/client";
import { firstName, NOTE_MAX } from "@/lib/send/view";
import s from "./send.module.css";

/** "Reply with a note": a short note that the member sees with their plan and in their updates. */
export function ReplyWithNote({ assignmentId, memberName }: { assignmentId: string; memberName: string }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = firstName(memberName);

  async function send() {
    setProblem(null);
    if (!text.trim()) {
      setProblem(t("rs.reply.empty"));
      return;
    }
    setBusy(true);
    try {
      const res = await replyWithNoteAction(assignmentId, text);
      if (res.ok) {
        toast(t("rs.reply.sent", { name }));
        setOpen(false);
        setText("");
        router.refresh();
      } else setProblem(res.code === "conflict" ? t("rs.reply.ended") : t("rs.reply.err"));
    } catch {
      setProblem(t("rs.reply.err"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>{t("rs.reply")}</Button>
      <Sheet open={open} title={t("rs.reply.title", { name })} closeLabel={t("cls.finish.close")} onClose={() => setOpen(false)}>
        <div className={s.sheetBody}>
          <FormField label={t("rs.reply.label")} hint={t("rs.reply.hint", { name, left: Math.max(0, NOTE_MAX - text.length) })}>
            {(p) => <textarea {...p} className={`input ${s.textarea}`} maxLength={NOTE_MAX} value={text} onChange={(e) => setText(e.target.value)} />}
          </FormField>
          {problem && <p className={s.errorBox} role="alert">{problem}</p>}
          <div className="actions">
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("rs.reply.cancel")}</Button>
            <Button onClick={() => void send()} loading={busy}>{t("rs.reply.send")}</Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
