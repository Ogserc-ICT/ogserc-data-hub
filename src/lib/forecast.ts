import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { technical } from "./metrics";
import { daysIn, monthsBetween } from "./periods";
import { getSettings } from "./settings-db";

/**
 * Load forecast baseline (OGSERC Load Forecast Baseline workbook): declared demand is the energy licensees
 * nominated, delivered is the energy their feeders supplied, both as average MW over the baseline months,
 * then grown at the Low / Base / High rates to the policy horizon.
 *
 * The baseline is `opts.months` (a month, quarter or year ending at `period`); by default the months of the
 * year to `period`. `opts.prevMonths` is the span it is compared with. The monthly series always runs from
 * January to `period`.
 */
export async function loadForecast(period: string, licensee?: string | null, opts: { months?: string[]; prevMonths?: string[] } = {}) {
  const s = await getSettings();
  const f = s.forecast;
  const ytd = monthsBetween(`${period.slice(0, 4)}-01`, period);
  const span = opts.months?.length ? opts.months : ytd;
  const prevSpan = opts.prevMonths ?? [];
  const wanted = [...new Set([...ytd, ...span, ...prevSpan])].sort();
  const have = await db.selectDistinct({ p: schema.feederMonthly.period }).from(schema.feederMonthly)
    .where(and(inArray(schema.feederMonthly.period, wanted), licensee ? eq(schema.feederMonthly.licenseeId, licensee) : undefined));
  const used = wanted.filter((m) => have.some((h) => h.p === m));
  const stats = await Promise.all(used.map(async (m) => {
    const [t, gross] = await Promise.all([
      technical(m, { licensee, trendMonths: 1 }),
      db.select().from(schema.feederMonthly).where(and(eq(schema.feederMonthly.period, m), licensee ? eq(schema.feederMonthly.licenseeId, licensee) : undefined)),
    ]);
    const grossDel = gross.reduce((a, r) => a + (r.deliveredMwh ?? 0), 0), grossNom = gross.reduce((a, r) => a + (r.nominatedMwh ?? 0), 0);
    const hours = daysIn(m) * 24;
    const nom = f.removeDoubleCount ? t.total.nominated : grossNom, del = f.removeDoubleCount ? t.total.delivered : grossDel;
    return { period: m, hours, nominated: nom, delivered: del, grossNominated: grossNom, grossDelivered: grossDel, declaredMw: nom / hours, deliveredMw: del / hours, fulfilment: nom ? del / nom : null, avgHours: t.total.avgHours, interruptions: t.total.interruptions, inBaseline: span.includes(m) };
  }));
  const of = (ms: string[]) => stats.filter((x) => ms.includes(x.period));
  const baseline = (rows: typeof stats) => {
    const H = rows.reduce((a, x) => a + x.hours, 0);
    const nominated = rows.reduce((a, x) => a + x.nominated, 0), delivered = rows.reduce((a, x) => a + x.delivered, 0);
    return { months: rows.length, nominated, delivered, declaredMw: H ? nominated / H : null, deliveredMw: H ? delivered / H : null };
  };
  const base = baseline(of(span)), prev = prevSpan.length ? baseline(of(prevSpan)) : null;
  const monthly = of(ytd);
  const declared = base.declaredMw, delivered = base.deliveredMw;
  const years: number[] = []; for (let y = f.startYear; y <= f.endYear; y++) years.push(y);
  const proj = (rate: number) => years.map((y) => (declared ?? 0) * Math.pow(1 + rate, y - f.startYear));
  const inBase = of(span);
  const grossDel = inBase.reduce((a, x) => a + x.grossDelivered, 0), netDel = inBase.reduce((a, x) => a + x.delivered, 0);
  return {
    months: monthly.map((x) => x.period), monthly, baselineMonths: inBase.map((x) => x.period), baseline: base, prev: prev?.months ? prev : null,
    declaredMw: declared, deliveredMw: delivered, unservedShare: declared && delivered != null ? 1 - delivered / declared : null,
    annualDeclaredGwh: declared != null ? (declared * 8760) / 1000 : null, annualDeliveredGwh: delivered != null ? (delivered * 8760) / 1000 : null,
    doubleCount: { gross: grossDel, corrected: netDel, factor: grossDel ? netDel / grossDel : null },
    years, scenarios: { low: proj(f.low), base: proj(f.base), high: proj(f.high) }, assumptions: f,
  };
}
