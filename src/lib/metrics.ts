import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Feeder } from "@/db/schema";
import { BANDS, COMMISSION_INDICATORS, COMPLAINT_CATEGORIES, DATASETS, type DatasetCode } from "./datasets";
import { addMonths, daysIn, monthsBetween, window } from "./periods";
import { COMMISSION_FILER } from "./ingest/commit";
import { getSettings } from "./settings-db";
import type { Issue } from "@/db/schema";

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
export const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b : null);
const mean = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length ? sum(v) / v.length : null; };
const extN = (e: Record<string, unknown> | null | undefined, k: string) => (e && typeof e[k] === "number" ? (e[k] as number) : null);
const yearStart = (p: string) => `${p.slice(0, 4)}-01`;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/**
 * Months a figure covers. `months` is the reporting span (one month, a quarter or a year, ending at `period`);
 * `prevMonths` is the span it is compared with. Both default to the single month and the month before.
 */
export type SpanOpts = { months?: string[]; prevMonths?: string[] };
const spanOf = (period: string, o: SpanOpts) => {
  const span = o.months?.length ? o.months : [period];
  return { span, prevSpan: o.prevMonths?.length ? o.prevMonths : span.map((m) => addMonths(m, -span.length)) };
};

export type FilingStatus = "missing" | "received" | "flagged" | "accepted" | "queried" | "not-required";

/** Status of every licensee × monthly return for one month. */
export async function complianceGrid(period: string, onlyLicensee?: string | null) {
  const lics = await db.select().from(schema.licensees).where(onlyLicensee ? eq(schema.licensees.id, onlyLicensee) : eq(schema.licensees.active, true)).orderBy(asc(schema.licensees.sortOrder));
  const fs = await db.select({ f: schema.filings, s: schema.submissions }).from(schema.filings)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.filings.submissionId)).where(eq(schema.filings.period, period));
  const used = [...new Set(lics.flatMap((l) => l.obligations))];
  const datasets = (["FEEDER", "COMMERCIAL", "METERING", "COMPLAINTS", "GENUNIT", "GENPLANT"] as DatasetCode[]).filter((d) => used.includes(d));
  const grid = lics.map((l) => ({
    licensee: l,
    cells: datasets.map((d) => {
      if (!l.obligations.includes(d)) return { dataset: d, status: "not-required" as FilingStatus, submissionId: null as string | null, warnings: 0 };
      const hit = fs.find((x) => x.f.licenseeId === l.id && x.f.dataset === d);
      if (!hit) return { dataset: d, status: "missing" as FilingStatus, submissionId: null, warnings: 0 };
      const warnings = hit.s.issues.filter((i) => i.level === "warning" && (!i.period || i.period === period)).length;
      const status: FilingStatus = hit.s.status === "accepted" ? "accepted" : hit.s.status === "queried" ? "queried" : warnings ? "flagged" : "received";
      return { dataset: d, status, submissionId: hit.s.id, warnings };
    }),
  }));
  const cells = grid.flatMap((g) => g.cells).filter((c) => c.status !== "not-required");
  const count = (s: FilingStatus) => cells.filter((c) => c.status === s).length;
  return { grid, datasets, totals: { due: cells.length, received: cells.length - count("missing"), accepted: count("accepted"), flagged: count("flagged") + count("queried"), missing: count("missing") } };
}

// ----------------------------------------------------------------- technical

type FM = typeof schema.feederMonthly.$inferSelect;

/**
 * Energy counted once (EMPR method): each injection point contributes the higher of its own meter and the
 * sum of the feeders drawn through it; fed feeders add nothing of their own. A subset (a unit, a band) gets
 * the groups whose injection point lies in it. Without parent links, 33 kV feeders are the injection points.
 * `scope` is the subset; `all` is every row for the same licensee and month.
 */
function groupTotals(scope: FM[], all: FM[], fmap: Map<string, Feeder>, field: "deliveredMwh" | "nominatedMwh"): number {
  const byFeeder = new Map(all.map((r) => [r.feederId, r]));
  const kids = new Map<string, string[]>();
  for (const f of fmap.values()) if (f.parentId && fmap.has(f.parentId) && f.licenseeId === all[0]?.licenseeId) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id]);
  const group = (id: string, depth = 0): number => {
    const own = byFeeder.get(id)?.[field] ?? 0;
    const below = depth < 4 ? sum((kids.get(id) ?? []).map((k) => group(k, depth + 1))) : 0;
    return Math.max(own, below);
  };
  if (!kids.size) return sum(scope.filter((r) => fmap.get(r.feederId)?.voltage !== "11kV").map((r) => r[field]));
  return sum(scope.filter((r) => { const f = fmap.get(r.feederId); return f && !(f.parentId && fmap.has(f.parentId)); }).map((r) => group(r.feederId)));
}

/**
 * One row per feeder across the span: average hours a day over the months reported, energy and interruptions summed.
 * For a single month this is the month's own rows.
 */
function perFeeder(rs: FM[]): FM[] {
  const by = new Map<string, FM[]>();
  for (const r of rs) by.set(r.feederId, [...(by.get(r.feederId) ?? []), r]);
  return [...by.values()].map((g) => {
    if (g.length === 1) return g[0];
    const last = g.reduce((a, b) => (b.period > a.period ? b : a));
    const anyOf = (k: "deliveredMwh" | "nominatedMwh" | "interruptions") => (g.some((r) => r[k] != null) ? sum(g.map((r) => r[k])) : null);
    return { ...last, hoursPerDay: mean(g.map((r) => r.hoursPerDay)), deliveredMwh: anyOf("deliveredMwh"), nominatedMwh: anyOf("nominatedMwh"), interruptions: anyOf("interruptions") };
  });
}

export async function technical(period: string, opts: { licensee?: string | null; trendMonths?: number } & SpanOpts = {}) {
  const s = await getSettings();
  const { span, prevSpan } = spanOf(period, opts);
  const months = window(period, opts.trendMonths ?? Math.max(7, span.length));
  const ytd = monthsBetween(yearStart(period), period);
  const all = uniq([...months, ...ytd, ...span, ...prevSpan]);
  const lw = opts.licensee ? eq(schema.feederMonthly.licenseeId, opts.licensee) : undefined;
  const [rows, feeders, hubs] = await Promise.all([
    db.select().from(schema.feederMonthly).where(and(inArray(schema.feederMonthly.period, all), lw)),
    db.select().from(schema.feeders).where(opts.licensee ? eq(schema.feeders.licenseeId, opts.licensee) : undefined),
    db.select().from(schema.hubs),
  ]);
  const fmap = new Map(feeders.map((f) => [f.id, f]));
  const hubName = (id: string | null | undefined) => hubs.find((h) => h.id === id)?.name ?? "Unassigned";
  const thr = s.bandThreshold;
  const reported = (r: FM) => r.hoursPerDay != null;
  const meets = (r: FM) => (r.hoursPerDay ?? 0) >= thr * r.bandHours;

  const allOf = new Map<string, FM[]>();
  for (const r of rows) { const k = `${r.period}|${r.licenseeId}`; allOf.set(k, [...(allOf.get(k) ?? []), r]); }
  const energy = (rs: FM[], field: "deliveredMwh" | "nominatedMwh") => {
    const keys = [...new Set(rs.map((r) => `${r.period}|${r.licenseeId}`))];
    return sum(keys.map((k) => groupTotals(rs.filter((r) => `${r.period}|${r.licenseeId}` === k), allOf.get(k) ?? [], fmap, field)));
  };
  const summarise = (rs: FM[]) => {
    const withH = rs.filter(reported);
    const delivered = energy(rs, "deliveredMwh");
    const nominated = energy(rs, "nominatedMwh");
    const custConn = sum(rs.map((r) => extN(r.ext, "customersConnected")));
    const custInt = rs.some((r) => extN(r.ext, "customerInterruptions") != null) ? sum(rs.map((r) => extN(r.ext, "customerInterruptions"))) : null;
    const custH = rs.some((r) => extN(r.ext, "customerHours") != null) ? sum(rs.map((r) => extN(r.ext, "customerHours"))) : null;
    const faultTrips = rs.some((r) => extN(r.ext, "faultTrips") != null) ? sum(rs.map((r) => extN(r.ext, "faultTrips"))) : null;
    return {
      feeders: uniq(rs.map((r) => r.feederId)).length, reporting: uniq(withH.map((r) => r.feederId)).length, returned: rs.filter((r) => r.deliveredMwh != null).length, avgHours: mean(withH.map((r) => r.hoursPerDay)), meeting: withH.filter(meets).length,
      compliance: ratio(withH.filter(meets).length, withH.length), delivered, nominated, unserved: Math.max(0, nominated - delivered), fulfilment: ratio(delivered, nominated),
      interruptions: sum(rs.map((r) => r.interruptions)), interruptionsPerFeeder: ratio(sum(rs.map((r) => r.interruptions)), rs.length),
      faultTrips, saifi: custInt != null && custConn ? custInt / custConn : null, saidi: custH != null && custConn ? custH / custConn : null,
      coreComplete: ratio(sum(rs.map((r) => [r.nominatedMwh, r.deliveredMwh, r.hoursPerDay, r.interruptions].filter((x) => x != null).length)), rs.length * 4),
      extendedReported: rs.filter((r) => ["peakLoadMw", "maxKv", "customersConnected", "outageHours"].some((k) => extN(r.ext, k) != null)).length,
    };
  };
  const cur = rows.filter((r) => span.includes(r.period));
  const curF = perFeeder(cur);
  const byBand = BANDS.map((b) => ({ band: b, threshold: s.bandHours[b], ...summarise(cur.filter((r) => r.band === b)) })).filter((x) => x.feeders);
  const hubIds = [...new Set(cur.map((r) => fmap.get(r.feederId)?.hubId ?? null))];
  const byHub = hubIds.map((h) => ({ hubId: h, hub: hubName(h), ...summarise(cur.filter((r) => (fmap.get(r.feederId)?.hubId ?? null) === h)) })).sort((a, b) => b.delivered - a.delivered);
  const bySegment = ["MD", "NMD", "Mixed", null].map((sg) => ({ segment: sg ?? "Not classified", ...summarise(cur.filter((r) => (fmap.get(r.feederId)?.segment ?? null) === sg)) })).filter((x) => x.feeders);
  const byLicensee = [...new Set(cur.map((r) => r.licenseeId))].map((l) => ({ licenseeId: l, ...summarise(cur.filter((r) => r.licenseeId === l)) }));
  const trend = months.map((m) => ({ period: m, ...summarise(rows.filter((r) => r.period === m)) }));
  const ytdSum = summarise(rows.filter((r) => ytd.includes(r.period)));

  const worst = curF.filter(reported)
    .map((r) => { const f = fmap.get(r.feederId); return { feeder: f?.name ?? r.feederId, code: f?.code, licenseeId: r.licenseeId, hub: hubName(f?.hubId), band: r.band, owed: r.bandHours, hours: r.hoursPerDay ?? 0, gap: (r.hoursPerDay ?? 0) - r.bandHours, interruptions: r.interruptions ?? 0 }; })
    .filter((x) => x.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 10);

  // Hours withheld between an injection point and the feeders drawn through it.
  const groups = new Map<string, FM[]>();
  for (const r of curF) { const p = fmap.get(r.feederId)?.parentId; if (p) groups.set(p, [...(groups.get(p) ?? []), r]); }
  const rationing = [...groups.entries()].map(([pid, kids]) => {
    const parent = curF.find((r) => r.feederId === pid);
    const downstream = mean(kids.map((k) => k.hoursPerDay));
    return { injection: fmap.get(pid)?.name ?? pid, hub: hubName(fmap.get(pid)?.hubId), injectionHours: parent?.hoursPerDay ?? null, downstreamHours: downstream, withheld: parent?.hoursPerDay != null && downstream != null ? parent.hoursPerDay - downstream : null, children: kids.length };
  }).filter((g) => g.injectionHours != null).sort((a, b) => (b.withheld ?? 0) - (a.withheld ?? 0));
  // Injection meters reading below the feeders they supply (metering integrity).
  const meterBelow = [...groups.entries()].filter(([pid, kids]) => { const p = curF.find((r) => r.feederId === pid); return p?.deliveredMwh != null && sum(kids.map((k) => k.deliveredMwh)) > p.deliveredMwh * 1.02; }).length;

  return {
    period, months, span, total: summarise(cur), prev: summarise(rows.filter((r) => prevSpan.includes(r.period))), ytd: ytdSum, ytdMonths: ytd,
    byBand, byHub, bySegment, byLicensee, trend, worst, rationing, meterBelow, hasData: cur.length > 0, daysInMonth: daysIn(period),
    registered: feeders.length, expected: feeders.filter((f) => f.status !== "Decommissioned").length,
    unconfirmedClass: feeders.filter((f) => /inferred/i.test(f.classificationBasis ?? "") || !f.segment).length,
  };
}

// ----------------------------------------------------------------- commercial and metering

type CM = typeof schema.commercialMonthly.$inferSelect;

export function summariseCommercial(rs: CM[]) {
  const received = sum(rs.map((r) => r.energyReceivedKwh));
  const receivedNgn = sum(rs.map((r) => r.energyReceivedNgn));
  const billedKwh = sum(rs.flatMap((r) => [r.billedKwhMeteredMd, r.billedKwhMeteredNmd, r.billedKwhUnmeteredMd, r.billedKwhUnmeteredNmd]));
  const billedMetered = sum(rs.flatMap((r) => [r.billedKwhMeteredMd, r.billedKwhMeteredNmd]));
  const billedNgn = sum(rs.flatMap((r) => [r.billedNgnMd, r.billedNgnNmd]));
  const collected = sum(rs.flatMap((r) => [r.collectedNgnMd, r.collectedNgnNmd]));
  const arrearsRows = rs.filter((r) => r.arrearsNgn != null);
  const collectedMd = sum(rs.map((r) => r.collectedNgnMd)), billedMd = sum(rs.map((r) => r.billedNgnMd));
  // Customer numbers are a stock, not a flow: over several months take each unit's latest return.
  const lastOf = new Map<string, string>();
  for (const r of rs) if ((lastOf.get(r.hubId) ?? "") < r.period) lastOf.set(r.hubId, r.period);
  const latest = rs.filter((r) => lastOf.get(r.hubId) === r.period);
  const custMetered = sum(latest.flatMap((r) => [r.custMeteredMd, r.custMeteredNmd]));
  const custUnmetered = sum(latest.flatMap((r) => [r.custUnmeteredMd, r.custUnmeteredNmd]));
  const md = sum(latest.flatMap((r) => [r.custMeteredMd, r.custUnmeteredMd])), mdMetered = sum(latest.map((r) => r.custMeteredMd));
  const kwhPerMeteredNmd = ratio(sum(rs.map((r) => r.billedKwhMeteredNmd)), sum(rs.map((r) => r.custMeteredNmd)));
  const kwhPerUnmeteredNmd = ratio(sum(rs.map((r) => r.billedKwhUnmeteredNmd)), sum(rs.map((r) => r.custUnmeteredNmd)));
  const be = ratio(billedKwh, received), beNgn = ratio(billedNgn, receivedNgn), ce = ratio(collected, billedNgn);
  const cmpRec = rs.some((r) => extN(r.ext, "complaintsReceived") != null) ? sum(rs.map((r) => extN(r.ext, "complaintsReceived"))) : null;
  const cmpRes = rs.some((r) => extN(r.ext, "complaintsResolved") != null) ? sum(rs.map((r) => extN(r.ext, "complaintsResolved"))) : null;
  return {
    receivedMwh: received / 1000, receivedKwh: received, billedMwh: billedKwh / 1000, billedNgn, collected, receivedNgn,
    be, beNgn, ce, atcc: be != null && ce != null ? 1 - be * ce : null, atccNgn: beNgn != null && ce != null ? 1 - beNgn * ce : null,
    ceCurrent: arrearsRows.length ? ratio(collected - sum(arrearsRows.map((r) => r.arrearsNgn)), billedNgn) : null,
    ceMd: ratio(collectedMd, billedMd), ceNmd: ratio(collected - collectedMd, billedNgn - billedMd),
    customers: custMetered + custUnmetered, metered: custMetered, unmetered: custUnmetered, meteringRate: ratio(custMetered, custMetered + custUnmetered),
    mdCustomers: md, mdMeteringRate: ratio(mdMetered, md), unmeteredShareOfBilled: ratio(billedKwh - billedMetered, billedKwh),
    kwhPerMeteredNmd, kwhPerUnmeteredNmd, estimationRatio: ratio(kwhPerUnmeteredNmd, kwhPerMeteredNmd),
    tariffYield: ratio(billedNgn, billedKwh), revenueYield: ratio(collected, received),
    newMeters: rs.some((r) => extN(r.ext, "newMeters") != null) ? sum(rs.map((r) => extN(r.ext, "newMeters"))) : null,
    complaintsReceived: cmpRec, complaintsResolved: cmpRes, complaintResolution: ratio(cmpRes, cmpRec),
  };
}

export async function commercial(period: string, opts: { licensee?: string | null; trendMonths?: number } & SpanOpts = {}) {
  const { span, prevSpan } = spanOf(period, opts);
  const months = window(period, opts.trendMonths ?? Math.max(7, span.length));
  const ytd = monthsBetween(yearStart(period), period);
  const all = uniq([...months, ...ytd, ...span, ...prevSpan]);
  const L = opts.licensee;
  const [rows, hubs, caps, met, tech] = await Promise.all([
    db.select().from(schema.commercialMonthly).where(and(inArray(schema.commercialMonthly.period, all), L ? eq(schema.commercialMonthly.licenseeId, L) : undefined)),
    db.select().from(schema.hubs),
    db.select().from(schema.energyCaps).where(and(inArray(schema.energyCaps.period, uniq([...months, ...span])), L ? eq(schema.energyCaps.licenseeId, L) : undefined)),
    db.select().from(schema.meteringMonthly).where(and(inArray(schema.meteringMonthly.period, uniq([...months, ...span])), L ? eq(schema.meteringMonthly.licenseeId, L) : undefined)),
    technical(period, { licensee: L, trendMonths: opts.trendMonths, months: span, prevMonths: prevSpan }),
  ]);
  const hubName = (id: string | null) => hubs.find((h) => h.id === id)?.name ?? "Unassigned";
  const cur = rows.filter((r) => span.includes(r.period));
  const capCur = caps.filter((c) => span.includes(c.period));
  const feederMetered = new Map(tech.byHub.map((h) => [h.hubId, h.delivered]));
  const byHub = [...new Set(cur.map((r) => r.hubId))].map((h) => {
    const s = summariseCommercial(cur.filter((r) => r.hubId === h));
    const hubCaps = capCur.filter((c) => c.hubId === h);
    const avgCap = mean(hubCaps.map((c) => c.capKwh));
    const fm = feederMetered.get(h);
    return { hubId: h, hub: hubName(h), ...s, avgCap, capFeeders: hubCaps.length, billedVsCap: s.kwhPerUnmeteredNmd != null && avgCap ? s.kwhPerUnmeteredNmd / avgCap : null, feederMeteredMwh: fm ?? null, receivedVsMetered: fm ? s.receivedMwh / fm : null };
  }).sort((a, b) => b.receivedMwh - a.receivedMwh);
  const byLicensee = [...new Set(cur.map((r) => r.licenseeId))].map((l) => ({ licenseeId: l, ...summariseCommercial(cur.filter((r) => r.licenseeId === l)) }));
  const trend = months.map((m) => ({ period: m, ...summariseCommercial(rows.filter((r) => r.period === m)) }));
  const total = summariseCommercial(cur);
  const metCur = met.filter((m) => span.includes(m.period));
  return {
    period, months, span, total, prev: summariseCommercial(rows.filter((r) => prevSpan.includes(r.period))), ytd: summariseCommercial(rows.filter((r) => ytd.includes(r.period))),
    byHub, byLicensee, trend, hasData: cur.length > 0,
    reconciliation: { feederDeliveredMwh: tech.total.delivered, receivedMwh: total.receivedMwh, ratio: tech.total.delivered ? total.receivedMwh / tech.total.delivered : null },
    caps: {
      feeders: capCur.length, avgCap: mean(capCur.map((c) => c.capKwh)),
      byBand: BANDS.map((b) => ({ band: b, feeders: capCur.filter((c) => c.band === b).length, avgCap: mean(capCur.filter((c) => c.band === b).map((c) => c.capKwh)) })).filter((x) => x.feeders),
      trend: months.map((m) => ({ period: m, feeders: caps.filter((c) => c.period === m).length, avgCap: mean(caps.filter((c) => c.period === m).map((c) => c.capKwh)) })),
    },
    installs: metCur.length ? {
      map: sum(metCur.map((m) => m.installedMap)), maf: sum(metCur.map((m) => m.installedMaf)), vendor: sum(metCur.map((m) => m.installedVendor)), disco: sum(metCur.map((m) => m.installedDisco)),
      replaced: sum(metCur.map((m) => m.replaced)), faulty: sum(metCur.map((m) => m.faultyReported)), pending: sum(metCur.map((m) => m.pendingApplications)),
    } : null,
    installTrend: months.map((m) => ({ period: m, installed: sum(met.filter((x) => x.period === m).flatMap((x) => [x.installedMap, x.installedMaf, x.installedVendor, x.installedDisco])) || sum(rows.filter((r) => r.period === m).map((r) => extN(r.ext, "newMeters"))) })),
    tech,
  };
}

// ----------------------------------------------------------------- complaints

export async function complaints(period: string, opts: { licensee?: string | null } & SpanOpts = {}) {
  const { span } = spanOf(period, opts);
  const months = window(period, Math.max(7, span.length));
  const L = opts.licensee;
  const [rows, lics, cust] = await Promise.all([
    db.select().from(schema.complaintsMonthly).where(and(inArray(schema.complaintsMonthly.period, months), L ? eq(schema.complaintsMonthly.licenseeId, L) : undefined)),
    db.select().from(schema.licensees),
    db.select().from(schema.commercialMonthly).where(and(eq(schema.commercialMonthly.period, period), L ? eq(schema.commercialMonthly.licenseeId, L) : undefined)),
  ]);
  const cur = rows.filter((r) => span.includes(r.period));
  const received = sum(cur.map((r) => r.received)), resolved = sum(cur.map((r) => r.resolved));
  const inTimeRows = cur.filter((r) => r.resolvedInTime != null);
  const customers = sum(cust.flatMap((c) => [c.custMeteredMd, c.custMeteredNmd, c.custUnmeteredMd, c.custUnmeteredNmd]));
  return {
    period, hasData: cur.length > 0,
    total: { received, resolved, resolution: ratio(resolved, received), inTime: inTimeRows.length ? ratio(sum(inTimeRows.map((r) => r.resolvedInTime)), sum(inTimeRows.map((r) => r.resolved))) : null, escalated: sum(cur.map((r) => r.escalated)), per10k: customers ? (received / customers) * 10000 : null },
    byCategory: COMPLAINT_CATEGORIES.map((c) => ({ category: c, received: sum(cur.filter((r) => r.category === c).map((r) => r.received)), resolved: sum(cur.filter((r) => r.category === c).map((r) => r.resolved)) })).filter((x) => x.received),
    byLicensee: [...new Set(cur.map((r) => r.licenseeId))].map((l) => {
      const rs = cur.filter((r) => r.licenseeId === l);
      const rec = sum(rs.map((r) => r.received)), res = sum(rs.map((r) => r.resolved));
      return { licensee: lics.find((x) => x.id === l)?.shortName || lics.find((x) => x.id === l)?.name || l, received: rec, resolved: res, resolution: ratio(res, rec), escalated: sum(rs.map((r) => r.escalated)) };
    }),
    trend: months.map((m) => ({ period: m, received: sum(rows.filter((r) => r.period === m).map((r) => r.received)), resolved: sum(rows.filter((r) => r.period === m).map((r) => r.resolved)) })),
  };
}

// ----------------------------------------------------------------- Commission and data quality

/** Indicators that are a month-end position (not a count of activity), so a quarter or year takes the latest value. */
const COMMISSION_STOCKS = new Set(["lic_pending", "staff_in_post", "vacancies"]);

export async function commission(period: string, months: string[] = [period]) {
  const rows = await db.select().from(schema.commissionMonthly).where(inArray(schema.commissionMonthly.period, months));
  return COMMISSION_INDICATORS.map((ind) => {
    const rs = rows.filter((x) => x.indicator === ind.key).sort((a, b) => a.period.localeCompare(b.period));
    const withV = rs.filter((r) => r.value != null);
    const value = !withV.length ? null : COMMISSION_STOCKS.has(ind.key) ? withV.at(-1)!.value : sum(withV.map((r) => r.value));
    return { ...ind, value, note: rs.map((r) => r.note).filter(Boolean).join(" ") };
  });
}

export async function dataQuality(period: string, licensee?: string | null, months: string[] = [period]) {
  const fs = await db.select({ f: schema.filings, s: schema.submissions }).from(schema.filings)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.filings.submissionId))
    .where(and(inArray(schema.filings.period, [...months, "register"]), licensee ? eq(schema.filings.licenseeId, licensee) : undefined));
  const lics = await db.select().from(schema.licensees);
  const items: { licensee: string; dataset: DatasetCode; issue: Issue }[] = [];
  const seen = new Set<string>(); // a submission covering several months is filed once per month; count its issues once
  for (const { f, s } of fs) if (!seen.has(s.id) && seen.add(s.id)) for (const i of s.issues) if (i.level === "warning" && (!i.period || months.includes(i.period)))
    items.push({ licensee: f.licenseeId === COMMISSION_FILER ? "OGSERC" : lics.find((l) => l.id === f.licenseeId)?.code || f.licenseeId, dataset: f.dataset, issue: i });
  const byKind = new Map<string, number>();
  for (const it of items) { const k = `${DATASETS[it.dataset].short}: ${it.issue.message.replace(/\(.*?\)|[\d.,]+ MWh/g, "").replace(/\s+/g, " ").replace(/\s+([.,;])/g, "$1").trim()}`; byKind.set(k, (byKind.get(k) ?? 0) + 1); }
  const validated = fs.filter((x) => months.includes(x.f.period) && x.s.status === "accepted").length;
  return { count: items.length, items, byKind: [...byKind.entries()].map(([k, n]) => ({ kind: k, n })).sort((a, b) => b.n - a.n), examples: fs.some((x) => x.s.isExample), validatedReturns: validated, returns: fs.filter((x) => months.includes(x.f.period)).length };
}
