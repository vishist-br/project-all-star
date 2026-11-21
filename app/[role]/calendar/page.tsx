import { redirect } from "next/navigation";

/** The calendar lives under Today as the Week tab; this keeps old links working. */
export default async function CalendarRedirect({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  redirect(`/${role}/today/week`);
}
