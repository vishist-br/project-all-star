"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { bookSessionAction, cancelBookingAction, type BookingResult } from "@/app/[role]/_actions/bookings";
import { Badge, Button, ConfirmDialog, useToast } from "@/components/ui";
import { formatTime, formatWhen } from "@/lib/customer/format";
import type { MyBooking } from "@/lib/customer/bookings";
import { spotsLeft, type SessionAction, type SessionLike } from "@/lib/customer/schedule";
import { useI18n } from "@/lib/i18n/client";
import s from "./Schedule.module.css";

export type SessionView = SessionLike & { batchName: string; coachName: string; endsAt: string };

/** One session with its capacity, my booking status and the Book / Join waiting list / Cancel controls. */
export function SessionCard({
  memberId,
  session,
  action,
  booking,
  canCancel,
  past,
}: {
  memberId: string;
  session: SessionView;
  action: SessionAction;
  booking: MyBooking | null;
  /** False once the cancellation window has closed (decided on the server from cancellableUntil). */
  canCancel: boolean;
  past: boolean;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const when = (iso: string) => formatWhen(iso, locale);
  const left = spotsLeft(session);
  const live = session.status === "scheduled" && !past;

  function describe(res: Extract<BookingResult, { ok: false }>): string {
    switch (res.reason) {
      case "closedWindow":
        return t("cs.err.closedWindow", { when: res.until ? when(res.until) : "" });
      case "full":
        return t("cs.err.full");
      case "started":
        return t("cs.err.started");
      case "already":
        return t("cs.err.already");
      case "notEnrolled":
        return t("cs.err.notEnrolled");
      case "notOpen":
        return t("cs.err.notOpen");
      default:
        return t("cs.err.other");
    }
  }

  function run(job: () => Promise<BookingResult>) {
    setNote(null);
    start(async () => {
      const res = await job();
      if (res.ok) {
        const text =
          res.status === "booked"
            ? t("cs.toast.booked")
            : res.status === "waitlisted"
              ? t("cs.toast.waitlisted", { n: res.waitlistPosition ?? 1 })
              : t("cs.toast.cancelled");
        setNote({ tone: "ok", text });
        toast(text, "ok");
      } else {
        setNote({ tone: "warn", text: describe(res) });
      }
      router.refresh();
    });
  }

  return (
    <li
      className={s.session}
      data-testid="session"
      data-session-id={session.id}
      data-booking={booking?.status ?? "none"}
      data-status={session.status}
      data-past={past || undefined}
    >
      <div className={s.sessionHead}>
        <div>
          <p className={s.sessionName}>{session.batchName}</p>
          <p className={s.meta}>
            {when(session.startsAt)} – {formatTime(session.endsAt, locale)}
          </p>
          <p className={s.meta}>{t("cs.session.with", { coach: session.coachName })}</p>
        </div>
        <div className={s.badges}>
          {session.kind === "one_on_one" && <Badge tone="info">{t("cs.session.oneOnOne")}</Badge>}
          {session.status === "completed" && <Badge tone="ok">{t("cs.session.completed")}</Badge>}
          {booking?.status === "booked" && <Badge tone="ok">{t("cs.status.booked")}</Badge>}
          {booking?.status === "waitlisted" && (
            <Badge tone="warn">
              {booking.waitlistPosition ? t("cs.status.waitlisted", { n: booking.waitlistPosition }) : t("cs.status.waitlistedNoPos")}
            </Badge>
          )}
        </div>
      </div>

      {session.status === "cancelled" && <p className={s.notice}>{t("cs.session.cancelledNote")}</p>}

      {live && session.kind === "group_class" && session.capacity !== null && (
        <p className={s.meta}>
          {left === 0 ? t("cs.session.full") : t("cs.session.spots", { n: left ?? 0 })}
          {session.waitlistCount > 0 && ` · ${t("cs.session.waiting", { n: session.waitlistCount })}`}
        </p>
      )}

      {live && booking && (
        <p className={s.meta} data-testid="cancel-info">
          {canCancel ? t("cs.cancel.until", { when: when(booking.cancellableUntil) }) : t("cs.cancel.closed", { when: when(booking.cancellableUntil) })}
        </p>
      )}

      {live && (
        <div className={s.actions}>
          {action === "book" && (
            <Button loading={pending} onClick={() => run(() => bookSessionAction(session.id, memberId))}>
              {t("cs.action.book")}
            </Button>
          )}
          {action === "waitlist" && (
            <Button variant="secondary" loading={pending} onClick={() => run(() => bookSessionAction(session.id, memberId))}>
              {t("cs.action.waitlist")}
            </Button>
          )}
          {action === "full" && <p className={s.meta}>{t("cs.action.fullNoList")}</p>}
          {action === "manage" && booking && (
            <Button variant="secondary" loading={pending} disabled={!canCancel} onClick={() => setConfirm(true)}>
              {booking.status === "waitlisted" ? t("cs.action.cancelWaitlist") : t("cs.action.cancel")}
            </Button>
          )}
        </div>
      )}

      <p role="status" className={note ? (note.tone === "ok" ? s.noteOk : s.noteWarn) : s.srOnly} data-testid="booking-note">
        {pending ? t("cs.working") : (note?.text ?? "")}
      </p>

      {booking && (
        <ConfirmDialog
          open={confirm}
          title={t("cs.cancel.confirmTitle")}
          text={t("cs.cancel.confirmBody", { name: session.batchName, when: when(session.startsAt) })}
          confirmLabel={t("cs.cancel.confirm")}
          cancelLabel={t("cs.cancel.keep")}
          danger
          onCancel={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            run(() => cancelBookingAction(booking.bookingId));
          }}
        />
      )}
    </li>
  );
}
