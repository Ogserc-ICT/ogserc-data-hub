import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DATASETS } from "@/lib/datasets";
import { periodLabel } from "@/lib/periods";
import { hasErrors } from "@/lib/ingest/commit";
import { IssueList } from "@/lib/IssueList";
import { fmt } from "@/lib/ui";
import ConfirmButtons from "./ConfirmButtons";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const ids = String((await searchParams).ids ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const subs = ids.length ? await db.select().from(schema.submissions).where(inArray(schema.submissions.id, ids)) : [];
  const visible = subs.filter((s) => user.isCommission || s.licenseeId === user.lic);
  const lics = await db.select().from(schema.licensees);
  return (
    <section className="view">
      <div>
        <h2>Check the upload</h2>
        <p className="sub">Nothing is filed until you confirm. Errors must be corrected in the workbook; warnings are filed and shown to the Commission for review.</p>
      </div>
      {!visible.length && <div className="empty">There is nothing to review. <Link href="/submit">Upload a workbook</Link></div>}
      {visible.map((s) => {
        const def = DATASETS[s.dataset];
        const errors = s.issues.filter((i) => i.level === "error").length, warnings = s.issues.length - errors;
        const preview = (s.rows as Record<string, unknown>[]).slice(0, 8);
        const cols = def.columns.filter((c) => preview.some((r) => r[c.key] != null)).slice(0, 9);
        return (
          <div className="card" key={s.id}>
            <div className="card-head">
              <div>
                <h3>{def.label}</h3>
                <p className="sub small">
                  {s.licenseeId ? lics.find((l) => l.id === s.licenseeId)?.name : "OGSERC reference data"} · {s.format} · {fmt(s.rowCount)} rows ·{" "}
                  {s.periods[0] === "register" ? "register" : s.periods.length > 1 ? `${periodLabel(s.periods[0], "short")} to ${periodLabel(s.periods.at(-1)!, "short")}` : periodLabel(s.periods[0])}
                </p>
              </div>
              <span className={`pill ${errors ? "s-queried" : warnings ? "s-flagged" : "s-validated"}`}>{errors ? `${errors} error${errors > 1 ? "s" : ""}` : warnings ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "Ready"}</span>
            </div>
            <IssueList issues={s.issues} />
            <div className="scroll">
              <table className="nowrap compact">
                <thead><tr>{cols.map((c) => <th key={c.key}>{c.header}</th>)}</tr></thead>
                <tbody>{preview.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={typeof r[c.key] === "number" ? "num" : undefined}>{typeof r[c.key] === "number" ? fmt(r[c.key] as number, Number.isInteger(r[c.key]) ? 0 : 2) : String(r[c.key] ?? "")}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <span className="legend">First {preview.length} of {fmt(s.rowCount)} rows.</span>
            {s.status === "staged" ? <ConfirmButtons id={s.id} blocked={hasErrors(s.issues)} /> : <p className="notice" role="status">{s.status === "discarded" ? "Discarded." : `Filed: ${fmt(s.rowCount)} rows for ${s.periods.length} month${s.periods.length > 1 ? "s" : ""}.`} <Link href={`/submissions/${s.id}`}>View the submission</Link></p>}
          </div>
        );
      })}
    </section>
  );
}
