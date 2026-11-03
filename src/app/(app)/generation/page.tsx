import Link from "next/link";
import { requireCommission } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { periodLabel } from "@/lib/periods";
import { generation } from "@/lib/generation";
import { HBars, fmt, pct } from "@/lib/ui";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import { RecordPlan, ScorePlan } from "./Client";

export default async function GenerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const sp = await searchParams;
  const period = await resolvePeriod(sp);
  const g = await generation(period);
  const assets = await db.select().from(schema.generationAssets).orderBy(asc(schema.generationAssets.code));
  const open = typeof sp.ev === "string" ? g.plans.find((p) => p.id === sp.ev) : null;
  const pe = g.settings.planEval;
  return (
    <section className="view">
      <div>
        <h2>Generation</h2>
        <p className="sub">The register of plants serving Ogun State, monthly GenCo returns, and the evaluation of capacity recovery and expansion plans within {pe.deadlineDays} days of receipt.</p>
      </div>
      <div className="strip">
        <div><span className="k">Plants registered</span><span className="v">{g.plants}</span></div>
        <div><span className="k">Installed capacity</span><span className="v">{fmt(g.capacity, 0)} <small>MW</small></span></div>
        <div><span className="k">Plans open</span><span className="v">{g.plans.filter((p) => !p.decidedOn).length}</span></div>
        <div><span className="k">Evaluations past {pe.deadlineDays} days</span><span className="v">{g.plans.filter((p) => p.withinDeadline === "Overdue").length}</span></div>
        <div><span className="k">Plans overdue or never filed</span><span className="v">{g.planDue.filter((p) => p.overdue).length}</span></div>
      </div>
      <div className="panels">
        <div className="card"><h3>Capacity by connection</h3><HBars max={Math.max(...g.byCategory.map((c) => c.capacity), 1) * 1.1} ticks={[]} unit=" MW" items={g.byCategory.map((c) => ({ label: `${c.key} (${c.plants})`, value: c.capacity, text: `${fmt(c.capacity, 1)} MW`, tone: "accent" }))} /></div>
        <div className="card"><h3>Capacity by fuel</h3><HBars max={Math.max(...g.byFuel.map((c) => c.capacity), 1) * 1.1} ticks={[]} unit=" MW" items={g.byFuel.map((c) => ({ label: `${c.key} (${c.plants})`, value: c.capacity, text: `${fmt(c.capacity, 1)} MW`, tone: "accent" }))} /></div>
      </div>
      <div className="card">
        <h3>GenCo plans</h3>
        <RecordPlan plants={assets.filter((a) => a.code).map((a) => ({ id: a.id, label: `${a.code} · ${a.name}` }))} />
        <div className="scroll"><table className="compact">
          <thead><tr><th>Eval ID</th><th>Plant</th><th>Plan type</th><th>Received</th><th>Deadline</th><th className="n">Days</th><th>Gates</th><th className="n">Score</th><th>Recommendation</th><th>Within deadline</th><th /></tr></thead>
          <tbody>{g.plans.map((p) => <tr key={p.id}><td>{p.id}{p.isExample ? <small className="refs"> · worked example</small> : null}</td><td>{p.plantName}</td><td>{p.planType}</td><td>{p.receivedOn}</td><td>{p.deadline}</td><td className="n num">{p.days}</td><td>{p.gatesPassed == null ? "—" : p.gatesPassed ? "Passed" : "Failed"}</td><td className="n num">{p.score ?? "—"}</td><td>{p.recommendation ?? "—"}</td><td>{p.withinDeadline}</td><td><Link href={`/generation?period=${period}&ev=${p.id}`}>Evaluate</Link></td></tr>)}
            {!g.plans.length && <tr><td colSpan={11} className="legend">No plans recorded.</td></tr>}</tbody>
        </table></div>
        {open && (<div className="card" style={{ background: "var(--sunk)" }}><h3>{open.id} · {open.plantName} · {open.planType}</h3>
          <ScorePlan ev={{ id: open.id, gates: open.gates, scores: open.scores, decidedOn: open.decidedOn, leadEvaluator: open.leadEvaluator, conditions: open.conditions }} gates={pe.gates} criteria={open.criteria} bands={pe} /></div>)}
      </div>
      {g.month && (
        <div className="card"><h3>Plant performance · {periodLabel(period)}</h3>
          <div className="scroll"><table className="compact"><thead><tr><th>Plant</th><th className="n">Net MWh</th><th className="n">Capacity availability</th><th className="n">Capacity factor</th><th className="n">Forced outage rate</th><th className="n">Aux.</th><th className="n">Heat rate</th><th className="n">Lost to gas (MWh)</th><th className="n">Lost to grid (MWh)</th></tr></thead>
            <tbody>{g.plantKpis.map((p) => <tr key={p.plant}><td>{p.plant}</td><td className="n num">{fmt(p.netMwh)}</td><td className="n num">{pct(p.capAvailability, 0)}</td><td className="n num">{pct(p.capacityFactor, 0)}</td><td className="n num">{pct(p.forcedOutageRate, 1)}</td><td className="n num">{pct(p.auxRatio, 1)}</td><td className="n num">{fmt(p.heatRate, 0)}</td><td className="n num">{fmt(p.lost.gas)}</td><td className="n num">{fmt(p.lost.grid)}</td></tr>)}</tbody></table></div>
        </div>
      )}
      <div className="card">
        <h3>Plant register</h3>
        <div className="scroll" style={{ maxHeight: "70vh", overflow: "auto" }}><table className="compact">
          <thead><tr><th>Plant ID</th><th>Plant</th><th>Owner / licensee</th><th className="n">MW</th><th className="n">Available</th><th>Connection</th><th>Fuel / technology</th><th>Status</th><th>Licence</th><th>Plan</th></tr></thead>
          <tbody>{assets.map((a) => <tr key={a.id}><td className="num">{a.code}</td><td>{a.name}<small className="refs" style={{ display: "block" }}>{[a.lga, a.location].filter(Boolean).join(" · ")}</small></td><td style={{ fontSize: 13 }}>{a.owner}</td><td className="n num">{fmt(a.capacityMw, 1)}</td><td className="n num">{fmt(a.availableMw, 0)}</td><td>{a.category}</td><td style={{ fontSize: 13 }}>{a.technology || a.fuel}</td><td style={{ fontSize: 13 }}>{a.status}</td><td style={{ fontSize: 13 }}>{a.permitStatus}</td><td style={{ fontSize: 13 }}>{a.planStatus}</td></tr>)}</tbody>
        </table></div>
      </div>
    </section>
  );
}
