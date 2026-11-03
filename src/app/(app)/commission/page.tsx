import { requireCommission } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { periodLabel } from "@/lib/periods";
import { commission } from "@/lib/metrics";
import ActivityForm from "./Form";

export default async function CommissionPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const period = await resolvePeriod(await searchParams);
  const rows = await commission(period);
  return (
    <section className="view">
      <div>
        <h2>Commission activity · {periodLabel(period)}</h2>
        <p className="sub">Each department records its activity for the month here. The figures appear in section 8 of the market report. Leave a figure blank if it is not yet known.</p>
      </div>
      <ActivityForm period={period} rows={rows} />
    </section>
  );
}
