import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Feeder, Issue, Licensee } from "@/db/schema";
import {
  COMPLAINT_CATEGORIES, DATASETS, type DatasetCode, looseKey, norm, parseBand, parseVoltage, plantKey, validateRows,
} from "../datasets";
import { isPeriod } from "../periods";
import { getSettings, saveSetting } from "../settings-db";
import type { Row } from "./parsers";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;
export const hubKey = (s: unknown) => looseKey(s);
export const feederId = (lic: string, name: string) => `${lic}:${looseKey(name)}`;
export const COMMISSION_FILER = "ogserc";

// ---------------------------------------------------------------- lookups

/** Finds a licensee from a code or name as written in a workbook ("IBEDC", "IBEDC (Ogun Region)", "Ikeja Electric"). */
export function resolveLicensee(text: unknown, lics: Licensee[]): Licensee | null {
  const t = norm(text).toUpperCase();
  if (!t) return null;
  return lics.find((l) => l.code.toUpperCase() === t || l.id.toUpperCase() === t)
    ?? lics.find((l) => l.code && (t.startsWith(`${l.code.toUpperCase()} `) || t.startsWith(`${l.code.toUpperCase()}(`)))
    ?? lics.find((l) => l.name.toUpperCase() === t || (l.shortName && l.shortName.toUpperCase() === t))
    ?? lics.find((l) => l.code && new RegExp(`\\(${l.code}\\)`, "i").test(t))
    ?? lics.find((l) => t.includes(l.name.toUpperCase()) || l.name.toUpperCase().includes(t)) ?? null;
}

export async function hubResolver(licenseeId: string, q: Q = db) {
  const hubs = await q.select().from(schema.hubs).where(eq(schema.hubs.licenseeId, licenseeId));
  const map = new Map<string, string>();
  for (const h of hubs) for (const a of [h.name, ...h.aliases]) map.set(hubKey(a), h.id);
  return { map, find: (name: unknown) => map.get(hubKey(name)) ?? null };
}

/** Feeder lookup by Feeder ID, other IDs and names, and name. */
export async function feederIndex(licenseeId: string, q: Q = db) {
  const list = await q.select().from(schema.feeders).where(eq(schema.feeders.licenseeId, licenseeId));
  const byCode = new Map<string, Feeder>(), byKey = new Map<string, Feeder>();
  for (const f of list) {
    if (f.code) byCode.set(f.code.toUpperCase(), f);
    byKey.set(looseKey(f.name), f);
    for (const a of f.aliases) { byCode.set(a.toUpperCase(), f); byKey.set(looseKey(a), f); }
  }
  return {
    list,
    find(r: Record<string, unknown>): Feeder | null {
      for (const id of [r.feederCode, r.altId]) if (id && byCode.has(norm(id).toUpperCase())) return byCode.get(norm(id).toUpperCase())!;
      if (r.feeder && byKey.has(looseKey(r.feeder))) return byKey.get(looseKey(r.feeder))!;
      return null;
    },
  };
}

/** Cleans parsed rows into each dataset's canonical shape. */
export function normaliseRows(code: DatasetCode, rows: Row[]): Row[] {
  return rows.map((r) => {
    const o: Row = { ...r };
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    if (code === "FEEDER" || code === "REGISTER") {
      if (o.band) { const b = parseBand(o.band); if (b) o.band = b.band; }
      if (o.voltage || o.feeder) { const v = parseVoltage(o.voltage, String(o.feeder ?? "")); if (v !== "Other" || o.voltage) o.voltage = v; }
      if (o.feeder) o.feeder = norm(o.feeder);
      if (o.level) o.level = /^inj/i.test(String(o.level)) ? "Injection" : /^fed/i.test(String(o.level)) ? "Fed" : norm(o.level);
    }
    if (code === "COMPLAINTS") {
      const c = COMPLAINT_CATEGORIES.find((x) => x.toLowerCase() === norm(o.category).toLowerCase());
      o.category = c ?? norm(o.category);
    }
    if (code === "CAPS" && o.band) o.band = parseBand(o.band)?.band ?? norm(o.band);
    if (code === "PLANEVAL" && o.planType) o.planType = /exp/i.test(String(o.planType)) ? "Expansion" : "Capacity recovery";
    return o;
  });
}

// ---------------------------------------------------------------- staging

/** Validates a parsed batch and stores it as a staged submission. Nothing reaches the data tables yet. */
export async function stage(args: {
  dataset: DatasetCode; licenseeId: string | null; format: string; channel: "upload" | "api" | "form";
  rows: Row[]; parseIssues: Issue[]; fileName?: string; file?: Buffer; userId: string | null; userName: string;
  /** Groups the submissions staged from one uploaded workbook. */
  uploadId?: string;
  periodsAllowed?: string[]; partial?: boolean; reference?: string;
  /** Feeder List rows staged in the same upload; their feeders count as registered. */
  pendingRegister?: Row[];
}) {
  const def = DATASETS[args.dataset];
  const rows = normaliseRows(args.dataset, args.rows);
  const issues: Issue[] = [...args.parseIssues, ...validateRows(args.dataset, rows).filter((i) => !(args.partial && i.message.startsWith("Core fields not reported")))];
  const periods = def.periodic ? [...new Set(rows.map((r) => r.period).filter(isPeriod))].sort() : ["register"];
  if (def.periodic) {
    const bad = rows.filter((r) => !isPeriod(r.period)).length;
    if (bad) issues.push({ level: "error", message: `${bad} row(s) have no valid month. Use 2026-07, Jul-2026, or the month name with the year on the Cover.` });
    if (args.periodsAllowed) {
      const outside = periods.filter((p) => !args.periodsAllowed!.includes(p));
      if (outside.length) issues.push({ level: "error", message: `Months outside the reporting window: ${outside.join(", ")}.` });
    }
  }
  if (!rows.length) issues.push({ level: "error", message: "The file contains no data rows." });
  if (args.licenseeId && ["FEEDER", "REGISTER", "COMMERCIAL", "METERING", "CAPS"].includes(args.dataset)) {
    const { find } = await hubResolver(args.licenseeId);
    const unknown = [...new Set(rows.map((r) => norm(r.hub)).filter((h) => h && !find(h)))];
    for (const h of unknown) issues.push({ level: "warning", ref: h, message: `Business unit "${h}" is not in Settings; it will be added.` });
  }
  if (args.licenseeId && (args.dataset === "FEEDER" || args.dataset === "CAPS")) {
    const idx = await feederIndex(args.licenseeId);
    const pendCodes = new Set((args.pendingRegister ?? []).map((p) => String(p.feederCode ?? "").toUpperCase()).filter(Boolean));
    const pendNames = new Set((args.pendingRegister ?? []).map((p) => looseKey(p.feeder)));
    const pending = (r: Row) => (r.feederCode && pendCodes.has(String(r.feederCode).toUpperCase())) || (r.feeder && pendNames.has(looseKey(r.feeder)));
    const unknown = new Map<string, Row>();
    for (const r of rows) if (!idx.find(r) && !pending(r)) unknown.set(looseKey(r.feeder ?? r.feederCode ?? r.altId), r);
    for (const r of unknown.values()) {
      const name = String(r.feeder ?? r.feederCode ?? r.altId);
      if (args.dataset === "CAPS") issues.push({ level: "warning", ref: name, message: "Feeder on the caps schedule is not in the feeder register." });
      else if (args.partial) issues.push({ level: "warning", ref: name, message: "Feeder not in the register; its figures are skipped." });
      else if (!r.hub) issues.push({ level: "error", ref: name, message: "Feeder not in the register and no business unit given. Add it to the Feeder List or correct the name or ID." });
      else issues.push({ level: "warning", ref: name, message: "Feeder not in the register; it will be registered from this return." });
    }
  }
  const [s] = await db.insert(schema.submissions).values({
    licenseeId: args.licenseeId, dataset: args.dataset, periods, format: args.format, channel: args.channel,
    fileName: args.fileName ?? null, uploadId: args.uploadId ?? null, file: args.file ?? null, rowCount: rows.length, rows, issues: dedupe(issues),
    status: "staged", submittedById: args.userId, submittedByName: args.userName, partial: !!args.partial, reference: args.reference ?? null,
  }).returning({ id: schema.submissions.id });
  return s.id;
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => { const k = `${i.level}|${i.period}|${i.ref}|${i.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === "error");

// ---------------------------------------------------------------- filing

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const txt = (v: unknown) => (v == null || v === "" ? null : norm(v));

/** Fields of a row that live in the ext JSON: the dataset's ext columns plus anything the dataset does not define. */
function extOf(code: DatasetCode, r: Row, coreKeys: string[]) {
  const def = DATASETS[code];
  const known = new Set(def.columns.filter((c) => !c.ext).map((c) => c.key).concat(coreKeys, ["period", "licenseeCode", "altId", "feeder", "feederCode", "hub", "voltage", "parent", "band"]));
  const out: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(r)) if (!known.has(k) && v != null && v !== "") out[k] = typeof v === "number" ? v : String(v);
  return out;
}

/** Moves a staged submission's rows into the data tables. Full returns replace the months they cover; partial returns merge. */
export async function commit(submissionId: string) {
  const settings = await getSettings();
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(schema.submissions).where(eq(schema.submissions.id, submissionId)).for("update");
    if (!s || s.status !== "staged") throw new Error("Only a staged submission can be confirmed.");
    if (hasErrors(s.issues)) throw new Error("Fix the errors and upload again; this submission cannot be confirmed.");
    const lic = s.licenseeId;
    const filer = lic ?? COMMISSION_FILER;
    const rows = s.rows as Row[];
    const periods = s.periods;
    const lics = await tx.select().from(schema.licensees);

    const hubIds = new Map<string, string>();
    const hubOf = async (name: unknown, licId = lic!) => {
      const k = `${licId}|${hubKey(name)}`;
      if (hubIds.has(k)) return hubIds.get(k)!;
      const r = await hubResolver(licId, tx);
      let id = r.find(name);
      if (!id) { id = `${licId}:${hubKey(name)}`; await tx.insert(schema.hubs).values({ id, licenseeId: licId, name: norm(name), aliases: [] }).onConflictDoNothing(); }
      hubIds.set(k, id);
      return id;
    };

    switch (s.dataset) {
      case "REGISTER": await fileRegister(tx, lic!, rows, hubOf); break;
      case "FEEDER": {
        // register feeders this return introduces (older layouts carry hub, voltage and parent)
        let idx = await feederIndex(lic!, tx);
        const fresh = new Map<string, Row>();
        for (const r of rows) if (!idx.find(r) && r.feeder && r.hub && !s.partial) fresh.set(looseKey(r.feeder), r);
        if (fresh.size) await fileRegister(tx, lic!, [...fresh.values()].map((r) => ({ feeder: r.feeder, feederCode: r.feederCode, hub: r.hub, voltage: r.voltage, parent: r.parent, band: r.band, level: r.parent ? "Fed" : undefined })), hubOf);
        // fill gaps in the register from legacy layouts (never overwrite register values)
        idx = await feederIndex(lic!, tx);
        for (const r of rows) {
          const f = idx.find(r); if (!f) continue;
          const set: Partial<Feeder> = {};
          if (!f.hubId && r.hub) set.hubId = await hubOf(r.hub);
          if (!f.parentId && r.parent) { const p = idx.find({ feeder: r.parent }); if (p) { set.parentId = p.id; if (!f.level) set.level = "Fed"; } }
          if (!f.band && r.band) set.band = String(r.band);
          if (Object.keys(set).length) { await tx.update(schema.feeders).set(set).where(eq(schema.feeders.id, f.id)); Object.assign(f, set); }
        }
        const core = ["hoursPerDay", "deliveredMwh", "nominatedMwh", "interruptions"];
        const vals = rows.map((r) => {
          const f = idx.find(r); if (!f) return null;
          const band = String(r.band ?? f.band ?? "");
          return {
            licenseeId: lic!, feederId: f.id, period: String(r.period), band, bandHours: settings.bandHours[band] ?? 0,
            hoursPerDay: num(r.hoursPerDay), deliveredMwh: num(r.deliveredMwh), nominatedMwh: num(r.nominatedMwh), interruptions: int(r.interruptions),
            ext: extOf("FEEDER", r, core), submissionId: s.id, has: r,
          };
        }).filter((x): x is NonNullable<typeof x> => !!x);
        if (!s.partial) {
          await tx.delete(schema.feederMonthly).where(and(eq(schema.feederMonthly.licenseeId, lic!), inArray(schema.feederMonthly.period, periods)));
          const clean = vals.map(({ has: _h, ...v }) => v);
          for (let k = 0; k < clean.length; k += 400) await tx.insert(schema.feederMonthly).values(clean.slice(k, k + 400));
        } else {
          for (const v of vals) {
            const set: Record<string, unknown> = {};
            for (const k of core) if (v.has[k] != null) set[k] = (v as Record<string, unknown>)[k];
            const ext = v.ext;
            await tx.insert(schema.feederMonthly).values({ ...v, has: undefined } as never).onConflictDoUpdate({
              target: [schema.feederMonthly.feederId, schema.feederMonthly.period],
              set: { ...set, ext: sql`${schema.feederMonthly.ext} || ${JSON.stringify(ext)}::jsonb` },
            });
          }
        }
        break;
      }
      case "COMMERCIAL": {
        await tx.delete(schema.commercialMonthly).where(and(eq(schema.commercialMonthly.licenseeId, lic!), inArray(schema.commercialMonthly.period, periods)));
        const core = ["billedNgnMd", "billedNgnNmd"];
        for (const r of rows) {
          const md = (num(r.billedNgnMeteredMd) ?? 0) + (num(r.billedNgnUnmeteredMd) ?? 0);
          const nmd = (num(r.billedNgnMeteredNmd) ?? 0) + (num(r.billedNgnUnmeteredNmd) ?? 0);
          const anyBilled = [r.billedNgnMeteredMd, r.billedNgnUnmeteredMd, r.billedNgnMeteredNmd, r.billedNgnUnmeteredNmd].some((x) => num(x) != null);
          await tx.insert(schema.commercialMonthly).values({
            licenseeId: lic!, hubId: await hubOf(r.hub), period: String(r.period),
            custMeteredMd: int(r.custMeteredMd), custMeteredNmd: int(r.custMeteredNmd), custUnmeteredMd: int(r.custUnmeteredMd), custUnmeteredNmd: int(r.custUnmeteredNmd),
            energyReceivedKwh: num(r.energyReceivedKwh), energyReceivedNgn: num(r.energyReceivedNgn),
            billedKwhMeteredMd: num(r.billedKwhMeteredMd), billedKwhMeteredNmd: num(r.billedKwhMeteredNmd), billedKwhUnmeteredMd: num(r.billedKwhUnmeteredMd), billedKwhUnmeteredNmd: num(r.billedKwhUnmeteredNmd),
            billedNgnMd: anyBilled ? md : num(r.billedNgnMd), billedNgnNmd: anyBilled ? nmd : num(r.billedNgnNmd),
            collectedNgnMd: num(r.collectedNgnMd), collectedNgnNmd: num(r.collectedNgnNmd), arrearsNgn: num(r.arrearsNgn),
            ext: extOf("COMMERCIAL", r, core), submissionId: s.id,
          });
        }
        break;
      }
      case "METERING": {
        await tx.delete(schema.meteringMonthly).where(and(eq(schema.meteringMonthly.licenseeId, lic!), inArray(schema.meteringMonthly.period, periods)));
        for (const r of rows) await tx.insert(schema.meteringMonthly).values({
          licenseeId: lic!, hubId: await hubOf(r.hub), period: String(r.period), installedMap: int(r.installedMap), installedMaf: int(r.installedMaf),
          installedVendor: int(r.installedVendor), installedDisco: int(r.installedDisco), replaced: int(r.replaced), faultyReported: int(r.faultyReported),
          pendingApplications: int(r.pendingApplications), submissionId: s.id,
        });
        break;
      }
      case "COMPLAINTS": {
        await tx.delete(schema.complaintsMonthly).where(and(eq(schema.complaintsMonthly.licenseeId, lic!), inArray(schema.complaintsMonthly.period, periods)));
        const agg = new Map<string, { period: string; category: string; received: number; resolved: number; resolvedInTime: number | null; escalated: number | null }>();
        for (const r of rows) {
          const cat = (COMPLAINT_CATEGORIES as readonly string[]).includes(String(r.category)) ? String(r.category) : "Other";
          const k = `${r.period}|${cat}`;
          const a = agg.get(k) ?? { period: String(r.period), category: cat, received: 0, resolved: 0, resolvedInTime: null, escalated: null };
          a.received += int(r.received) ?? 0; a.resolved += int(r.resolved) ?? 0;
          if (r.resolvedInTime != null) a.resolvedInTime = (a.resolvedInTime ?? 0) + (int(r.resolvedInTime) ?? 0);
          if (r.escalated != null) a.escalated = (a.escalated ?? 0) + (int(r.escalated) ?? 0);
          agg.set(k, a);
        }
        for (const a of agg.values()) await tx.insert(schema.complaintsMonthly).values({ licenseeId: lic!, ...a, submissionId: s.id });
        break;
      }
      case "GENUNIT": {
        await tx.delete(schema.genUnitMonthly).where(and(eq(schema.genUnitMonthly.licenseeId, lic!), inArray(schema.genUnitMonthly.period, periods)));
        for (const r of rows) await tx.insert(schema.genUnitMonthly).values({
          licenseeId: lic!, plantCode: String(r.plantCode), unitCode: String(r.unitCode), period: String(r.period),
          installedMw: num(r.installedMw), availableMw: num(r.availableMw), netMwh: num(r.netMwh), operatingHours: num(r.operatingHours), forcedOutageHours: num(r.forcedOutageHours),
          ext: extOf("GENUNIT", r, ["plantCode", "unitCode"]), submissionId: s.id,
        });
        break;
      }
      case "GENPLANT": {
        await tx.delete(schema.genPlantMonthly).where(and(eq(schema.genPlantMonthly.licenseeId, lic!), inArray(schema.genPlantMonthly.period, periods)));
        for (const r of rows) await tx.insert(schema.genPlantMonthly).values({ licenseeId: lic!, plantCode: String(r.plantCode), period: String(r.period), ext: extOf("GENPLANT", r, ["plantCode"]), submissionId: s.id });
        break;
      }
      case "CAPS": {
        await tx.delete(schema.energyCaps).where(and(eq(schema.energyCaps.licenseeId, lic!), inArray(schema.energyCaps.period, periods)));
        const idx = await feederIndex(lic!, tx);
        const vals = [];
        for (const r of rows) vals.push({ licenseeId: lic!, period: String(r.period), hubId: r.hub ? await hubOf(r.hub) : null, feederName: String(r.feeder), feederId: idx.find(r)?.id ?? null, band: r.band ? String(r.band) : null, capKwh: num(r.capKwh) ?? 0, submissionId: s.id });
        for (let k = 0; k < vals.length; k += 500) await tx.insert(schema.energyCaps).values(vals.slice(k, k + 500)).onConflictDoNothing();
        break;
      }
      case "GENREG": await fileGenRegister(tx, rows, lics, s.format); break;
      case "REFERRALS": {
        for (const r of rows) {
          const l = resolveLicensee(r.licenseeCode, lics) ?? lics.find((x) => x.id === lic) ?? null;
          if (!l) continue;
          const f = (await feederIndex(l.id, tx)).find({ feederCode: r.feederCode, altId: r.feederCode, feeder: r.feeder });
          const v = {
            licenseeId: l.id, feederId: f?.id ?? null, feederName: f?.name ?? String(r.feeder), band: txt(r.band), floorHours: num(r.floorHours), hub: txt(r.hub),
            monthsBreached: int(r.monthsBreached), avgHours: num(r.avgHours), shortfall: num(r.shortfall), dataQualityFlag: txt(r.dataQualityFlag),
            referredOn: String(r.referredOn), referredBy: norm(r.referredBy), status: norm(r.status) || "Referred to Compliance", caseNo: txt(r.caseNo), closedOn: txt(r.closedOn), notes: norm(r.notes), updatedAt: new Date(),
          };
          await tx.insert(schema.referrals).values({ ref: String(r.ref), ...v }).onConflictDoUpdate({ target: schema.referrals.ref, set: v });
        }
        break;
      }
      case "PLANEVAL": {
        const plants = await tx.select().from(schema.generationAssets);
        for (const r of rows) {
          const p = plants.find((x) => x.code && x.code === r.plantCode) ?? plants.find((x) => x.matchKey === plantKey(r.plantName));
          const gates: Record<string, "Yes" | "No" | null> = {};
          for (const g of ["G1", "G2", "G3", "G4", "G5"]) gates[g] = /^y/i.test(String(r[g] ?? "")) ? "Yes" : /^n/i.test(String(r[g] ?? "")) ? "No" : null;
          const scores: Record<string, number | null> = {};
          for (const k of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) scores[k] = num(r[k]);
          const v = {
            plantId: p?.id ?? null, plantName: p?.name ?? String(r.plantName), planType: (r.planType === "Expansion" ? "Expansion" : "Capacity recovery") as "Expansion" | "Capacity recovery",
            receivedOn: String(r.receivedOn), decidedOn: txt(r.decidedOn), gates, scores, leadEvaluator: norm(r.leadEvaluator), conditions: norm(r.conditions),
            isExample: /example/i.test(String(r.conditions ?? "")), updatedAt: new Date(),
          };
          await tx.insert(schema.planEvaluations).values({ id: String(r.id), ...v }).onConflictDoUpdate({ target: schema.planEvaluations.id, set: v });
        }
        break;
      }
      case "FORECAST": {
        const f = { ...settings.forecast } as Record<string, number | boolean>;
        for (const r of rows) {
          const k = String(r.key);
          if (k === "removeDoubleCount") f[k] = String(r.value) === "true";
          else if (k in f) { const v = Number(r.value); if (Number.isFinite(v)) f[k] = v; }
        }
        await saveSetting("forecast", f, s.submittedById);
        break;
      }
    }

    // Point filings at this submission. A partial return fills months nobody has filed but never displaces a full return.
    const prev = await tx.select().from(schema.filings).where(and(eq(schema.filings.licenseeId, filer), eq(schema.filings.dataset, s.dataset), inArray(schema.filings.period, periods)));
    for (const p of periods) {
      if (s.partial && prev.some((f) => f.period === p)) continue;
      await tx.insert(schema.filings).values({ licenseeId: filer, dataset: s.dataset, period: p, submissionId: s.id, filedAt: new Date() })
        .onConflictDoUpdate({ target: [schema.filings.licenseeId, schema.filings.dataset, schema.filings.period], set: { submissionId: s.id, filedAt: new Date() } });
    }
    if (!s.partial) for (const oldId of new Set(prev.map((f) => f.submissionId))) {
      if (oldId === s.id) continue;
      const [{ c }] = await tx.select({ c: sql<number>`count(*)::int` }).from(schema.filings).where(eq(schema.filings.submissionId, oldId));
      if (c === 0) await tx.update(schema.submissions).set({ status: "superseded" }).where(eq(schema.submissions.id, oldId));
    }
    await tx.update(schema.submissions).set({ status: "received", committedAt: new Date() }).where(eq(schema.submissions.id, s.id));
    return { periods, rows: rows.length };
  });
}

// ---------------------------------------------------------------- registers

/** An OGSERC-issued Feeder ID, e.g. OGF-33-0001. */
export const isFeederId = (s: string) => /^OGF-(33|11)-\d{4,}$/i.test(s.trim());

async function fileRegister(tx: Tx, lic: string, rows: Row[], hubOf: (n: unknown) => Promise<string>) {
  const idx = await feederIndex(lic, tx);
  const usedCodes = new Set(idx.list.map((f) => f.code).filter(Boolean) as string[]);
  const touched: { f: Feeder; parent?: unknown }[] = [];
  for (const r of rows) {
    const existing = idx.find({ feederCode: r.feederCode, altId: r.altIds, feeder: r.feeder });
    const aliases = new Set(existing?.aliases ?? []);
    for (const a of String(r.altIds ?? "").split(";").map((x) => x.trim()).filter(Boolean)) aliases.add(a);
    const attrs: Record<string, string | number | null> = { ...(existing?.attrs ?? {}) };
    for (const k of ["substation", "ratingMva", "routeKm", "dtCount", "dtKva", "customers", "meteredCustomers", "loadType", "lga", "bandEffectiveFrom", "remarks"])
      if (r[k] != null && r[k] !== "") attrs[k] = typeof r[k] === "number" ? (r[k] as number) : String(r[k]);
    const set: Partial<Feeder> = { aliases: [], attrs, updatedAt: new Date() };
    if (r.hub) set.hubId = await hubOf(r.hub);
    if (r.voltage && r.voltage !== "Other") set.voltage = r.voltage as Feeder["voltage"];
    for (const k of ["level", "band", "segment", "tariffClass", "classificationBasis", "status"] as const) if (r[k]) (set as Record<string, unknown>)[k] = String(r[k]);
    // Only OGSERC issues Feeder IDs (OGF-<kV>-<serial>). Any other code is the licensee's own and is kept as an other ID.
    const rawCode = r.feederCode ? String(r.feederCode).trim() : null;
    const code = rawCode && isFeederId(rawCode) ? rawCode.toUpperCase() : null;
    if (rawCode && !code) aliases.add(rawCode);
    if (existing) {
      let authoritative = false;
      if (code && existing.code === code) authoritative = true;
      else if (code && !usedCodes.has(code)) {
        if (existing.code) aliases.add(existing.code); // an earlier code (e.g. F001) stays findable
        set.code = code; usedCodes.add(code); authoritative = true;
      } else if (code) aliases.add(code);
      // A register row carrying the feeder's own ID sets its name; earlier spellings become other names.
      if (authoritative && r.feeder && String(r.feeder) !== existing.name) { aliases.add(existing.name); set.name = String(r.feeder); }
      else if (r.feeder && String(r.feeder) !== existing.name) aliases.add(String(r.feeder));
      aliases.delete(String(set.name ?? existing.name));
      aliases.delete(String(set.code ?? existing.code ?? ""));
      set.aliases = [...aliases];
      await tx.update(schema.feeders).set(set).where(eq(schema.feeders.id, existing.id));
      touched.push({ f: { ...existing, ...set } as Feeder, parent: r.parent });
    } else {
      const name = String(r.feeder ?? code);
      const id = feederId(lic, name);
      const f = {
        id, licenseeId: lic, name, code: code && !usedCodes.has(code) ? code : null, aliases: [...aliases], voltage: (set.voltage ?? parseVoltage(null, name)) as Feeder["voltage"],
        level: (set.level ?? null) as Feeder["level"], hubId: set.hubId ?? null, parentId: null, band: set.band ?? null, segment: set.segment ?? null, tariffClass: set.tariffClass ?? null,
        classificationBasis: set.classificationBasis ?? null, status: set.status ?? "Active", attrs, updatedAt: new Date(),
      };
      if (f.code) usedCodes.add(f.code);
      await tx.insert(schema.feeders).values(f).onConflictDoNothing();
      touched.push({ f: f as Feeder, parent: r.parent });
    }
  }
  const idx2 = await feederIndex(lic, tx);
  for (const t of touched) if (t.parent) {
    const p = idx2.find({ feeder: t.parent, feederCode: t.parent });
    if (p && p.id !== t.f.id) await tx.update(schema.feeders).set({ parentId: p.id, level: t.f.level ?? "Fed" }).where(eq(schema.feeders.id, t.f.id));
  }
}

async function fileGenRegister(tx: Tx, rows: Row[], lics: Licensee[], format: string) {
  const plants = await tx.select().from(schema.generationAssets);
  for (const r of rows) {
    const l = resolveLicensee(r.licenseeCode ?? r.owner, lics);
    const rawCode = r.code ? String(r.code) : null;
    const isOgserc = !!rawCode && /^GP-\d+$/i.test(rawCode);
    const licAlias = rawCode && !isOgserc && l ? `${l.code || l.id}:${rawCode}`.toUpperCase() : null;
    const key = plantKey(r.name);
    const loc = looseKey(r.location ?? r.lga ?? "");
    const plantLoc = (p: (typeof plants)[number]) => looseKey(p.location || p.lga || "");
    const byName = plants.filter((p) => p.matchKey.split(":")[0] === key || p.aliases.some((a) => plantKey(a) === key));
    const sameName = (p: (typeof plants)[number]) => plantKey(p.name) === key || p.aliases.some((a) => plantKey(a) === key);
    // The Commission's own plant IDs are authoritative: a different plant holding the ID (an ID the Hub assigned) gives it up.
    if (isOgserc) for (const p of plants) if (p.code?.toUpperCase() === rawCode!.toUpperCase() && !sameName(p)) {
      await tx.update(schema.generationAssets).set({ code: null }).where(eq(schema.generationAssets.id, p.id)); p.code = null;
    }
    const hit = plants.find((p) => (isOgserc && p.code?.toUpperCase() === rawCode!.toUpperCase()) || (licAlias && p.aliases.includes(licAlias)))
      ?? byName.find((p) => loc && plantLoc(p) === loc)
      ?? byName.find((p) => !loc || !plantLoc(p));
    const attrs: Record<string, string | number | null> = { ...(hit?.attrs ?? {}) };
    for (const k of ["licenceNo", "units", "connectionKv", "connectionPoint", "offtake", "contractedOgunMw", "lat", "lon", "year", "fuelSupplier", "lastPlan", "verified", "notes"])
      if (r[k] != null && r[k] !== "") attrs[k] = typeof r[k] === "number" ? (r[k] as number) : String(r[k]);
    const v: Record<string, unknown> = { attrs, updatedAt: new Date() };
    const put = (k: string, val: unknown) => { if (val != null && val !== "") v[k] = val; };
    put("owner", r.owner); put("location", r.location); put("lga", r.lga); put("capacityMw", num(r.capacityMw)); put("availableMw", num(r.availableMw));
    put("fuel", r.fuel); put("technology", r.technology); put("category", r.category); put("status", r.status); put("permitStatus", r.permitStatus);
    put("planStatus", r.planStatus); put("nextPlanDue", r.nextPlanDue); if (l) v.licenseeId = l.id;
    if (hit) {
      const aliases = new Set(hit.aliases); if (licAlias) aliases.add(licAlias); if (plantKey(hit.name) !== key || hit.name !== r.name) aliases.add(String(r.name));
      v.sources = [...new Set([...hit.sources, format])];
      if (isOgserc) { v.code = rawCode; v.name = String(r.name); if (hit.name !== r.name) aliases.add(hit.name); } // the Commission's register ID and name win
      aliases.delete(String(v.name ?? hit.name));
      v.aliases = [...aliases];
      await tx.update(schema.generationAssets).set(v).where(eq(schema.generationAssets.id, hit.id));
      Object.assign(hit, v);
    } else {
      const ins = { name: String(r.name), matchKey: `${key}:${loc}`, code: isOgserc ? rawCode : null, aliases: licAlias ? [licAlias] : [], sources: [format], ...v } as typeof schema.generationAssets.$inferInsert;
      const [p] = await tx.insert(schema.generationAssets).values(ins).returning();
      plants.push(p);
    }
  }
  // give every plant an OGSERC plant ID
  const all = await tx.select().from(schema.generationAssets);
  let next = Math.max(0, ...all.map((p) => Number(p.code?.match(/^GP-(\d+)$/)?.[1] ?? 0))) + 1;
  for (const p of all.filter((x) => !x.code).sort((a, b) => (b.capacityMw ?? 0) - (a.capacityMw ?? 0))) {
    await tx.update(schema.generationAssets).set({ code: `GP-${String(next++).padStart(3, "0")}` }).where(eq(schema.generationAssets.id, p.id));
  }
}
