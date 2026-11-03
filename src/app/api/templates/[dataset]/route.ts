import ExcelJS from "exceljs";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth";
import { BANDS, COMPLAINT_CATEGORIES, DATASETS, type DatasetCode, REFERRAL_STATUSES, SEGMENTS, TARIFF_CLASSES, isDataset } from "@/lib/datasets";
import { defaultPeriod, isPeriod, periodLabel } from "@/lib/periods";

export const dynamic = "force-dynamic";

/**
 * Pre-filled return workbooks. "ALL" gives the Licensee Monthly Return datasheet (Cover, Feeder List,
 * Feeder Return, Commercial Return …) or the GenCo Monthly Return for a generation licensee.
 */
export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { dataset } = await params;
  const url = new URL(req.url);
  const q = url.searchParams.get("period");
  const period = isPeriod(q) ? q : defaultPeriod();
  const licId = user.isCommission ? url.searchParams.get("licensee") ?? "" : user.lic ?? "";
  const lic = licId ? await db.query.licensees.findFirst({ where: eq(schema.licensees.id, licId) }) : null;

  let codes: DatasetCode[];
  if (dataset === "ALL") codes = lic ? (["REGISTER", ...lic.obligations.filter((d) => d !== "REGISTER")] as DatasetCode[]).filter((d) => !(d === "REGISTER" && lic.obligations.every((o) => o.startsWith("GEN")))) : [];
  else if (isDataset(dataset)) codes = [dataset];
  else return new Response("Unknown dataset", { status: 404 });
  if (!user.isCommission) codes = codes.filter((c) => DATASETS[c].filer === "licensee");
  if (!codes.length) return new Response("No template for this request.", { status: 404 });

  const [hubs, feeders, units, plants, assets, refs, evals] = await Promise.all([
    lic ? db.select().from(schema.hubs).where(eq(schema.hubs.licenseeId, lic.id)) : [],
    lic ? db.select().from(schema.feeders).where(eq(schema.feeders.licenseeId, lic.id)) : [],
    lic ? db.selectDistinct({ plantCode: schema.genUnitMonthly.plantCode, unitCode: schema.genUnitMonthly.unitCode, installedMw: schema.genUnitMonthly.installedMw }).from(schema.genUnitMonthly).where(eq(schema.genUnitMonthly.licenseeId, lic.id)) : [],
    lic ? db.select().from(schema.generationAssets).where(eq(schema.generationAssets.licenseeId, lic.id)) : [],
    db.select().from(schema.generationAssets).orderBy(desc(schema.generationAssets.capacityMw)),
    db.select().from(schema.referrals),
    db.select().from(schema.planEvaluations),
  ]);
  const hubName = (id: string | null) => hubs.find((h) => h.id === id)?.name ?? "";
  const byName = new Map(feeders.map((f) => [f.id, f.name]));
  const sorted = [...feeders].sort((a, b) => (a.code ?? "zz").localeCompare(b.code ?? "zz") || a.name.localeCompare(b.name));
  const plantCodes = (p: (typeof plants)[number]) => p.aliases.filter((a) => a.startsWith(`${(lic?.code ?? "").toUpperCase()}:`)).map((a) => a.split(":")[1]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "OGSERC Data Hub";
  const isGen = !!lic && lic.obligations.some((o) => o.startsWith("GEN")) && !lic.obligations.includes("FEEDER");
  const ref = `RET-${lic?.code || "LIC"}-${period}`;

  if (dataset === "ALL" || codes.some((c) => DATASETS[c].periodic)) {
    const cover = wb.addWorksheet("Cover");
    cover.getColumn(1).width = 34; cover.getColumn(2).width = 48;
    const lines: [string, string | number][] = [
      [isGen ? "OGSERC GenCo Monthly Return" : "OGSERC Licensee Monthly Return", ""],
      ["Licensee code", lic?.code ?? ""], ["Licensee name", lic?.name ?? ""], ["Reporting month", period], ["Reporting year", Number(period.slice(0, 4))],
      ["Submission ref.", ref], ["Prepared by", ""], ["Designation", ""], ["Date submitted", ""], ["", ""],
      ["How to complete", ""],
      ["1", "Keep the sheet names and column headings exactly as they are. Rows are pre-filled from your last return and the OGSERC register."],
      ["2", "Enter numbers without units or thousands separators. Enter 0 where nothing occurred; leave a cell blank only where the figure is not available."],
      ["3", isGen ? "Unit Return: one row per generating unit. Plant Return: one row per plant." : "Feeder List: confirm or correct each feeder's unit, level, parent, band, segment and tariff class; add new feeders. Feeder Return: one row per feeder."],
      ["4", "Upload the workbook in the OGSERC Data Hub under Submit data, or file it through the API. The Hub checks every row before you confirm."],
      ["5", `Returns for ${periodLabel(period)} are due by the 15th of the following month. Resubmitting the same month replaces the earlier return; every version is kept.`],
    ];
    lines.forEach(([a, b], i) => { cover.getCell(i + 1, 1).value = a; cover.getCell(i + 1, 2).value = b; });
    cover.getCell(1, 1).font = { bold: true, size: 14 };
    for (const r of [2, 4, 5, 6, 7, 8, 9]) cover.getCell(r, 2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4C2" } };
    cover.getCell(11, 1).font = { bold: true };
  }

  for (const code of codes) {
    const def = DATASETS[code];
    const cols = def.columns.filter((c) => !(c.key === "licenseeCode") && !(code === "FEEDER" && ["voltage", "hub", "parent"].includes(c.key)));
    const ws = wb.addWorksheet(def.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.addRow(cols.map((c) => c.header));
    cols.forEach((c, i) => {
      const cell = ws.getCell(1, i + 1);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? "FFDCE6F4" : c.core ? "FFE6EFE9" : "FFEFF2F1" } };
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.note = [c.unit ? `Unit: ${c.unit}` : "", c.required ? "Required" : c.core ? "Core field" : "Optional", c.help ?? ""].filter(Boolean).join("\n");
      ws.getColumn(i + 1).width = Math.max(12, Math.min(30, c.header.length + 2));
    });
    ws.getRow(1).height = 44;
    const P = { period };
    const prefill: Record<string, unknown>[] =
      code === "REGISTER" ? sorted.map((f) => ({ feederCode: f.code, feeder: f.name, hub: hubName(f.hubId), voltage: f.voltage.replace("kV", ""), level: f.level, parent: f.parentId ? byName.get(f.parentId) : null, band: f.band, segment: f.segment, tariffClass: f.tariffClass, classificationBasis: f.classificationBasis, status: f.status, ...f.attrs }))
      : code === "FEEDER" ? sorted.filter((f) => f.status !== "Decommissioned").map((f) => ({ ...P, feederCode: f.code, feeder: f.name, band: f.band, reference: ref, dataSource: "Licensee monthly return" }))
      : code === "COMMERCIAL" ? hubs.map((h) => ({ ...P, hub: h.name, reference: ref, dataSource: "Licensee monthly return" }))
      : code === "METERING" ? hubs.map((h) => ({ ...P, hub: h.name }))
      : code === "COMPLAINTS" ? COMPLAINT_CATEGORIES.map((c) => ({ ...P, category: c }))
      : code === "GENUNIT" ? units.map((u) => ({ ...P, plantCode: u.plantCode, unitCode: u.unitCode, installedMw: u.installedMw, reference: ref }))
      : code === "GENPLANT" ? plants.flatMap((p) => plantCodes(p).map((c) => ({ ...P, plantCode: c, reference: ref })))
      : code === "GENREG" ? assets.map((a) => ({ code: a.code, name: a.name, owner: a.owner, permitStatus: a.permitStatus, category: a.category, technology: a.technology, fuel: a.fuel, capacityMw: a.capacityMw, availableMw: a.availableMw, lga: a.lga, location: a.location, status: a.status, planStatus: a.planStatus, nextPlanDue: a.nextPlanDue, ...a.attrs }))
      : code === "REFERRALS" ? refs.map((r) => ({ ref: r.ref, referredOn: r.referredOn, feeder: r.feederName, band: r.band, floorHours: r.floorHours, hub: r.hub, monthsBreached: r.monthsBreached, avgHours: r.avgHours, shortfall: r.shortfall, dataQualityFlag: r.dataQualityFlag, referredBy: r.referredBy, status: r.status, caseNo: r.caseNo, closedOn: r.closedOn, notes: r.notes }))
      : code === "PLANEVAL" ? evals.map((e) => ({ id: e.id, plantName: e.plantName, planType: e.planType, receivedOn: e.receivedOn, decidedOn: e.decidedOn, ...e.gates, ...e.scores, leadEvaluator: e.leadEvaluator, conditions: e.conditions }))
      : [];
    for (const r of prefill) ws.addRow(cols.map((c) => (r[c.key] ?? null) as ExcelJS.CellValue));
    const last = Math.max(prefill.length + 1, 300);
    const colOf = (k: string) => cols.findIndex((c) => c.key === k) + 1;
    const list = (k: string, values: readonly string[]) => { const ci = colOf(k); if (ci < 1) return; for (let r = 2; r <= last; r++) ws.getCell(r, ci).dataValidation = { type: "list", allowBlank: true, formulae: [`"${values.join(",")}"`] }; };
    list("band", BANDS); list("segment", SEGMENTS); list("tariffClass", TARIFF_CLASSES); list("level", ["Injection", "Fed"]);
    if (code === "COMPLAINTS") list("category", COMPLAINT_CATEGORIES);
    if (code === "REFERRALS") list("status", REFERRAL_STATUSES);
    if (code === "PLANEVAL") { for (const g of ["G1", "G2", "G3", "G4", "G5"]) list(g, ["Yes", "No"]); list("planType", ["Capacity recovery", "Expansion"]); }
    cols.forEach((c, i) => { if (c.type === "number" || c.type === "int") ws.getColumn(i + 1).numFmt = c.type === "int" ? "#,##0" : "#,##0.00"; });
  }

  const buf = await wb.xlsx.writeBuffer();
  const what = dataset === "ALL" ? (isGen ? "GenCo-Monthly-Return" : "Licensee-Monthly-Return") : DATASETS[dataset as DatasetCode].sheet.replace(/\s+/g, "-");
  const name = `OGSERC-${what}-${lic?.code || "template"}-${period}.xlsx`;
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
