import { MagicLanding } from "@/components/MagicLanding";

// The link carries a one-time token: never send it on as a referrer.
export const metadata = { referrer: "no-referrer" as const };

export default function MagicPage() {
  return <MagicLanding />;
}
