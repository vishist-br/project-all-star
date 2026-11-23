import { redirect } from "next/navigation";
import { isOpenPoc } from "@/lib/demo";
import { MagicLanding } from "@/components/MagicLanding";
import { getSessionOrNull } from "@/lib/session";

// The link carries a one-time token: never send it on as a referrer.
export const metadata = { referrer: "no-referrer" as const };

export default async function MagicPage() {
  if (isOpenPoc()) redirect("/");
  // A link that was already used must not strand someone who is signed in: offer their own home.
  const session = await getSessionOrNull();
  return <MagicLanding signedInRole={session?.source === "real" ? session.role : null} />;
}
