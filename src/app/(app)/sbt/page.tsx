import Link from "next/link";
import { requireCommission } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { monthShort, periodLabel } from "@/lib/periods";
import { REFERRAL_STATUSES } from "@/lib/datasets";
import { sbtMonitor } from "@/lib/sbt";
import { fmt, pct } from "@/lib/ui";
import { CandidateForm } from "./Client";
import { updateReferral } from "./actions";

export default async function SbtPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const sp = await searchParams;
  const period = await resolvePeriod(sp);
  const show = typeof sp.show === "string" ? sp.show : "breach";
  const m = await sbtMonitor(period);
  const rows = m.list.filter((x) => show === "all" || (show === "breach" ? x.status === "Breach" : show === "dq" ? x.dq !== "OK" : show === "tech" ? !!x.techFlag : true));
  return (
    <section className="view">
      <div>
        <h2>Service-based tariff band monitoring · {periodLabel(period)}</h2>
        <p className="sub">Each feeder&apos;s average hours against its band floor{m.tolerance ? `, less ${pct(m.tolerance, 0)} tolerance` : ""}. Feeders that breach for {m.consecutive} consecutive months become referral candidates for Compliance. Settings are on the Admin page.</p>
      </div>
      <div className="strip">
        <div><span className="k">Feeders monitored</span><span className="v">{m.totals.monitored}</span></div>
        <div><span className="k">Met band floor</span><span className="v">{m.totals.met} <small>of {m.totals.reported}</small></span></div>
        <div><span className="k">Breaches</span><span className="v">{m.totals.breaches}</span></div>
        <div><span className="k">Referral candidates</span><span className="v">{m.totals.candidates}</span></div>
        <div><span className="k">Open referrals</span><span className="v">{m.totals.openReferrals}</span></div>
      </div>
      <div className="card">
        <h3>Referral candidates</h3>
        <CandidateForm period={period} candidates={m.list.filter((x) => x.candidate).sort((a, b) => b.run - a.run).map((x) => ({ id: x.id, name: x.name, hub: x.hub, band: x.band, floor: x.floor, hours: x.hours, run: x.run, dq: x.dq }))} />
      </div>
      <div className="card">
        <div className="card-head">
          <h3>Band compliance by feeder</h3>
          <nav className="seg">{[["breach", "Breaches"], ["dq", "Data-quality flags"], ["tech", "Technical flags"], ["all", "All feeders"]].map(([k, l]) => <Link key={k} href={`/sbt?period=${period}&show=${k}`} aria-current={show === k ? "page" : undefined}>{l}</Link>)}</nav>
        </div>
        <div className="scroll" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="compact nowrap">
            <thead><tr><th>ID</th><th>Feeder</th><th>Unit</th><th>Band</th><th className="n">Floor</th><th className="n">Hours</th><th className="n">Shortfall</th><th>Status</th><th className="n">Run</th>{m.months.map((p) => <th key={p} className="n">{monthShort(p)}</th>)}<th>Data quality</th><th>Technical</th><th>Referral</th></tr></thead>
            <tbody>{rows.map((x) => (
              <tr key={x.id}>
                <td className="num">{x.code}</td><td>{x.name}</td><td>{x.hub}</td><td>{x.band}</td><td className="n num">{x.floor}</td><td className="n num">{fmt(x.hours, 1)}</td><td className="n num">{x.shortfall ? fmt(x.shortfall, 1) : ""}</td>
                <td><span className={`pill ${x.status === "Met" ? "s-validated" : x.status === "Breach" ? "s-queried" : "s-missing"}`}>{x.status}</span></td><td className="n num">{x.run || ""}</td>
                {x.statuses.map((st, i) => <td key={i} className="n"><span className={`dot ${st === "Met" ? "ok" : st === "Breach" ? "bad" : "none"}`} title={st} /></td>)}
                <td style={{ fontSize: 12 }}>{x.dq === "OK" ? "" : x.dq}</td><td style={{ fontSize: 12 }}>{x.techFlag ?? ""}</td><td style={{ fontSize: 12 }}>{x.openReferral ?? ""}</td>
              </tr>))}
              {!rows.length && <tr><td colSpan={13 + m.months.length} className="legend">No feeders in this view.</td></tr>}</tbody>
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
