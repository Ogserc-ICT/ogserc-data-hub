import Link from "next/link";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { allSpanOptions, resolveSpan } from "@/lib/period";
import { monthShort, periodLabel } from "@/lib/periods";
import { REFERRAL_STATUSES } from "@/lib/datasets";
import { sbtMonitor } from "@/lib/sbt";
import { fmt, pct } from "@/lib/ui";
import SpanControls from "../SpanControls";
import { CandidateForm } from "./Client";
import { updateReferral } from "./actions";

export default async function SbtPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const sp = await searchParams;
  const span = await resolveSpan(sp);
  const period = span.end, multi = span.months.length > 1;
  const lics = (await db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder))).filter((l) => l.obligations.includes("FEEDER"));
  const scope = typeof sp.licensee === "string" ? lics.find((l) => l.id === sp.licensee) ?? null : null;
  const show = typeof sp.show === "string" ? sp.show : "breach";
  const m = await sbtMonitor(period, scope?.id ?? null, span.months);
  const breached = (x: (typeof m.list)[number]) => (multi ? x.spanBreached > 0 : x.status === "Breach");
  const rows = m.list.filter((x) => show === "all" || (show === "breach" ? breached(x) : show === "dq" ? x.dq !== "OK" : show === "tech" ? !!x.techFlag : true));
  // A monthly view keeps the year-to-date status dots; a quarter or year shows its own months.
  const dotMonths = multi ? m.span : m.months;
  const href = (k: string) => `/sbt?${new URLSearchParams({ ...(span.kind !== "month" ? { span: span.kind } : {}), period, ...(scope ? { licensee: scope.id } : {}), show: k }).toString()}`;
  const T = m.totals;
  return (
    <section className="view">
      <SpanControls span={span.kind} period={period} licensee={scope?.id ?? ""} allLabel="All distribution licensees" options={allSpanOptions()} keep={{ show }}
        licensees={lics.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }))} />
      <div>
        <h2>{EDITION[span.kind]}service-based tariff band monitoring · {span.label}{span.partial ? " (to date)" : ""}{scope ? ` · ${scope.code}` : ""}</h2>
        <p className="sub">{multi ? <>Each feeder&apos;s average hours over {span.range} against its band floor</> : <>Each feeder&apos;s average hours against its band floor</>}{m.tolerance ? `, less ${pct(m.tolerance, 0)} tolerance` : ""}. Feeders that breach for {m.consecutive} consecutive months become referral candidates for Compliance{multi ? `; candidates and runs are as at ${periodLabel(period)}` : ""}. Settings are on the Admin page.</p>
      </div>
      {multi ? (
        <div className="strip">
          <div><span className="k">Feeders monitored</span><span className="v">{T.monitored}</span></div>
          <div><span className="k">Met floor on average</span><span className="v">{T.spanMet} <small>of {T.spanReported}</small></span></div>
          <div><span className="k">Breached in at least one month</span><span className="v">{T.spanBreachedAny}</span></div>
          <div><span className="k">Feeder-months breached</span><span className="v">{T.feederMonthsBreached} <small>of {T.feederMonthsReported}</small></span></div>
          <div><span className="k">Referrals logged in period</span><span className="v">{T.referredInSpan}</span></div>
          <div><span className="k">Referral candidates</span><span className="v">{T.candidates}</span></div>
          <div><span className="k">Open referrals</span><span className="v">{T.openReferrals}</span></div>
        </div>
      ) : (
        <div className="strip">
          <div><span className="k">Feeders monitored</span><span className="v">{T.monitored}</span></div>
          <div><span className="k">Met band floor</span><span className="v">{T.met} <small>of {T.reported}</small></span></div>
          <div><span className="k">Breaches</span><span className="v">{T.breaches}</span></div>
          <div><span className="k">Referral candidates</span><span className="v">{T.candidates}</span></div>
          <div><span className="k">Open referrals</span><span className="v">{T.openReferrals}</span></div>
        </div>
      )}
      <div className="card">
        <h3>Referral candidates{multi ? ` · as at ${periodLabel(period)}` : ""}</h3>
        <CandidateForm period={period} candidates={m.list.filter((x) => x.candidate).sort((a, b) => b.run - a.run).map((x) => ({ id: x.id, name: x.name, hub: x.hub, band: x.band, floor: x.floor, hours: x.hours, run: x.run, dq: x.dq }))} />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Band compliance by feeder</h3>
          <nav className="seg">{[["breach", "Breaches"], ["dq", "Data-quality flags"], ["tech", "Technical flags"], ["all", "All feeders"]].map(([k, l]) => <Link key={k} href={href(k)} aria-current={show === k ? "page" : undefined}>{l}</Link>)}</nav>
        </div>
        <div className="scroll" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="compact nowrap">
            <thead><tr><th>ID</th><th>Feeder</th><th>Unit</th><th>Band</th><th className="n">Floor</th><th className="n">{multi ? "Avg hours" : "Hours"}</th><th className="n">Shortfall</th><th>{multi ? "Status (average)" : "Status"}</th>{multi && <th className="n">Months breached</th>}<th className="n">Run</th>{dotMonths.map((p) => <th key={p} className="n">{monthShort(p)}</th>)}<th>Data quality</th><th>Technical</th><th>Referral</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id}>
                <td className="num">{x.code}</td><td>{x.name}</td><td>{x.hub}</td><td>{x.band}</td><td className="n num">{x.floor}</td><td className="n num">{fmt(multi ? x.spanAvg : x.hours, 1)}</td><td className="n num">{(multi ? x.spanShortfall : x.shortfall) ? fmt(multi ? x.spanShortfall : x.shortfall, 1) : ""}</td>
                <Status s={multi ? x.spanStatus : x.status} />{multi && <td className="n num">{x.spanBreached ? `${x.spanBreached} of ${x.spanMet + x.spanBreached}` : ""}</td>}<td className="n num">{x.run || ""}</td>
                {(multi ? x.spanStatuses : x.statuses).map((st, i) => <td key={i} className="n"><span className={`dot ${st === "Met" ? "ok" : st === "Breach" ? "bad" : "none"}`} title={st} /></td>)}
                <td style={{ fontSize: 12 }}>{x.dq === "OK" ? "" : x.dq}</td><td style={{ fontSize: 12 }}>{x.techFlag ?? ""}</td><td style={{ fontSize: 12 }}>{x.openReferral ?? ""}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={13 + (multi ? 1 : 0) + dotMonths.length} className="legend">No feeders in this view.</td></tr>}</tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h3>Breach referral log</h3>
        <div className="scroll" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="compact">
            <thead><tr><th>Referral no.</th><th>Referred</th><th>Feeder</th><th>Band</th><th className="n">Avg h</th><th className="n">Shortfall</th><th>Data quality</th><th>Status and case</th></tr></thead>
            <tbody>{m.referrals.map((r) => (
              <tr key={r.ref}>
                <td className="num"><Link href={`/sbt/referral/${r.ref}`}>{r.ref}</Link></td><td style={{ whiteSpace: "nowrap" }}>{r.referredOn}<small className="refs" style={{ display: "block" }}>{r.referredBy}</small></td>
                <td>{r.feederName}<small className="refs" style={{ display: "block" }}>{r.hub}</small></td><td>{r.band}</td><td className="n num">{fmt(r.avgHours, 1)}</td><td className="n num">{fmt(r.shortfall, 1)}</td><td style={{ fontSize: 12 }}>{r.dataQualityFlag}</td>
                <td>
                  <form action={updateReferral} className="actions">
                    <input type="hidden" name="ref" value={r.ref} />
                    <select name="status" defaultValue={r.status} aria-label="Status">{REFERRAL_STATUSES.map((st) => <option key={st}>{st}</option>)}</select>
                    <input name="caseNo" defaultValue={r.caseNo ?? ""} placeholder="Case no." aria-label="Compliance case number" style={{ width: 110 }} />
                    <input name="notes" defaultValue={r.notes} placeholder="Outcome / notes" aria-label="Notes" style={{ width: 170 }} />
                    <button type="submit">Save</button>
                  </form>
                </td>
              </tr>))}
              {!m.referrals.length && <tr><td colSpan={8} className="legend">No referrals logged.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const EDITION = { month: "", quarter: "Quarterly ", year: "Annual " } as const;

function Status({ s }: { s: "Met" | "Breach" | "No data" }) {
  return <td><span className={`pill ${s === "Met" ? "s-validated" : s === "Breach" ? "s-queried" : "s-missing"}`}>{s}</span></td>;
}
