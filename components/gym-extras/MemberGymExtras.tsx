import s from "@/components/body-measurements/body.module.css";
import { MuscleBars } from "@/components/muscle-volume/MuscleBars";
import { Card } from "@/components/ui/Card";
import { listBodyMeasurements } from "@/lib/api/body-measurements";
import { getMuscleVolume } from "@/lib/api/muscle-volume";
import type { Principal } from "@/lib/auth/principal";
import { shortDay } from "@/lib/exercise/metrics";
import { BODY_METRICS, UNIT_KEY, numText, type MeasurementLike } from "@/lib/gym-extras/view";
import { getT } from "@/lib/i18n/server";
import type { TenantClient } from "@/lib/tenant-scope";

/**
 * Coach and owner view of one member: the latest body measurements (read only, personal data shared with
 * the member's coach and owner) and, for gym members, sets per muscle over the last four weeks.
 * A failure of either part leaves the rest of the page as it is.
 */
export async function MemberGymExtras({ db, principal, memberId }: { db: TenantClient; principal: Principal; memberId: string }) {
  const { t, locale } = await getT();
  const [body, muscles] = await Promise.all([
    listBodyMeasurements(db, principal, memberId, new URLSearchParams()).catch((err) => {
      console.error("member body measurements failed", err instanceof Error ? err.message : err);
      return null;
    }),
    getMuscleVolume(db, principal, memberId, new URLSearchParams({ range: "28d" })).catch((err) => {
      console.error("member muscle volume failed", err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  const latest = body?.latest as unknown as MeasurementLike | null | undefined;

  return (
    <>
      {body && (
        <Card title={t("gx.bm.coach.title")}>
          <div data-testid="member-body">
            {latest ? (
              <>
                <div className={s.tiles}>
                  {BODY_METRICS.filter((m) => latest[m.key] !== null).map((m) => (
                    <div key={m.key} className={s.tile}>
                      <span className={s.tileLabel}>{t(m.label)}</span>
                      <span className={s.tileValue}>{t(UNIT_KEY[m.unit], { n: numText(latest[m.key] as number) })}</span>
                    </div>
                  ))}
                </div>
                <p className={s.meta}>
                  {t("gx.bm.latestOn", { date: shortDay(latest.measuredOn, locale) })} · {t("gx.bm.coach.entries", { n: body.items.length })}
                </p>
              </>
            ) : (
              <p className="muted">{t("gx.bm.coach.empty")}</p>
            )}
            <p className={s.meta}>{t("gx.bm.coach.note")}</p>
          </div>
        </Card>
      )}
      {muscles?.hasGymData && muscles.muscles.length > 0 && (
        <Card title={t("gx.mv.card28")}>
          <MuscleBars rows={muscles.muscles.slice(0, 8)} t={t} detail weeks={muscles.weeks} />
        </Card>
      )}
    </>
  );
}
