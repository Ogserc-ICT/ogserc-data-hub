import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { addMonths, daysIn } from "./periods";
import { getSettings } from "./settings-db";

export const OPEN_REFERRAL = (status: string) => !/remedied|downgraded|closed/i.test(status);

/**
 * Service-based tariff band monitoring, as in the OGSERC Feeder Register and SBT Monitoring workbook:
 * monthly status against the band floor, consecutive breach runs, referral candidates and data-quality flags.
 */
export async function sbtMonitor(period: string, licensee?: string | null) {
  const s = await getSettings();
  const year = period.slice(0, 4);
  const months: string[] = [];
  for (let m = `${year}-01`; m <= period; m = addMonths(m, 1)) months.push(m);
  const runFrom = addMonths(period, -23);
  const [feeders, hubs, rows, refs] = await Promise.all([
    db.select().from(schema.feeders).where(licensee ? eq(schema.feeders.licenseeId, licensee) : undefined).orderBy(asc(schema.feeders.code), asc(schema.feeders.name)),
    db.select().from(schema.hubs),
    db.select().from(schema.feederMonthly).where(and(inArray(schema.feederMonthly.period, monthsFrom(runFrom, period)), lte(schema.feederMonthly.period, period), licensee ? eq(schema.feederMonthly.licenseeId, licensee) : undefined)),
    db.select().from(schema.referrals).where(licensee ? eq(schema.referrals.licenseeId, licensee) : undefined),
  ]);
  const by = new Map<string, Map<string, (typeof rows)[number]>>();
  for (const r of rows) { if (!by.has(r.feederId)) by.set(r.feederId, new Map()); by.get(r.feederId)!.set(r.period, r); }
  const floorOf = (band: string) => (s.bandHours[band] ?? 0) * (1 - s.sbtTolerance);

  const list = feeders.filter((f) => by.has(f.id)).map((f) => {
    const m = by.get(f.id)!;
    const cur = m.get(period);
    const band = cur?.band || f.band || "";
    const floor = floorOf(band);
    const status = (p: string): "Met" | "Breach" | "No data" => { const r = m.get(p); if (!r || r.hoursPerDay == null) return "No data"; return r.hoursPerDay >= floorOf(r.band || band) ? "Met" : "Breach"; };
    let run = 0; for (let p = period; status(p) === "Breach" && run < 24; p = addMonths(p, -1)) run++;
    const ytdHours = months.map((p) => m.get(p)?.hoursPerDay).filter((x): x is number => x != null);
    const series = months.map((p) => m.get(p)?.hoursPerDay ?? null);
    // data quality, as in the SBT workbook: missing months, zero-hour months, straight-line (interpolated) runs
    const missing = months.filter((p) => m.get(p)?.hoursPerDay == null).length;
    const zero = series.filter((x) => x === 0).length;
    let straight = 0;
    for (let i = 2; i < series.length; i++) {
      const [a, b, c] = [series[i - 2], series[i - 1], series[i]];
      if (a != null && b != null && c != null && Math.abs(b - a) > 1e-9 && Math.abs((b - a) - (c - b)) < 1e-6) straight++;
    }
    const dq = zero ? "Zero hours — confirm outage or data" : straight ? "Possible interpolation" : missing ? "Months missing" : "OK";
    const open = refs.filter((r) => r.feederId === f.id && OPEN_REFERRAL(r.status));
    // technical checks
    const dr = cur?.nominatedMwh ? (cur.deliveredMwh ?? 0) / cur.nominatedMwh : null;
    const avgDur = typeof cur?.ext?.avgInterruptionHours === "number" ? (cur.ext.avgInterruptionHours as number) : null;
    const implied = cur?.interruptions != null && avgDur != null ? 24 - (cur.interruptions * avgDur) / daysIn(period) : null;
    const techFlag = dr != null && dr < s.deliveryRatioMin ? "Delivered below nomination" : dr != null && dr > s.deliveryRatioMax ? "Delivered above nomination — check meter" :
      implied != null && cur?.hoursPerDay != null && Math.abs(cur.hoursPerDay - implied) > s.hoursMismatchTolerance ? "Hours disagree with interruptions" : null;
    return {
      id: f.id, code: f.code, name: f.name, licenseeId: f.licenseeId, hub: hubs.find((h) => h.id === f.hubId)?.name ?? "", band, floor, hours: cur?.hoursPerDay ?? null,
      shortfall: cur?.hoursPerDay != null ? Math.max(0, floor - cur.hoursPerDay) : null, status: status(period), run,
      ytdAvg: ytdHours.length ? ytdHours.reduce((a, b) => a + b, 0) / ytdHours.length : null,
      monthsMet: months.filter((p) => status(p) === "Met").length, monthsBreached: months.filter((p) => status(p) === "Breach").length,
      statuses: months.map((p) => status(p)), candidate: run >= s.sbtConsecutive && !open.length, openReferral: open[0]?.ref ?? null, dq, missing, zero, straight,
      deliveryRatio: dr, techFlag,
    };
  });
  return {
    period, months, list, consecutive: s.sbtConsecutive, tolerance: s.sbtTolerance,
    totals: {
      monitored: list.length, reported: list.filter((x) => x.status !== "No data").length, met: list.filter((x) => x.status === "Met").length,
      breaches: list.filter((x) => x.status === "Breach").length, candidates: list.filter((x) => x.candidate).length,
      openReferrals: refs.filter((r) => OPEN_REFERRAL(r.status)).length, dqFlags: list.filter((x) => x.dq !== "OK").length, techFlags: list.filter((x) => x.techFlag).length,
    },
    referrals: refs.map((r) => { const f = feeders.find((x) => x.id === r.feederId); return f ? { ...r, feederName: f.name, hub: hubs.find((h) => h.id === f.hubId)?.name ?? r.hub } : r; }).sort((a, b) => b.ref.localeCompare(a.ref)),
  };
}

function monthsFrom(a: string, b: string) { const out: string[] = []; for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m); return out; }

/** Next referral number in the Performance Monitoring series, e.g. OGSERC/PM/SBT/2026/072. */
export async function nextReferralRef(year: string) {
  const refs = await db.select({ ref: schema.referrals.ref }).from(schema.referrals);
  const n = Math.max(0, ...refs.map((r) => Number(r.ref.match(new RegExp(`/SBT/${year}/(\\d+)$`))?.[1] ?? 0)));
  return (k: number) => `OGSERC/PM/SBT/${year}/${String(n + k).padStart(3, "0")}`;
}
