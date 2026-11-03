import { requireCommission } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { loadForecast } from "@/lib/forecast";
import { LineChart, fmt, pct } from "@/lib/ui";

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireCommission();
  const period = await resolvePeriod(await searchParams);
  const f = await loadForecast(period);
  const a = f.assumptions;
  return (
    <section className="view">
      <div>
        <h2>Load forecast baseline</h2>
        <p className="sub">Declared demand is the energy distribution licensees nominated; delivered is what their feeders supplied, both as average MW over the months of {period.slice(0, 4)} filed so far. Growth scenarios run to {a.endYear}, the horizon of the Ogun State Electricity Policy 2026–2036. Assumptions are on the Admin page.</p>
      </div>
      {f.declaredMw == null ? <div className="empty">No feeder returns for {period.slice(0, 4)} yet.</div> : (<>
        <div className="strip">
          <div><span className="k">Declared demand</span><span className="v">{fmt(f.declaredMw, 1)} <small>avg MW</small></span></div>
          <div><span className="k">Delivered</span><span className="v">{fmt(f.deliveredMw, 1)} <small>avg MW</small></span></div>
          <div><span className="k">Unserved share</span><span className="v">{pct(f.unservedShare, 1)}</span></div>
          <div><span className="k">Annualised demand</span><span className="v">{fmt(f.annualDeclaredGwh, 0)} <small>GWh</small></span></div>
          <div><span className="k">Base case {a.endYear}</span><span className="v">{fmt(f.scenarios.base.at(-1), 0)} <small>avg MW</small></span></div>
        </div>
        <div className="panels">
          <div className="card"><h3>Declared and delivered by month</h3><LineChart months={f.months} format={(v) => fmt(v, 0)} series={[{ name: "Declared (avg MW)", values: f.monthly.map((m) => m.declaredMw), tone: "s1" }, { name: "Delivered (avg MW)", values: f.monthly.map((m) => m.deliveredMw), tone: "s2" }]} /></div>
          <div className="card"><h3>Scenarios to {a.endYear}</h3>
            <table className="compact"><thead><tr><th>Year</th><th className="n">Low {pct(a.low, 0)} (MW)</th><th className="n">Base {pct(a.base, 0)} (MW)</th><th className="n">High {pct(a.high, 0)} (MW)</th><th className="n">Base (GWh)</th></tr></thead>
              <tbody>{f.years.map((y, i) => <tr key={y}><td>{y}</td><td className="n num">{fmt(f.scenarios.low[i], 1)}</td><td className="n num">{fmt(f.scenarios.base[i], 1)}</td><td className="n num">{fmt(f.scenarios.high[i], 1)}</td><td className="n num">{fmt((f.scenarios.base[i] * 8760) / 1000, 0)}</td></tr>)}</tbody></table>
          </div>
        </div>
        <div className="card"><h3>Monthly baseline</h3>
          <div className="scroll"><table className="compact"><thead><tr><th>Month</th><th className="n">Nominated (MWh)</th><th className="n">Delivered (MWh)</th><th className="n">Gross feeder sum (MWh)</th><th className="n">Declared (avg MW)</th><th className="n">Delivered (avg MW)</th><th className="n">Fulfilment</th><th className="n">Avg h/day</th></tr></thead>
            <tbody>{f.monthly.map((m) => <tr key={m.period}><td>{m.period}</td><td className="n num">{fmt(m.nominated)}</td><td className="n num">{fmt(m.delivered)}</td><td className="n num">{fmt(m.grossDelivered)}</td><td className="n num">{fmt(m.declaredMw, 1)}</td><td className="n num">{fmt(m.deliveredMw, 1)}</td><td className="n num">{pct(m.fulfilment, 0)}</td><td className="n num">{fmt(m.avgHours, 2)}</td></tr>)}</tbody></table></div>
          <p className="legend">{a.removeDoubleCount ? `De-duplicated for 33/11 kV double counting: ${fmt(f.doubleCount.corrected)} MWh against a gross feeder sum of ${fmt(f.doubleCount.gross)} MWh (factor ${fmt(f.doubleCount.factor, 4)}).` : "Gross feeder sums (double counting not removed)."} Average MW = energy ÷ hours; peak demand needs feeder peak-load returns. Coverage is the licensees whose feeder returns are filed.</p>
        </div>
      </>)}
    </section>
  );
}
