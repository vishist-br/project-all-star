import { notFound } from "next/navigation";
import { BodyMeasurementsScreen } from "@/components/body-measurements/BodyMeasurementsScreen";

export const dynamic = "force-dynamic";

/** Customer: body measurements with a trend per measurement. Reached from Progress. */
export default async function BodyPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await params;
  if (role !== "customer") notFound();
  return <BodyMeasurementsScreen searchParams={await searchParams} />;
}
