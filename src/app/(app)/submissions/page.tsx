import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DATASETS, isDataset } from "@/lib/datasets";
import { periodLabel } from "@/lib/periods";
import { fmt } from "@/lib/ui";

const STATUS: Record<string, [string, string]> = {
  received: ["Received", "s-received"], accepted: ["Accepted", "s-validated"], queried: ["Queried", "s-queried"],
  superseded: ["Superseded", "s-missing"], staged: ["Awaiting confirmation", "s-missing"],
};

export default async function SubmissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const ds = isDataset(sp.dataset) ? sp.dataset : null;
  const st = typeof sp.status === "string" && sp.status in STATUS ? sp.status : null;
  const conds = [ne(schema.submissions.status, "discarded")];
  if (!user.isCommission) conds.push(eq(schema.submissions.licenseeId, user.lic ?? "__none__"));
  if (ds) conds.push(eq(schema.submissions.dataset, ds));
  if (st) conds.push(eq(schema.submissions.status, st as "received"));
  const subs = await db.select({
    id: schema.submissions.id, licenseeId: schema.submissions.licenseeId, dataset: schema.submissions.dataset, periods: schema.submissions.periods,
    format: schema.submissions.format, channel: schema.submissions.channel, rowCount: schema.submissions.rowCount, issues: schema.submissions.issues,
    status: schema.submissions.status, submittedByName: schema.submissions.submittedByName, createdAt: schema.submissions.createdAt, reviewNote: schema.submissions.reviewNote,
  }).from(schema.submissions).where(and(...conds)).orderBy(desc(schema.submissions.createdAt)).limit(200);
  const lics = await db.select().from(schema.licensees);
  return (
    <section className="view">
      <div>
        <h2>Submissions</h2>
        <p className="sub">Every upload and API filing, newest first. {user.isCommission ? "Accept a submission once its warnings are explained, or query it with the licensee." : "Queries from the Commission appear here. Correct the figures and upload again; the new filing replaces the old one for the same months."}</p>
      </div>
      <form className="filters" method="get">
        <label className="ctl" htmlFor="fds">Dataset
          <select id="fds" name="dataset" defaultValue={ds ?? ""}>
            <option value="">All</option>
            {Object.values(DATASETS).map((d) => <option key={d.code} value={d.code}>{d.short}</option>)}
          </select>
        </label>
        <label className="ctl" htmlFor="fst">Status
          <select id="fst" name="status" defaultValue={st ?? ""}>
            <option value="">All</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
      <div className="card">
        {subs.length ? (
          <div className="scroll">
            <table>
              <thead><tr><th>Licensee</th><th>Dataset</th><th>Months</th><th className="n">Rows</th><th>Checks</th><th>Status</th><th>Filed</th></tr></thead>
              <tbody>
                {subs.map((s) => {
                  const e = s.issues.filter((i) => i.level === "error").length, w = s.issues.length - e;
                  const [label, cls] = s.status === "staged" && e ? ["Not filed: fix errors", "s-queried"] : STATUS[s.status] ?? [s.status, "s-missing"];
                  return (
                    <tr key={s.id}>
                      <td className="lic"><Link href={`/submissions/${s.id}`}>{s.licenseeId ? lics.find((l) => l.id === s.licenseeId)?.name : "OGSERC"}</Link><small>{s.channel === "api" ? "API" : s.format}</small></td>
                      <td>{DATASETS[s.dataset].short}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{s.periods[0] === "register" ? "Register" : s.periods.length > 1 ? `${periodLabel(s.periods[0], "short")} – ${periodLabel(s.periods.at(-1)!, "short")}` : periodLabel(s.periods[0], "short")}</td>
                      <td className="n num">{fmt(s.rowCount)}</td>
                      <td style={{ fontSize: 13 }}>{e ? <span style={{ color: "var(--bad)" }}>{e} errors</span> : w ? <span style={{ color: "var(--warn)" }}>{w} warnings</span> : "Clean"}</td>
                      <td><span className={`pill ${cls}`}>{label}</span>{s.reviewNote && <small className="refs" style={{ display: "block", color: "var(--bad)" }}>{s.reviewNote}</small>}</td>
                      <td style={{ fontSize: 13, whiteSpace: "nowrap" }}>{s.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })}<small style={{ display: "block", color: "var(--muted)" }}>{s.submittedByName}</small></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">No submissions match. <Link href="/submit">Submit data</Link></div>}
      </div>
    </section>
  );
}
