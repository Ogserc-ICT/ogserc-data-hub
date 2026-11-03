import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { DATASETS } from "./datasets";
import { periodLabel, window } from "./periods";
import { commercial, technical } from "./metrics";

export type Cell = string | number | Date | null;
export type Sheet = { name: string; rows: Cell[][]; widths: number[]; pctCols: number[]; headerRow: number };

/** Data sheets for the in-app viewer and the .xlsx download, in the Commission workbooks' column layout. Licensee users get their own data only. */
export async function buildSheets(user: CurrentUser, period: string, months = 12): Promise<Sheet[]> {
  const ps = window(period, months);
  const own = user.isCommission ? null : user.lic ?? "__none__";
  const [lics, hubs, feeders, fm, cm, mm, cpm, gu, gp, caps, assets, refs] = await Promise.all([
    db.select().from(schema.licensees),
    db.select().from(schema.hubs),
    db.select().from(schema.feeders).where(own ? eq(schema.feeders.licenseeId, own) : undefined).orderBy(asc(schema.feeders.licenseeId), asc(schema.feeders.code)),
    db.select().from(schema.feederMonthly).where(and(inArray(schema.feederMonthly.period, ps), own ? eq(schema.feederMonthly.licenseeId, own) : undefined)).orderBy(asc(schema.feederMonthly.period)),
    db.select().from(schema.commercialMonthly).where(and(inArray(schema.commercialMonthly.period, ps), own ? eq(schema.commercialMonthly.licenseeId, own) : undefined)).orderBy(asc(schema.commercialMonthly.period)),
    db.select().from(schema.meteringMonthly).where(and(inArray(schema.meteringMonthly.period, ps), own ? eq(schema.meteringMonthly.licenseeId, own) : undefined)).orderBy(asc(schema.meteringMonthly.period)),
    db.select().from(schema.complaintsMonthly).where(and(inArray(schema.complaintsMonthly.period, ps), own ? eq(schema.complaintsMonthly.licenseeId, own) : undefined)).orderBy(asc(schema.complaintsMonthly.period)),
    db.select().from(schema.genUnitMonthly).where(and(inArray(schema.genUnitMonthly.period, ps), own ? eq(schema.genUnitMonthly.licenseeId, own) : undefined)),
    db.select().from(schema.genPlantMonthly).where(and(inArray(schema.genPlantMonthly.period, ps), own ? eq(schema.genPlantMonthly.licenseeId, own) : undefined)),
    db.select().from(schema.energyCaps).where(and(inArray(schema.energyCaps.period, ps), own ? eq(schema.energyCaps.licenseeId, own) : undefined)).orderBy(asc(schema.energyCaps.period)),
    user.isCommission ? db.select().from(schema.generationAssets).orderBy(asc(schema.generationAssets.code)) : Promise.resolve([]),
    db.select().from(schema.referrals).where(own ? eq(schema.referrals.licenseeId, own) : undefined),
  ]);
  const L = (id: string) => lics.find((l) => l.id === id)?.code || id;
  const H = (id: string | null) => hubs.find((h) => h.id === id)?.name ?? "";
  const F = new Map(feeders.map((f) => [f.id, f]));
  const sheets: Sheet[] = [];

  if (user.isCommission) {
    const [t, c] = await Promise.all([technical(period, { trendMonths: Math.min(months, 12) }), commercial(period, { trendMonths: Math.min(months, 12) })]);
    const rows: Cell[][] = [["OGSERC Data Hub: Ogun electricity market indicators"], ["Month to", periodLabel(period)], [], ["Month", "Feeders", "Avg h/day", "Band compliance", "Supplied MWh (de-duplicated)", "Nominated MWh", "Fulfilment", "Interruptions", "Energy received MWh", "Energy billed MWh", "BE (kWh)", "BE (₦)", "Billed ₦", "Collected ₦", "CE", "ATC&C (kWh)", "ATC&C (₦)", "Customers", "Metering rate", "Estimation ratio", "Received ÷ feeder-metered"]];
    t.trend.forEach((x, i) => { const y = c.trend[i]; rows.push([periodLabel(x.period, "short"), x.feeders || null, x.avgHours, x.compliance, x.delivered || null, x.nominated || null, x.fulfilment, x.interruptions || null, y.receivedMwh || null, y.billedMwh || null, y.be, y.beNgn, y.billedNgn || null, y.collected || null, y.ce, y.atcc, y.atccNgn, y.customers || null, y.meteringRate, y.estimationRatio, x.delivered && y.receivedMwh ? y.receivedMwh / x.delivered : null]); });
    sheets.push({ name: "Indicators", rows, widths: [12, 9, 10, 12, 16, 14, 10, 12, 14, 14, 9, 9, 16, 16, 9, 10, 10, 12, 10, 10, 12], pctCols: [3, 6, 10, 11, 14, 15, 16, 18], headerRow: 3 });
  }
  const reg = DATASETS.REGISTER.columns.filter((c) => c.key !== "altIds");
  sheets.push({
    name: "Feeder Register", headerRow: 0, pctCols: [], widths: [10, 9, 34, 12, 9, 10, 30, 8, 10, 10, 26],
    rows: [reg.map((c) => c.header).concat("Other IDs and names"), ...feeders.map((f) => reg.map((c) => {
      switch (c.key) {
        case "licenseeCode": return L(f.licenseeId); case "feederCode": return f.code; case "feeder": return f.name; case "hub": return H(f.hubId);
        case "voltage": return f.voltage === "Other" ? null : Number(f.voltage.replace("kV", "")); case "level": return f.level; case "parent": return f.parentId ? F.get(f.parentId)?.name ?? null : null;
        case "band": return f.band; case "segment": return f.segment; case "tariffClass": return f.tariffClass; case "classificationBasis": return f.classificationBasis; case "status": return f.status;
        default: return (f.attrs[c.key] ?? null) as Cell;
      }
    }).concat(f.aliases.join("; ")))],
  });
  const fr = DATASETS.FEEDER.columns.filter((c) => !["voltage", "hub", "parent"].includes(c.key));
  sheets.push({
    name: "Feeder Returns", headerRow: 0, pctCols: [], widths: [9, 9, 9, 34, 8, ...Array(fr.length).fill(12)],
    rows: [fr.map((c) => c.header).concat("Business unit"), ...fm.map((r) => { const f = F.get(r.feederId); return fr.map((c) => {
      switch (c.key) {
        case "licenseeCode": return L(r.licenseeId); case "period": return r.period; case "feederCode": return f?.code ?? null; case "feeder": return f?.name ?? r.feederId; case "band": return r.band;
        case "nominatedMwh": return r.nominatedMwh; case "deliveredMwh": return r.deliveredMwh; case "hoursPerDay": return r.hoursPerDay; case "interruptions": return r.interruptions;
        default: return (r.ext[c.key] ?? null) as Cell;
      }
    }).concat(H(f?.hubId ?? null)); })],
  });
  const cr = DATASETS.COMMERCIAL.columns;
  sheets.push({
    name: "Commercial Returns", headerRow: 0, pctCols: [], widths: [9, 9, 12, ...Array(cr.length).fill(15)],
    rows: [cr.map((c) => c.header), ...cm.map((r) => cr.map((c) => {
      if (c.key === "licenseeCode") return L(r.licenseeId); if (c.key === "hub") return H(r.hubId);
      const v = (r as Record<string, unknown>)[c.key]; if (v !== undefined) return v as Cell;
      return (r.ext[c.key] ?? null) as Cell;
    }))],
  });
  if (mm.length) sheets.push({ name: "Metering", headerRow: 0, pctCols: [], widths: [9, 10, 14, 10, 10, 10, 10, 10, 10, 12],
    rows: [["Licensee", "Month", "Business unit", "MAP", "MAF", "Vendor", "Licensee", "Replaced", "Faulty", "Pending"], ...mm.map((r) => [L(r.licenseeId), r.period, H(r.hubId), r.installedMap, r.installedMaf, r.installedVendor, r.installedDisco, r.replaced, r.faultyReported, r.pendingApplications] as Cell[])] });
  if (cpm.length) sheets.push({ name: "Complaints", headerRow: 0, pctCols: [], widths: [9, 10, 20, 10, 10, 12, 10],
    rows: [["Licensee", "Month", "Category", "Received", "Resolved", "In time", "Escalated"], ...cpm.map((r) => [L(r.licenseeId), r.period, r.category, r.received, r.resolved, r.resolvedInTime, r.escalated] as Cell[])] });
  if (gu.length) { const uc = DATASETS.GENUNIT.columns; sheets.push({ name: "Unit Returns", headerRow: 0, pctCols: [], widths: uc.map(() => 13),
    rows: [uc.map((c) => c.header), ...gu.map((r) => uc.map((c) => c.key === "licenseeCode" ? L(r.licenseeId) : ((r as Record<string, unknown>)[c.key] ?? r.ext[c.key] ?? null) as Cell))] }); }
  if (gp.length) { const pc = DATASETS.GENPLANT.columns; sheets.push({ name: "Plant Returns", headerRow: 0, pctCols: [], widths: pc.map(() => 13),
    rows: [pc.map((c) => c.header), ...gp.map((r) => pc.map((c) => c.key === "licenseeCode" ? L(r.licenseeId) : ((r as Record<string, unknown>)[c.key] ?? r.ext[c.key] ?? null) as Cell))] }); }
  if (caps.length) sheets.push({ name: "Energy caps", headerRow: 0, pctCols: [], widths: [9, 10, 14, 34, 7, 10],
    rows: [["Licensee", "Month", "Business unit", "Feeder", "Band", "Cap kWh"], ...caps.map((r) => [L(r.licenseeId), r.period, H(r.hubId), r.feederName, r.band, r.capKwh] as Cell[])] });
  if (refs.length) sheets.push({ name: "Breach referrals", headerRow: 0, pctCols: [], widths: [26, 12, 9, 34, 6, 8, 10, 8, 10, 10, 24, 18, 24, 14, 12, 30],
    rows: [["Referral no.", "Date referred", "Licensee", "Feeder name", "Band", "Floor (h/day)", "Hub", "Months breached", "Average hours", "Shortfall", "Data quality flag", "Referred by", "Status", "Case no.", "Date closed", "Outcome / notes"],
      ...refs.map((r) => [r.ref, r.referredOn, L(r.licenseeId), r.feederName, r.band, r.floorHours, r.hub, r.monthsBreached, r.avgHours, r.shortfall, r.dataQualityFlag, r.referredBy, r.status, r.caseNo, r.closedOn, r.notes] as Cell[])] });
  if (assets.length) sheets.push({ name: "Generation register", headerRow: 0, pctCols: [], widths: [9, 40, 30, 10, 10, 14, 22, 14, 18, 18, 24],
    rows: [["Plant ID", "Plant name", "Owner / licensee", "Installed MW", "Available MW", "Fuel", "Technology", "Connection", "Status", "Licence status", "Other IDs and names"],
      ...assets.map((a) => [a.code, a.name, a.owner, a.capacityMw, a.availableMw, a.fuel, a.technology, a.category, a.status, a.permitStatus, a.aliases.join("; ")] as Cell[])] });
  return sheets;
}
