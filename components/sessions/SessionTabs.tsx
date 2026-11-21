import { Tabs } from "@/components/ui/Tabs";
import { getT } from "@/lib/i18n/server";

/** Today / Week / Availability. Folded under the Today nav item so the coach nav stays at five. */
export async function SessionTabs({ role, active }: { role: string; active: "today" | "week" | "availability" }) {
  const { t } = await getT();
  return (
    <Tabs
      label={t("today.tabs")}
      items={[
        { href: `/${role}/today`, label: t("today.tab.today"), active: active === "today" },
        { href: `/${role}/today/week`, label: t("today.tab.week"), active: active === "week" },
        { href: `/${role}/today/availability`, label: t("today.tab.availability"), active: active === "availability" },
      ]}
    />
  );
}
