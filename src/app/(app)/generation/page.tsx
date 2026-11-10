import Link from "next/link";
import { requireCommission } from "@/lib/auth";
import { allSpanOptions, resolveSpan } from "@/lib/period";
import { generation } from "@/lib/generation";
import { HBars, fmt, pct } from "@/lib/ui";
import { db, schema } from "@/db";
import { asc } from "drizzle-orm";
import SpanControls from "../SpanControls";
import { RecordPlan, ScorePlan } from "./Client";

const EDITION = { month: "Monthly", quarter: "Quarterly", year: "Annual" } as const;
const chg = (a: number | null | undefined, b: number | null | undefined, ratio = false) => {
  if (a == null || b == null) return "";
  if (ratio) { const d = (a - b) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`; }
  if (!b) return "";
  const d = ((a - b) / Math.abs(b)) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
};

export default async function GenerationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const sp = await searchParams;
  const span = await resolveSpan(sp);
  const period = span.end, multi = span.months.length > 1;
  const [allAssets, allLics] = await Promise.all([
    db.select().from(schema.generationAssets).orderBy(asc(schema.generationAssets.code)),
    db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder)),
  ]);
  // Generating licensees: those owing unit or plant returns, or owning a plant in the register.
  const lics = allLics.filter((l) => l.obligations.some((o) => o === "GENUNIT" || o === "GENPLANT") || allAssets.some((a) => a.licenseeId === l.id));
  const scope = typeof sp.licensee === "string" ? lics.find((l) => l.id === sp.licensee) ?? null : null;
  const assets = scope ? allAssets.filter((a) => a.licenseeId === scope.id) : allAssets;
  const g = await generation(period, span.months, { licensee: scope?.id ?? null, prevSpan: span.prevMonths });
  const open = typeof sp.ev === "string" ? g.plans.find((p) => p.id === sp.ev) : null;
  const pe = g.settings.planEval;
  const base = { ...(span.kind !== "month" ? { span: span.kind } : {}), period, ...(scope ? { licensee: scope.id } : {}) };
  const evHref = (id: string) => `/generation?${new URLSearchParams({ ...base, ev: id }).toString()}`;
  const M = g.month, P = g.prev, vs = `on previous ${span.noun}`;
  return (
    <section className="view">
      <SpanControls span={span.kind} period={period} licensee={scope?.id ?? ""} allLabel="All generating licensees" options={allSpanOptions()}
        licensees={lics.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }))} />
      <div>
        <h2>Generation · {EDITION[span.kind]} · {span.label}{span.partial ? " (to date)" : ""}{scope ? ` · ${scope.code}` : ""}</h2>
        <p className="sub">The register of plants serving Ogun State, GenCo returns {multi ? `over ${span.range}` : `for ${span.label}`}, and the evaluation of capacity recovery and expansion plans within {pe.deadlineDays} days of receipt.</p>
      </div>
      {M ? (
        <div className="kpis">
          <Kpi k="Net generation" v={`${fmt(M.netMwh / 1000, 1)} GWh`} d={chg(M.netMwh, P?.netMwh)} vs={vs} />
          <Kpi k="Capacity availability" v={pct(M.capAvailability, 0)} d={chg(M.capAvailability, P?.capAvailability, true)} vs={vs} />
          <Kpi k="Capacity factor" v={pct(M.capacityFactor, 0)} d={chg(M.capacityFactor, P?.capacityFactor, true)} vs={vs} />
          <Kpi k="Forced outage rate" v={pct(M.forcedOutageRate, 1)} d={chg(M.forcedOutageRate, P?.forcedOutageRate, true)} vs={vs} />
        </div>
      ) : <p className="empty">No generating unit returns were filed for {multi ? span.range : span.label}.</p>}
      <div className="strip">
        <div><span className="k">Plants registered</span><span className="v">{g.plants}</span></div>
        <div><span className="k">Installed capacity</span><span className="v">{fmt(g.capacity, 0)} <small>MW</small></span></div>
        <div><span className="k">Plans open</span><span className="v">{g.plans.filter((p) => !p.decidedOn).length}</span></div>
        <div><span className="k">Evaluations past {pe.deadlineDays} days</span><span className="v">{g.plans.filter((p) => p.withinDeadline === "Overdue").length}</span></div>
        <div><span className="k">Plans overdue or never filed</span><span className="v">{g.planDue.filter((p) => p.overdue).length}</span></div>
        <div><span className="k">Plans received / decided in {span.noun}</span><span className="v">{g.plansReceivedInSpan} <small>/ {g.plansDecidedInSpan}</small></span></div>
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
          <tbody>{g.plans.map((p) => <tr key={p.id}><td>{p.id}{p.isExample ? <small className="refs"> · worked example</small> : null}</td><td>{p.plantName}</td><td>{p.planType}</td><td>{p.receivedOn}</td><td>{p.deadline}</td><td className="n num">{p.days}</td><td>{p.gatesPassed == null ? "—" : p.gatesPassed ? "Passed" : "Failed"}</td><td className="n num">{p.score ?? "—"}</td><td>{p.recommendation ?? "—"}</td><td>{p.withinDeadline}</td><td><Link href={evHref(p.id)}>Evaluate</Link></td></tr>)}
            {!g.plans.length && <tr><td colSpan={11} className="legend">No plans recorded.</td></tr>}</tbody>
        </table></div>
        {open && (<div className="card" style={{ background: "var(--sunk)" }}><h3>{open.id} · {open.plantName} · {open.planType}</h3>
          <ScorePlan ev={{ id: open.id, gates: open.gates, scores: open.scores, decidedOn: open.decidedOn, leadEvaluator: open.leadEvaluator, conditions: open.conditions }} gates={pe.gates} criteria={open.criteria} bands={pe} /></div>)}
      </div>
      {g.month && (
        <div className="card"><h3>Plant performance · {span.label}{multi ? ` (${span.range}${span.partial ? ", to date" : ""})` : ""}</h3>
          <div className="scroll"><table className="compact"><thead><tr><th>Plant</th><th className="n">Net MWh</th><th className="n">Capacity availability</th><th className="n">Capacity factor</th><th className="n">Forced outage rate</th><th className="n">Aux.</th><th className="n">Heat rate</th><th className="n">Lost to gas (MWh)</th><th className="n">Lost to grid (MWh)</th></tr></thead>
            <tbody>{g.plantKpis.map((p) => <tr key={p.plant}><td>{p.plant}</td><td className="n num">{fmt(p.netMwh)}</td><td className="n num">{pct(p.capAvailability, 0)}</td><td className="n num">{pct(p.capacityFactor, 0)}</td><td className="n num">{pct(p.forcedOutageRate, 1)}</td><td className="n num">{pct(p.auxRatio, 1)}</td><td className="n num">{fmt(p.heatRate, 0)}</td><td className="n num">{fmt(p.lost.gas)}</td><td className="n num">{fmt(p.lost.grid)}</td></tr>)}
              {g.plantKpis.length > 1 && M && <tr className="total"><td>All plants</td><td className="n num">{fmt(M.netMwh)}</td><td className="n num">{pct(M.capAvailability, 0)}</td><td className="n num">{pct(M.capacityFactor, 0)}</td><td className="n num">{pct(M.forcedOutageRate, 1)}</td><td className="n num">{pct(M.auxRatio, 1)}</td><td className="n num">{fmt(M.heatRate, 0)}</td><td className="n num">{fmt(M.lost.gas)}</td><td className="n num">{fmt(M.lost.grid)}</td></tr>}</tbody></table></div>
          {multi && <p className="legend">Energy and lost output are totals over the period; availability, capacity factor and outage rate are weighted by the hours in each month.</p>}
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

function Kpi({ k, v, d, vs }: { k: string; v: string; d: string; vs: string }) {
  return <div className="kpi"><span className="k">{k}</span><span className="v">{v}</span>{d && <span className="d">{d} {vs}</span>}</div>;
}
