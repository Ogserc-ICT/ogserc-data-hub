import { requireUser } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { periodLabel } from "@/lib/periods";
import { buildSheets } from "@/lib/workbook";
import WorkbookView from "./WorkbookView";

export default async function DataPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const period = await resolvePeriod(await searchParams);
  const sheets = await buildSheets(user, period);
  return (
    <section className="view">
      <div className="card-head">
        <div>
          <h2>Data</h2>
          <p className="sub">Everything filed for the twelve months to {periodLabel(period)}, one sheet per dataset{user.isCommission ? ", with market indicators computed from it" : ""}.</p>
        </div>
        <a className="btn primary" href={`/api/export?period=${period}`}>Download workbook (.xlsx)</a>
      </div>
      <WorkbookView sheets={sheets} />
    </section>
  );
}
