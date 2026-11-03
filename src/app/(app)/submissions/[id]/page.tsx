import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DATASETS } from "@/lib/datasets";
import { periodLabel } from "@/lib/periods";
import { IssueList } from "@/lib/IssueList";
import { fmt } from "@/lib/ui";
import ReviewControls from "../ReviewControls";

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || (!user.isCommission && s.licenseeId !== user.lic)) notFound();
  const lic = s.licenseeId ? await db.query.licensees.findFirst({ where: eq(schema.licensees.id, s.licenseeId) }) : null;
  const def = DATASETS[s.dataset];
  const rows = s.rows as Record<string, unknown>[];
  const cols = def.columns;
  const e = s.issues.filter((i) => i.level === "error").length;
  return (
    <section className="view">
      <div className="card-head">
        <div>
          <p className="legend"><Link href="/submissions">Submissions</Link> /</p>
          <h2>{def.label} · {lic?.name ?? "OGSERC"}</h2>
          <p className="sub">
            {s.periods[0] === "register" ? "Register" : s.periods.map((p) => periodLabel(p, "short")).join(", ")} · {fmt(s.rowCount)} rows · {s.channel === "api" ? "API" : s.format}
            {s.fileName ? ` · ${s.fileName}` : ""} · filed by {s.submittedByName} on {s.createdAt.toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}
          </p>
        </div>
        <div className="actions">
          {s.file && <a className="btn" href={`/api/submissions/${s.id}/file`}>Original file</a>}
          {s.issues.length > 0 && <a className="btn" href={`/api/submissions/${s.id}/issues`}>Issues (CSV)</a>}
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Status: {s.status === "accepted" ? "Accepted" : s.status === "queried" ? "Queried" : s.status === "staged" ? "Awaiting confirmation" : s.status[0].toUpperCase() + s.status.slice(1)}</h3>
          {user.isCommission && ["received", "accepted", "queried"].includes(s.status) && <ReviewControls id={s.id} reviewed={s.status !== "received"} ownSubmission={s.submittedById === user.uid} />}
        </div>
        {s.reviewNote && <p className="notice err">Commission query: {s.reviewNote}</p>}
        {s.status === "staged" && <p className="notice">Not filed yet. <Link href={`/submit/review?ids=${s.id}`}>Review and confirm</Link></p>}
        <h3>Checks{e ? "" : ""}</h3>
        <IssueList issues={s.issues} limit={20} />
      </div>
      <div className="card">
        <h3>Rows filed</h3>
        <div className="scroll" style={{ maxHeight: "60vh", overflow: "auto" }}>
          <table className="nowrap compact">
            <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}{c.unit ? ` (${c.unit})` : ""}</th>)}</tr></thead>
            <tbody>{rows.slice(0, 500).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={typeof r[c.key] === "number" ? "num" : undefined}>{typeof r[c.key] === "number" ? fmt(r[c.key] as number, Number.isInteger(r[c.key]) ? 0 : 2) : String(r[c.key] ?? "")}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {rows.length > 500 && <span className="legend">Showing 500 of {fmt(rows.length)} rows. The full set is in the Data tab and the workbook download.</span>}
      </div>
    </section>
  );
}
