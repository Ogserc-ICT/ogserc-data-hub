import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { technical } from "./metrics";
import { addMonths, daysIn } from "./periods";
import { getSettings } from "./settings-db";

/**
 * Load forecast baseline (OGSERC Load Forecast Baseline workbook): declared demand is the energy licensees
 * nominated, delivered is the energy their feeders supplied, both as average MW over the months of the year
 * reported so far, then grown at the Low / Base / High rates to the policy horizon.
 */
export async function loadForecast(period: string, licensee?: string | null) {
  const s = await getSettings();
  const f = s.forecast;
  const months: string[] = [];
  for (let m = `${period.slice(0, 4)}-01`; m <= period; m = addMonths(m, 1)) months.push(m);
  const have = await db.selectDistinct({ p: schema.feederMonthly.period }).from(schema.feederMonthly)
    .where(and(inArray(schema.feederMonthly.period, months), licensee ? eq(schema.feederMonthly.licenseeId, licensee) : undefined));
  const used = months.filter((m) => have.some((h) => h.p === m));
  const monthly = [];
  for (const m of used) {
    const t = await technical(m, { licensee, trendMonths: 1 });
    const gross = await db.select().from(schema.feederMonthly).where(and(eq(schema.feederMonthly.period, m), licensee ? eq(schema.feederMonthly.licenseeId, licensee) : undefined));
    const grossDel = gross.reduce((a, r) => a + (r.deliveredMwh ?? 0), 0), grossNom = gross.reduce((a, r) => a + (r.nominatedMwh ?? 0), 0);
    const hours = daysIn(m) * 24;
    const nom = f.removeDoubleCount ? t.total.nominated : grossNom, del = f.removeDoubleCount ? t.total.delivered : grossDel;
    monthly.push({ period: m, hours, nominated: nom, delivered: del, grossNominated: grossNom, grossDelivered: grossDel, declaredMw: nom / hours, deliveredMw: del / hours, fulfilment: nom ? del / nom : null, avgHours: t.total.avgHours, interruptions: t.total.interruptions });
  }
  const H = monthly.reduce((a, x) => a + x.hours, 0);
  const declared = H ? monthly.reduce((a, x) => a + x.nominated, 0) / H : null;
  const delivered = H ? monthly.reduce((a, x) => a + x.delivered, 0) / H : null;
  const years: number[] = []; for (let y = f.startYear; y <= f.endYear; y++) years.push(y);
  const proj = (rate: number) => years.map((y) => (declared ?? 0) * Math.pow(1 + rate, y - f.startYear));
  const grossDel = monthly.reduce((a, x) => a + x.grossDelivered, 0), netDel = monthly.reduce((a, x) => a + x.delivered, 0);
  return {
    months: used, monthly, declaredMw: declared, deliveredMw: delivered, unservedShare: declared && delivered != null ? 1 - delivered / declared : null,
    annualDeclaredGwh: declared != null ? (declared * 8760) / 1000 : null, annualDeliveredGwh: delivered != null ? (delivered * 8760) / 1000 : null,
    doubleCount: { gross: grossDel, corrected: netDel, factor: grossDel ? netDel / grossDel : null },
    years, scenarios: { low: proj(f.low), base: proj(f.base), high: proj(f.high) }, assumptions: f,
  };
}
