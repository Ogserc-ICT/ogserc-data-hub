import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { periodLabel } from "@/lib/periods";
import { DATASETS } from "@/lib/datasets";
import { commercial, complianceGrid, technical } from "@/lib/metrics";
import { HBars, LineChart, StatusPill, fmt, ngn, pct } from "@/lib/ui";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const period = await resolvePeriod(await searchParams);
  const [{ grid, totals, datasets }, tech, com] = await Promise.all([
    complianceGrid(period, user.isCommission ? null : user.lic),
    user.isCommission ? technical(period) : null,
    user.isCommission ? commercial(period) : null,
  ]);

  return (
    <section className="view">
      <div className="card-head">
        <div>
          <h2>{user.isCommission ? "Market overview" : "Your returns"} · {periodLabel(period)}</h2>
          <p className="sub">
            {user.isCommission
              ? "Which licensees have filed their monthly returns, and the headline technical and commercial position from the data received."
              : "The returns your organisation owes the Commission this month, and their status."}
          </p>
        </div>
        <div className="actions">
          <Link className="btn primary" href={`/submit?period=${period}`}>Submit data</Link>
          {user.isCommission && <Link className="btn" href={`/report?period=${period}`}>Open market report</Link>}
        </div>
      </div>

      <div className="strip">
        <div><span className="k">Returns due</span><span className="v">{totals.due}</span></div>
        <div><span className="k">Received</span><span className="v">{totals.received} <small>({totals.due ? Math.round((totals.received / totals.due) * 100) : 0}%)</small></span></div>
        <div><span className="k">Accepted</span><span className="v">{totals.accepted}</span></div>
        <div><span className="k">Flagged or queried</span><span className="v">{totals.flagged}</span></div>
        <div><span className="k">Outstanding</span><span className="v">{totals.missing}</span></div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Returns compliance</h3><span className="legend">Returns are due by the 15th of the following month</span></div>
        <div className="scroll">
          <table className="nowrap">
            <thead><tr><th>Licensee</th>{datasets.map((d) => <th key={d}>{DATASETS[d].short}</th>)}</tr></thead>
            <tbody>
              {grid.map(({ licensee: l, cells }) => (
                <tr key={l.id}>
                  <td className="lic">{l.code || l.name}<small>{l.code ? `${l.name} · ` : ""}{l.area}{l.licenceStatus !== "Licensed" ? ` · ${l.licenceStatus}` : ""}</small></td>
                  {cells.map((c) => (
                    <td key={c.dataset}>
                      {c.submissionId ? <Link href={`/submissions/${c.submissionId}`} className="plain"><StatusPill s={c.status} /></Link> : <StatusPill s={c.status} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {tech && com && (
        <>
          <div className="strip">
            <div><span className="k">Avg. supply per feeder</span><span className="v">{fmt(tech.total.avgHours, 1)} <small>h/day</small></span></div>
            <div><span className="k">Feeders meeting band</span><span className="v">{pct(tech.total.compliance, 0)}</span></div>
            <div><span className="k">Energy delivered</span><span className="v">{fmt(tech.total.delivered / 1000, 1)} <small>GWh</small></span></div>
            <div><span className="k">Collection efficiency</span><span className="v">{pct(com.total.ce, 1)}</span></div>
            <div><span className="k">ATC&amp;C loss</span><span className="v">{pct(com.total.atcc, 1)}</span></div>
          </div>
          <div className="panels">
            <div className="card">
              <div><h3>Supply hours against band commitment</h3><p className="sub small">Average hours per day by service band; the marker is the band&apos;s regulatory minimum</p></div>
              <HBars max={24} ticks={[0, 6, 12, 18, 24]} unit=" h"
                items={tech.byBand.map((b) => ({ label: `Band ${b.band} · ${b.reporting} feeders`, value: b.avgHours, target: b.threshold, tone: (b.avgHours ?? 0) >= (b.threshold ?? 0) ? "ok" : (b.avgHours ?? 0) >= (b.threshold ?? 0) - 4 ? "warn" : "bad" }))} />
            </div>
            <div className="card">
              <div><h3>ATC&amp;C loss by business hub</h3><p className="sub small">1 − billing efficiency × collection efficiency (kWh basis)</p></div>
              <HBars max={0.6} ticks={[0, 0.15, 0.3, 0.45, 0.6].map((t) => Math.round(t * 100))} unit="%"
                items={com.byHub.map((h) => ({ label: h.hub, value: (h.atcc ?? 0) * 100, text: pct(h.atcc), tone: (h.atcc ?? 0) > 0.4 ? "bad" : (h.atcc ?? 0) > 0.25 ? "warn" : "ok" }))} />
            </div>
            <div className="card">
              <div><h3>Average supply hours</h3><p className="sub small">All reporting feeders, last seven months</p></div>
              <LineChart months={tech.months} series={[{ name: "Hours per day", values: tech.trend.map((t) => t.avgHours), tone: "s1" }]} format={(v) => fmt(v, 1)} max={24} />
            </div>
            <div className="card">
              <div><h3>Billing and collection</h3><p className="sub small">Amount billed and collected, all hubs</p></div>
              <LineChart months={com.months} format={(v) => ngn(v)} series={[
                { name: "Billed", values: com.trend.map((t) => (t.billedNgn || null)), tone: "s1" },
                { name: "Collected", values: com.trend.map((t) => (t.collected || null)), tone: "s2" },
              ]} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
