/**
 * Sets up the Hub with the Commission's licensee master list and business units (EMPR workbook Settings).
 *   npm run seed                              licensees, business units, first administrator
 *   npm run seed -- --import a.xlsx b.xlsm    files workbooks in the order given (any layout the Hub reads)
 *   npm run seed -- --examples                example complaints and Commission activity (marked as examples)
 * Safe to run more than once.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { COMMISSION_INDICATORS, COMPLAINT_CATEGORIES, DATASETS, looseKey } from "../src/lib/datasets";
import { parseWorkbook } from "../src/lib/ingest/parsers";
import { commit, feederIndex, resolveLicensee, stage } from "../src/lib/ingest/commit";

// Licensee master list — OGSERC EMPR market and generation analytics workbooks (Settings).
const LICENSEES: (typeof schema.licensees.$inferInsert)[] = [
  { id: "ibedc", code: "IBEDC", name: "Ibadan Electricity Distribution Plc", shortName: "IBEDC", area: "Ogun Region business hubs", type: "Successor DisCo", licenceStatus: "SubCo licence pending", obligations: ["REGISTER", "FEEDER", "COMMERCIAL", "METERING", "COMPLAINTS"], sortOrder: 1 },
  { id: "ie", code: "IE", name: "Ikeja Electric Plc", shortName: "Ikeja Electric", area: "Ogun-side network of Ikeja Electric", type: "Successor DisCo", licenceStatus: "Licensed", obligations: ["REGISTER", "FEEDER", "COMMERCIAL", "METERING", "COMPLAINTS"], sortOrder: 2 },
  { id: "ekedp", code: "EKEDP", name: "Eko Electricity Distribution Plc", shortName: "EKEDC", area: "Ogun-side network of Eko DisCo", type: "Successor DisCo", licenceStatus: "Licensed", obligations: ["REGISTER", "FEEDER", "COMMERCIAL", "METERING", "COMPLAINTS"], sortOrder: 3 },
  { id: "gpdn", code: "GPDN", name: "Green Power Distribution Nigeria Ltd", shortName: "Green Power", area: "Independent network serving industrial customers, Sagamu Interchange", type: "IEDN", licenceStatus: "Licence to be confirmed", obligations: ["REGISTER", "FEEDER", "COMMERCIAL", "COMPLAINTS"], sortOrder: 4 },
  { id: "ccetc", code: "CCETC", name: "CCETC Taihu", shortName: "CCETC Taihu", area: "Embedded network, Sagamu Interchange", type: "IEDN / embedded network", licenceStatus: "Licence to be confirmed", obligations: ["REGISTER", "FEEDER", "COMMERCIAL", "COMPLAINTS"], sortOrder: 5 },
  { id: "opp", code: "OPP", name: "Olorunsogo Power Plc (Olorunsogo I)", shortName: "Olorunsogo I", area: "Papalanto, Ewekoro LGA", type: "NERC-licensed (monitored)", licenceStatus: "NERC licence (monitored)", obligations: ["GENUNIT", "GENPLANT"], sortOrder: 10 },
  { id: "ndphc", code: "NDPHC", name: "Niger Delta Power Holding Company (Olorunsogo II NIPP)", shortName: "Olorunsogo II", area: "Papalanto, Ewekoro LGA", type: "NERC-licensed (monitored)", licenceStatus: "NERC licence (monitored)", obligations: ["GENUNIT", "GENPLANT"], sortOrder: 11 },
];

// Business units and the names licensees use for them in returns (EMPR Settings ▸ Business units).
const HUBS: [string, string, string[]][] = [
  ["ibedc", "Ijebu", ["IJEBU-ODE", "IJEBU ODE", "IJEBU"]], ["ibedc", "Ijeun", ["IJEUN"]], ["ibedc", "Mowe", ["MOWE-IBAFO", "MOWEIBAFO", "MOWE IBAFO"]],
  ["ibedc", "Olumo", ["OLUMO"]], ["ibedc", "Ota", ["OTA"]], ["ibedc", "Sagamu", ["SAGAMU"]], ["ibedc", "Sango", ["SANGO"]],
];

// Feeder names in IBEDC's own files that OGSERC's register spells differently (confirm with IBEDC).
const IBEDC_ALIASES: [string, string][] = [
  ["LAFENWA 11KV FEEDER", "Lafenwa 11 kV Feeder X 5"],
  ["TOWER 11KV FEEDER", "Tower 11 kV Feeder Latched To Town 11 kV Feeder"],
  ["EGAN 11KV FEEDER", "Egan Road 11 kV Feeder"],
];

async function fileWorkbook(path: string, adminId: string | null) {
  const lics = await db.select().from(schema.licensees);
  const buf = readFileSync(path);
  const parsed = await parseWorkbook(buf, { yearHint: 2026 });
  if ("error" in parsed) { console.log(`${basename(path)}: ${parsed.error}`); return; }
  const order = (d: string) => (d === "REGISTER" || d === "GENREG" ? 0 : 1);
  for (const b of [...parsed.batches].sort((x, y) => order(x.dataset) - order(y.dataset))) {
    const groups = new Map<string, typeof b.rows>();
    if (["GENREG", "PLANEVAL", "FORECAST", "REFERRALS"].includes(b.dataset)) groups.set("", b.rows);
    else for (const r of b.rows) { const l = r.licenseeCode ? resolveLicensee(r.licenseeCode, lics) : lics.find((x) => x.id === "ibedc"); const k = l?.id ?? "?"; groups.set(k, [...(groups.get(k) ?? []), r]); }
    for (const [licId, rows] of groups) {
      if (licId === "?") { console.log(`  ${b.dataset}: licensee not recognised, skipped`); continue; }
      const id = await stage({ dataset: b.dataset, licenseeId: licId || null, format: parsed.format, channel: "upload", rows, parseIssues: b.issues, fileName: basename(path), file: buf, userId: null, userName: "Initial data load", partial: b.partial, reference: b.reference });
      const s = (await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) }))!;
      const errs = s.issues.filter((i) => i.level === "error");
      if (errs.length) { console.log(`${basename(path)} → ${DATASETS[b.dataset].short}${licId ? ` (${licId})` : ""}: ${errs.length} errors, not filed. First: ${errs[0].ref ?? ""} ${errs[0].message}`); continue; }
      const r = await commit(id);
      console.log(`${basename(path)} → ${DATASETS[b.dataset].short}${licId ? ` (${licId})` : ""} [${parsed.format}]: ${r.rows} rows; ${r.periods.length > 3 ? `${r.periods[0]}…${r.periods.at(-1)}` : r.periods.join(", ")}; ${s.issues.length} warnings`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  for (const l of LICENSEES) await db.insert(schema.licensees).values(l).onConflictDoUpdate({ target: schema.licensees.id, set: { code: l.code, name: l.name, shortName: l.shortName, type: l.type } });
  for (const [lic, name, aliases] of HUBS) await db.insert(schema.hubs).values({ id: `${lic}:${looseKey(name)}`, licenseeId: lic, name, aliases }).onConflictDoNothing();
  console.log(`Licensees: ${LICENSEES.length}; business units: ${HUBS.length}.`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const pw = process.env.SEED_ADMIN_PASSWORD;
  let adminId: string | null = null;
  if (email && pw) {
    if (pw.length < 10) throw new Error("SEED_ADMIN_PASSWORD must be at least 10 characters.");
    const exists = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
    adminId = exists?.id ?? (await db.insert(schema.users).values({ email, name: process.env.SEED_ADMIN_NAME || "OGSERC Administrator", role: "admin", passwordHash: await bcrypt.hash(pw, 12), mustChangePassword: true }).returning())[0].id;
    console.log(`Administrator: ${email}`);
  }

  const at = args.indexOf("--import");
  if (at >= 0) {
    for (const f of args.slice(at + 1).filter((a) => !a.startsWith("--"))) {
      if (f === "=aliases") { // apply the name mapping once IBEDC's own files are in
        const idx = await feederIndex("ibedc");
        for (const [from, to] of IBEDC_ALIASES) { const fd = idx.find({ feeder: from }); if (fd && !fd.aliases.includes(to)) await db.update(schema.feeders).set({ aliases: [...fd.aliases, to] }).where(eq(schema.feeders.id, fd.id)); }
        console.log("IBEDC feeder name mapping applied.");
        continue;
      }
      await fileWorkbook(f, adminId);
    }
  }

  if (args.includes("--examples")) {
    const periods = (await db.selectDistinct({ p: schema.commercialMonthly.period }).from(schema.commercialMonthly).where(eq(schema.commercialMonthly.licenseeId, "ibedc"))).map((x) => x.p).sort();
    if (periods.length) {
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const J = (x: number, s = 0.15) => Math.round(x * (1 + (rnd() * 2 - 1) * s));
      const share: Record<string, number> = { Billing: 0.34, Metering: 0.18, "Supply interruption": 0.2, "Voltage quality": 0.07, Disconnection: 0.08, "New connection": 0.05, "Customer service": 0.04, Other: 0.04 };
      const rows = periods.flatMap((p) => COMPLAINT_CATEGORIES.map((c) => { const rec = J(2600 * share[c]); const res = Math.min(rec, J(rec * 0.82, 0.08)); return { period: p, category: c, received: rec, resolved: res, resolvedInTime: J(res * 0.74, 0.08), escalated: J(rec * 0.03, 0.5) }; }));
      const id = await stage({ dataset: "COMPLAINTS", licenseeId: "ibedc", format: "Example data", channel: "form", rows, parseIssues: [], userId: null, userName: "Example data" });
      await db.update(schema.submissions).set({ isExample: true }).where(eq(schema.submissions.id, id));
      await commit(id);
      const last = periods.at(-1)!;
      const act: Record<string, number> = { lic_applications: 6, lic_issued: 1, permits_issued: 3, lic_pending: 9, inspections: 14, notices: 4, band_reclass: 0, sanctions_ngn: 0, ccu_received: 37, ccu_resolved: 29, hearings: 3, instruments: 1, consultations: 2, staff_in_post: 42, vacancies: 18 };
      for (const ind of COMMISSION_INDICATORS) await db.insert(schema.commissionMonthly).values({ period: last, indicator: ind.key, value: act[ind.key] ?? null, note: "Example figure" })
        .onConflictDoUpdate({ target: [schema.commissionMonthly.period, schema.commissionMonthly.indicator], set: { value: act[ind.key] ?? null, note: "Example figure" } });
      console.log(`Example complaints (${periods.length} months) and Commission activity for ${last}.`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
