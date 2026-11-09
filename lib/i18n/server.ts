import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, translate, type Locale, type MessageKey, type Params } from "./index";

export async function getLocale(): Promise<Locale> {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}

/** For server components: const { t } = await getT(); t("home.tagline") */
export async function getT() {
  const locale = await getLocale();
  return {
    locale,
    t: (key: MessageKey, params?: Params) => translate(locale, key, params),
  };
}
