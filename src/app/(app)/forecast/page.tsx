import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { allSpanOptions, resolveSpan } from "@/lib/period";
import { periodLabel } from "@/lib/periods";
import { loadForecast } from "@/lib/forecast";
import { LineChart, fmt, pct } from "@/lib/ui";
import SpanControls from "../SpanControls";

const EDITION = { month: "Monthly", quarter: "Quarterly", year: "Annual" } as const;
const chg = (a: number | null | undefined, b: number | null | undefined) =>
  a == null || b == null || !b ? "" : (() => { const d = ((a - b) / Math.abs(b)) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`; })();

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const sp = await searchParams;
  const span = await resolveSpan(sp);
  const period = span.end, multi = span.months.length > 1;
  const lics = (await db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder))).filter((l) => l.obligations.includes("FEEDER"));
  const scope = typeof sp.licensee === "string" ? lics.find((l) => l.id === sp.licensee) ?? null : null;
  const f = await loadForecast(period, scope?.id ?? null, { months: span.months, prevMonths: span.prevMonths });
  const a = f.assumptions;
  const where = multi ? span.range : span.label;
  const vs = f.prev ? `on ${span.prevShort}` : "";
  return (
    <section className="view">
      <SpanControls span={span.kind} period={period} licensee={scope?.id ?? ""} allLabel="All distribution licensees" options={allSpanOptions()}
        licensees={lics.map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }))} />
      <div>
        <h2>Load forecast baseline · {EDITION[span.kind]} · {span.label}{span.partial ? " (to date)" : ""}{scope ? ` · ${scope.code}` : ""}</h2>
        <p className="sub">Declared demand is the energy {scope ? scope.code : "distribution licensees"} nominated; delivered is what {scope ? "its" : "their"} feeders supplied, both as average MW over {where}{f.baseline.months && f.baseline.months < span.months.length ? ` (${f.baseline.months} of ${span.months.length} months filed)` : ""}. Growth scenarios run to {a.endYear}, the horizon of the Ogun State Electricity Policy 2026–2036. Assumptions are on the Admin page.</p>
      </div>
      {f.declaredMw == null ? <div className="empty">No feeder returns for {where} yet.</div> : (<>
        <div className="strip">
          <div><span className="k">Declared demand</span><span className="v">{fmt(f.declaredMw, 1)} <small>avg MW</small></span>{vs && chg(f.declaredMw, f.prev?.declaredMw) && <span className="d">{chg(f.declaredMw, f.prev?.declaredMw)} {vs}</span>}</div>
          <div><span className="k">Delivered</span><span className="v">{fmt(f.deliveredMw, 1)} <small>avg MW</small></span>{vs && chg(f.deliveredMw, f.prev?.deliveredMw) && <span className="d">{chg(f.deliveredMw, f.prev?.deliveredMw)} {vs}</span>}</div>
          <div><span className="k">Unserved share</span><span className="v">{pct(f.unservedShare, 1)}</span></div>
          <div><span className="k">Energy nominated / delivered</span><span className="v">{fmt(f.baseline.nominated / 1000, 1)} <small>/ {fmt(f.baseline.delivered / 1000, 1)} GWh</small></span></div>
          <div><span className="k">Annualised demand</span><span className="v">{fmt(f.annualDeclaredGwh, 0)} <small>GWh</small></span></div>
          <div><span className="k">Base case {a.endYear}</span><span className="v">{fmt(f.scenarios.base.at(-1), 0)} <small>avg MW</small></span></div>
        </div>
        <div className="panels">
          <div className="card"><h3>Declared and delivered by month, {period.slice(0, 4)}</h3><LineChart months={f.months} format={(v) => fmt(v, 0)} series={[{ name: "Declared (avg MW)", values: f.monthly.map((m) => m.declaredMw), tone: "s1" }, { name: "Delivered (avg MW)", values: f.monthly.map((m) => m.deliveredMw), tone: "s2" }]} /></div>
          <div className="card"><h3>Scenarios to {a.endYear} (from the {span.label} baseline)</h3>
            <table className="compact"><thead><tr><th>Year</th><th className="n">Low {pct(a.low, 0)} (MW)</th><th className="n">Base {pct(a.base, 0)} (MW)</th><th className="n">High {pct(a.high, 0)} (MW)</th><th className="n">Base (GWh)</th></tr></thead>
              <tbody>{f.years.map((y, i) => <tr key={y}><td>{y}</td><td className="n num">{fmt(f.scenarios.low[i], 1)}</td><td className="n num">{fmt(f.scenarios.base[i], 1)}</td><td className="n num">{fmt(f.scenarios.high[i], 1)}</td><td className="n num">{fmt((f.scenarios.base[i] * 8760) / 1000, 0)}</td></tr>)}</tbody></table>
          </div>
        </div>
        {f.prev && (
          <div className="card"><h3>{span.label} compared with {span.prevShort}{span.partial ? " (same months)" : ""}</h3>
            <div className="scroll"><table className="compact"><thead><tr><th>Indicator</th><th className="n">{span.short}</th><th className="n">{span.prevShort}</th><th className="n">Change</th></tr></thead>
              <tbody>
                <tr><td>Energy nominated (MWh)</td><td className="n num">{fmt(f.baseline.nominated)}</td><td className="n num">{fmt(f.prev.nominated)}</td><td className="n num">{chg(f.baseline.nominated, f.prev.nominated)}</td></tr>
                <tr><td>Energy delivered (MWh)</td><td className="n num">{fmt(f.baseline.delivered)}</td><td className="n num">{fmt(f.prev.delivered)}</td><td className="n num">{chg(f.baseline.delivered, f.prev.delivered)}</td></tr>
                <tr><td>Declared demand (avg MW)</td><td className="n num">{fmt(f.baseline.declaredMw, 1)}</td><td className="n num">{fmt(f.prev.declaredMw, 1)}</td><td className="n num">{chg(f.baseline.declaredMw, f.prev.declaredMw)}</td></tr>
                <tr><td>Delivered (avg MW)</td><td className="n num">{fmt(f.baseline.deliveredMw, 1)}</td><td className="n num">{fmt(f.prev.deliveredMw, 1)}</td><td className="n num">{chg(f.baseline.deliveredMw, f.prev.deliveredMw)}</td></tr>
              </tbody></table></div>
            {f.prev.months < span.months.length && <p className="legend">Only {f.prev.months} of the {span.months.length} comparison months have feeder returns.</p>}
          </div>
        )}
        <div className="card"><h3>Monthly baseline, {period.slice(0, 4)}{span.kind !== "year" ? " · months in the baseline in bold" : ""}</h3>
          <div className="scroll"><table className="compact"><thead><tr><th>Month</th><th className="n">Nominated (MWh)</th><th className="n">Delivered (MWh)</th><th className="n">Gross feeder sum (MWh)</th><th className="n">Declared (avg MW)</th><th className="n">Delivered (avg MW)</th><th className="n">Fulfilment</th><th className="n">Avg h/day</th></tr></thead>
            <tbody>{f.monthly.map((m) => <tr key={m.period} style={m.inBaseline ? { fontWeight: 600 } : undefined}><td>{periodLabel(m.period)}</td><td className="n num">{fmt(m.nominated)}</td><td className="n num">{fmt(m.delivered)}</td><td className="n num">{fmt(m.grossDelivered)}</td><td className="n num">{fmt(m.declaredMw, 1)}</td><td className="n num">{fmt(m.deliveredMw, 1)}</td><td className="n num">{pct(m.fulfilment, 0)}</td><td className="n num">{fmt(m.avgHours, 2)}</td></tr>)}</tbody></table></div>
          <p className="legend">{a.removeDoubleCount ? `De-duplicated for 33/11 kV double counting: ${fmt(f.doubleCount.corrected)} MWh against a gross feeder sum of ${fmt(f.doubleCount.gross)} MWh over the baseline (factor ${fmt(f.doubleCount.factor, 4)}).` : "Gross feeder sums (double counting not removed)."} Average MW = energy ÷ hours; peak demand needs feeder peak-load returns. Coverage is the {scope ? `${scope.code} feeders` : "licensees whose feeder returns are filed"}.</p>
        </div>
      </>)}
    </section>
  );
}
