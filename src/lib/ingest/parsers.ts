/**
 * Turns uploaded workbooks into dataset rows. Recognises:
 *  - OGSERC templates and the Commission's own workbooks (EMPR market and generation analytics,
 *    Feeder Register and SBT Monitoring, Generation Register and Plan Evaluation, Load Forecast Baseline),
 *    the Licensee and GenCo Monthly Return datasheets — all read by column heading;
 *  - legacy layouts already in circulation (IBEDC feeder and billing workbooks, NERC caps schedule, gencos list).
 */
import type { Issue } from "@/db/schema";
import { DATASETS, type DatasetCode, type DatasetDef, norm, parseBand, parseVoltage, toNumber } from "../datasets";
import { monthFromText, parsePeriod } from "../periods";
import { type Book, type Grid, cellText, findRow, findSheet, lc, readBook, yearInBook } from "./xlsx";

export type Row = Record<string, unknown> & { period?: string; licenseeCode?: string };
export type Batch = { dataset: DatasetCode; format: string; rows: Row[]; issues: Issue[]; partial?: boolean; reference?: string; sheet?: string };
export type ParseContext = {
  yearHint: number;
  feederInfo?: Map<string, { hub: string; voltage: string; parent: string | null }>;
};
type Parser = { format: string; detect: (b: Book) => boolean; parse: (b: Book, ctx: ParseContext) => Batch[] };

const pad = (m: number) => String(m).padStart(2, "0");
const hnorm = (s: unknown) => cellText(s).toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").replace(/\s*\(\s*/g, " (").trim();

// ---------------------------------------------------------------- helpers

/** Value next to a label anywhere in a sheet (e.g. "Reporting year | 2026"). */
function labelValue(grid: Grid, test: RegExp): unknown {
  for (const row of grid.slice(0, 200)) for (let i = 0; i < row.length; i++) if (test.test(cellText(row[i]))) {
    for (let j = i + 1; j < Math.min(row.length, i + 4); j++) if (cellText(row[j]) !== "") return row[j];
  }
  return null;
}

function isoDate(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cellText(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : s || null;
}

/** Reads a table whose headings match the dataset's columns (by heading, alternative heading or key). */
export function readTable(grid: Grid, def: DatasetDef, year: number, minMatch = 3): { rows: Row[]; matched: string[] } | null {
  const want = def.columns.map((col) => [col.header, ...(col.alt ?? []), col.key].map(hnorm));
  let headerAt = -1, idx: number[] = [];
  for (let r = 0; r < Math.min(grid.length, 25); r++) {
    const head = (grid[r] ?? []).map(hnorm);
    const map = want.map((names) => head.findIndex((h) => h && names.includes(h)));
    if (map.filter((x) => x >= 0).length >= Math.min(minMatch, def.columns.length)) { headerAt = r; idx = map; break; }
  }
  if (headerAt < 0) return null;
  const rows: Row[] = [];
  let carryPeriod: string | null = null;
  for (const r of grid.slice(headerAt + 1)) {
    if (!r || r.every((x) => cellText(x) === "")) continue;
    const row: Row = {};
    def.columns.forEach((col, k) => {
      if (idx[k] < 0) return;
      const v = r[idx[k]];
      if (v == null || cellText(v) === "") return;
      if (col.type === "period") row[col.key] = parsePeriod(v instanceof Date ? v : cellText(v), year) ?? cellText(v);
      else if (col.type === "date") row[col.key] = isoDate(v);
      else if (col.type === "number" || col.type === "int") row[col.key] = toNumber(v) ?? cellText(v);
      else row[col.key] = norm(v);
    });
    // month written only on the first row of each block
    if (def.periodic) { if (row.period) carryPeriod = String(row.period); else if (carryPeriod && Object.keys(row).length) row.period = carryPeriod; }
    const ids = def.keyCols.some((k) => row[k] != null && row[k] !== "") || (def.code === "FEEDER" && (row.feeder || row.feederCode));
    if (!ids) continue;
    if (Object.values(row).some((v) => /^(total|sub-?total|region)$/i.test(String(v)))) continue;
    rows.push(row);
  }
  return { rows, matched: def.columns.filter((_, k) => idx[k] >= 0).map((c) => c.header) };
}

/** Wide sheets: one row per feeder, one column per month (dates or month names). */
function readWide(grid: Grid, year: number, field: string, secondField?: string): Row[] {
  let hr = findRow(grid, (c) => c.some((x) => x === "feeder id" || x === "feeder name"), 12);
  if (hr < 0) hr = findRow(grid, (c) => c.some((x) => x.length < 30 && /feeders?$/.test(x)), 12);
  if (hr < 0) return [];
  const head = grid[hr] ?? [];
  const cols: { i: number; period: string; second: boolean }[] = [];
  const seen = new Set<string>();
  head.forEach((h, i) => {
    let p: string | null = null;
    if (h instanceof Date) p = `${h.getUTCFullYear()}-${pad(h.getUTCMonth() + 1)}`;
    else { const t = cellText(h); if (/total|average|avg/i.test(t)) return; const m = monthFromText(t); if (m && t.length < 40) p = `${year}-${pad(m)}`; }
    if (!p) return;
    cols.push({ i, period: p, second: seen.has(p) });
    seen.add(p);
  });
  const h = head.map(lc);
  const cId = h.indexOf("feeder id"), cName = h.findIndex((x) => x === "feeder name" || /feeders?$/.test(x)), cBand = h.findIndex((x) => x === "band" || x === "tariff band");
  const out: Row[] = [];
  for (const r of grid.slice(hr + 1)) {
    const name = norm(r[cName]); const id = cId >= 0 ? norm(r[cId]) : "";
    if (!name && !id) continue;
    for (const c of cols) {
      const v = toNumber(r[c.i]); if (v == null) continue;
      const key = c.second ? secondField : field; if (!key) continue;
      out.push({ period: c.period, feeder: name || undefined, altId: id || undefined, band: cBand >= 0 ? norm(r[cBand]) || undefined : undefined, [key]: v });
    }
  }
  return out;
}

/** Merges partial rows for the same feeder and month. */
function mergeRows(rows: Row[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) { const k = `${r.period}|${r.altId ?? ""}|${r.feeder ?? ""}`; m.set(k, { ...(m.get(k) ?? {}), ...r }); }
  return [...m.values()];
}

// ---------------------------------------------------------------- generic: OGSERC templates, datasheets and Commission workbooks

const SHEET_MAP: Record<string, DatasetCode> = {
  "feeder list": "REGISTER", "feeder register": "REGISTER",
  "feeder return": "FEEDER", "data entry": "FEEDER", "feeder_technical": "FEEDER",
  "commercial return": "COMMERCIAL", "hub commercial entry": "COMMERCIAL", "commercial_hub": "COMMERCIAL",
  "metering return": "METERING", "metering_hub": "METERING",
  "complaints return": "COMPLAINTS", "complaints": "COMPLAINTS",
  "unit return": "GENUNIT", "unit returns": "GENUNIT",
  "plant return": "GENPLANT", "plant returns": "GENPLANT",
  "energy caps": "CAPS", "energy_caps": "CAPS",
  "plant register": "GENREG", "register": "GENREG", "plant list": "GENREG", "generation_register": "GENREG",
  "breach referrals": "REFERRALS",
  "evaluations": "PLANEVAL",
};

function coverInfo(b: Book, ctx: ParseContext) {
  const cover = findSheet(b, (n) => n === "cover");
  const settings = findSheet(b, (n) => n === "settings");
  const yearV = (cover && labelValue(cover.grid, /reporting year|^year$/i)) ?? (settings && labelValue(settings.grid, /^reporting year$/i));
  let year = toNumber(yearV) ?? null;
  const monthV = cover ? labelValue(cover.grid, /reporting month|^month$/i) : null;
  const period = monthV != null ? parsePeriod(monthV instanceof Date ? monthV : cellText(monthV), year ?? ctx.yearHint) : null;
  if (!year && period) year = Number(period.slice(0, 4));
  const licenseeCode = cover ? norm(labelValue(cover.grid, /licensee code|^licensee$/i)) || undefined : settings ? norm(labelValue(settings.grid, /^licensee$/i)) || undefined : undefined;
  const reference = cover ? norm(labelValue(cover.grid, /submission ref/i)) || undefined : undefined;
  return { year: year ?? yearInBook(b) ?? ctx.yearHint, period, licenseeCode, reference };
}

const generic: Parser = {
  format: "OGSERC workbook",
  detect: (b) => b.sheets.some((s) => s.name.trim().toLowerCase() in SHEET_MAP),
  parse: (b, ctx) => {
    const info = coverInfo(b, ctx);
    const out: Batch[] = [];
    for (const s of b.sheets) {
      const code = SHEET_MAP[s.name.trim().toLowerCase()];
      if (!code) continue;
      const t = readTable(s.grid, DATASETS[code], info.year);
      if (!t) continue;
      const rows = t.rows.map((r) => ({ ...(info.period && DATASETS[code].periodic ? { period: info.period } : {}), ...(info.licenseeCode && !r.licenseeCode ? { licenseeCode: info.licenseeCode } : {}), ...r }));
      if (!rows.length) continue;
      out.push({ dataset: code, format: formatName(b), rows, issues: [], reference: info.reference, sheet: s.name });
    }
    return out;
  },
};

function formatName(b: Book): string {
  const n = new Set(b.sheets.map((s) => s.name.trim().toLowerCase()));
  if (n.has("data entry") && n.has("hub commercial entry")) return "OGSERC EMPR market analytics workbook";
  if (n.has("unit returns") && n.has("plant returns")) return "OGSERC EMPR generation analytics workbook";
  if (n.has("register") && n.has("evaluations")) return "OGSERC generation register and plan evaluation workbook";
  if (n.has("cover") && n.has("unit return")) return "GenCo Monthly Return datasheet";
  if (n.has("cover") && n.has("feeder return")) return "Licensee Monthly Return datasheet";
  return "OGSERC template";
}

// ---------------------------------------------------------------- Feeder Register and SBT Monitoring workbook

const sbt: Parser = {
  format: "OGSERC feeder register and SBT monitoring workbook",
  detect: (b) => !!findSheet(b, (n) => n === "monthly hours") && !!findSheet(b, (n) => n === "band compliance"),
  parse: (b, ctx) => {
    const settings = findSheet(b, (n) => n === "settings");
    const licenseeCode = settings ? norm(labelValue(settings.grid, /^licensee$/i)) : undefined;
    const rm = settings ? labelValue(settings.grid, /^reporting month$/i) : null;
    const year = rm instanceof Date ? rm.getUTCFullYear() : ctx.yearHint;
    const out: Batch[] = [];
    const reg = findSheet(b, (n) => n === "feeder register");
    if (reg) {
      const t = readTable(reg.grid, DATASETS.REGISTER, year);
      // SBT feeder IDs (FD-…) are this workbook's own; they become other IDs of the register feeder.
      const rows = (t?.rows ?? []).filter((r) => r.feeder).map(({ feederCode, ...r }) => ({ ...r, licenseeCode: r.licenseeCode ?? licenseeCode, altIds: feederCode ? String(feederCode) : undefined }));
      if (rows.length) out.push({ dataset: "REGISTER", format: sbt.format, rows, issues: [], sheet: reg.name });
    }
    const wide: Row[] = [];
    const add = (sheet: RegExp, field: string, second?: string) => { const s = findSheet(b, (n) => sheet.test(n)); if (s) wide.push(...readWide(s.grid, year, field, second)); };
    add(/^monthly hours$/, "hoursPerDay");
    add(/^load nomination$/, "nominatedMwh");
    add(/^energy delivered$/, "deliveredMwh");
    add(/^interruptions?$/, "interruptions", "avgInterruptionHours");
    const merged = mergeRows(wide).map((r) => ({ ...r, licenseeCode }));
    if (merged.length) out.push({ dataset: "FEEDER", format: sbt.format, rows: merged, issues: [{ level: "warning", message: "Monthly hours and technical sheets update the fields they carry; other fields keep their filed values." }], partial: true });
    const refs = findSheet(b, (n) => n === "breach referrals");
    if (refs) {
      const t = readTable(refs.grid, DATASETS.REFERRALS, year);
      const rows = (t?.rows ?? []).map((r) => ({ ...r, licenseeCode: r.licenseeCode ?? licenseeCode }));
      if (rows.length) out.push({ dataset: "REFERRALS", format: sbt.format, rows, issues: [], sheet: refs.name });
    }
    return out;
  },
};

/** OGSERC technical data sample: LOAD NOMINATION, ENERGY DELIVERED and INTERRUPTION sheets. */
const technicalSample: Parser = {
  format: "OGSERC technical data workbook",
  detect: (b) => !!findSheet(b, (n) => n === "load nomination" || n === "energy delivered") && !findSheet(b, (n) => n === "band compliance"),
  parse: (b, ctx) => {
    const wide: Row[] = [];
    const add = (sheet: RegExp, field: string, second?: string) => { const s = findSheet(b, (n) => sheet.test(n)); if (s) wide.push(...readWide(s.grid, ctx.yearHint, field, second)); };
    add(/^load nomination$/, "nominatedMwh"); add(/^energy delivered$/, "deliveredMwh"); add(/^interruptions?$/, "interruptions", "avgInterruptionHours");
    return [{ dataset: "FEEDER", format: technicalSample.format, rows: mergeRows(wide), issues: [], partial: true }];
  },
};

// ---------------------------------------------------------------- Load forecast baseline

const forecast: Parser = {
  format: "OGSERC load forecast baseline",
  detect: (b) => !!findSheet(b, (n) => n === "inputs") && !!findSheet(b, (n) => n === "forecast") && !!findSheet(b, (n) => n === "data_monthly"),
  parse: (b) => {
    const g = findSheet(b, (n) => n === "inputs")!.grid;
    const rows: Row[] = [];
    const dc = labelValue(g, /double count/i); if (dc != null) rows.push({ key: "removeDoubleCount", value: /^y/i.test(cellText(dc)) ? "true" : "false" });
    for (const [label, key] of [[/^low$/i, "low"], [/^base$/i, "base"], [/^high$/i, "high"], [/forecast start year/i, "startYear"], [/forecast end year/i, "endYear"]] as const) {
      const v = labelValue(g, label); if (v != null) rows.push({ key, value: cellText(v) });
    }
    return [{ dataset: "FORECAST", format: forecast.format, rows, issues: [] }];
  },
};

// ---------------------------------------------------------------- legacy layouts

const feederClean: Parser = {
  format: "IBEDC feeder workbook (cleaned master)",
  detect: (b) => !!findSheet(b, (n) => n === "master data"),
  parse: (b, ctx) => {
    const sh = findSheet(b, (n) => n === "master data")!;
    const year = yearInBook(b) ?? ctx.yearHint;
    const h = (sh.grid[0] ?? []).map(lc);
    const col = (name: string) => h.findIndex((x) => x === name);
    const cFeeder = col("feeder"), cBand = col("band"), cVolt = col("voltage"), cHub = col("hub");
    const monthly = (word: string) => h.map((x, i) => ({ i, m: x.includes(word) && /^[a-z]{3,9}\s/.test(x) ? monthFromText(x) : null })).filter((x) => x.m);
    const hours = monthly("hours/day"), del = monthly("delivered"), nom = monthly("nominated"), intr = monthly("interruption");
    const rows: Row[] = [];
    for (const r of sh.grid.slice(1)) {
      const feeder = norm(r[cFeeder]); if (!feeder) continue;
      const band = parseBand(r[cBand]);
      for (const { i, m } of hours) {
        const get = (arr: { i: number; m: number | null }[]) => toNumber(r[arr.find((x) => x.m === m)?.i ?? -1]);
        const info = ctx.feederInfo?.get(feeder.toUpperCase());
        rows.push({ period: `${year}-${pad(m!)}`, feeder, voltage: parseVoltage(r[cVolt], feeder), hub: norm(r[cHub]) || info?.hub, band: band?.band ?? norm(r[cBand]), hoursPerDay: toNumber(r[i]), deliveredMwh: get(del), nominatedMwh: get(nom), interruptions: get(intr) });
      }
    }
    return [{ dataset: "FEEDER", format: feederClean.format, rows, issues: [] }];
  },
};

const feederRaw: Parser = {
  format: "IBEDC feeder workbook (33kV / 11kV sheets)",
  detect: (b) => !!findSheet(b, (n) => /^33\s*kv feeders$/.test(n)) && !!findSheet(b, (n) => /^11\s*kv feeders$/.test(n)),
  parse: (b, ctx) => {
    const year = ctx.yearHint;
    const issues: Issue[] = [];
    const topo = new Map<string, { hub: string; parent: string | null }>();
    const combo = findSheet(b, (n) => /^33\s*-\s*11\s*kv/.test(n));
    if (combo) {
      const hr = findRow(combo.grid, (c) => c.includes("business hub"));
      const ch = (combo.grid[hr] ?? []).map(lc);
      const cHub = ch.indexOf("business hub");
      let parent: string | null = null;
      for (const r of combo.grid.slice(hr + 1)) {
        const name = norm(r[1]); if (!name) continue;
        const isChild = cellText(r[0]).includes(".");
        if (!isChild) parent = name;
        topo.set(name.toUpperCase(), { hub: norm(r[cHub]), parent: isChild ? parent : null });
      }
    }
    const rows: Row[] = [];
    for (const [sheetTest, volt] of [[/^33\s*kv feeders$/, "33kV"], [/^11\s*kv feeders$/, "11kV"]] as const) {
      const sh = findSheet(b, (n) => sheetTest.test(n))!;
      const hr = findRow(sh.grid, (c) => c.some((x) => x.includes("average hos")));
      const h = (sh.grid[hr] ?? []).map(lc);
      const pick = (word: string) => h.map((x, i) => ({ i, m: x.includes(word) ? monthFromText(x) : null })).filter((x) => x.m);
      const hours = pick("average hos"), en = pick("energy"), nom = pick("allocation"), intr = pick("interruption");
      const cBand = h.indexOf("band");
      for (const r of sh.grid.slice(hr + 1)) {
        const feeder = norm(r[1]);
        if (!feeder || /average|total/i.test(feeder)) continue;
        const band = parseBand(r[cBand]);
        const t = topo.get(feeder.toUpperCase());
        for (const { i, m } of hours) {
          const get = (arr: { i: number; m: number | null }[]) => { const c = arr.find((x) => x.m === m); return c ? toNumber(r[c.i]) ?? 0 : null; };
          rows.push({ period: `${year}-${pad(m!)}`, feeder, voltage: volt, hub: t?.hub, parent: t?.parent ?? undefined, band: band?.band ?? norm(r[cBand]), hoursPerDay: toNumber(r[i]) ?? 0, deliveredMwh: get(en), nominatedMwh: get(nom), interruptions: get(intr) });
        }
      }
    }
    issues.push({ level: "warning", message: `Months in this layout carry no year; read as ${year}.` });
    return [{ dataset: "FEEDER", format: feederRaw.format, rows, issues }];
  },
};

const billing: Parser = {
  format: "IBEDC regional billing workbook",
  detect: (b) => !!findSheet(b, (n) => n === "customer population") && !!findSheet(b, (n) => n.startsWith("energy billed")),
  parse: (b, ctx) => {
    const year = yearInBook(b) ?? ctx.yearHint;
    const issues: Issue[] = [];
    const acc = new Map<string, Row>();
    const read = (sheetName: string, map: Record<string, string>) => {
      const sh = findSheet(b, (n) => n === sheetName);
      if (!sh) { issues.push({ level: "error", message: `Sheet "${sheetName}" not found.` }); return; }
      const hr = findRow(sh.grid, (c) => c.includes("business hub"));
      const h = (sh.grid[hr] ?? []).map(lc);
      const cMonth = h.indexOf("month"), cHub = h.indexOf("business hub");
      const idx: Record<string, number> = {};
      for (const [header, key] of Object.entries(map)) idx[key] = h.indexOf(header);
      let month: number | null = null;
      for (const r of sh.grid.slice(hr + 1)) {
        const mt = cellText(r[cMonth]); if (mt) month = monthFromText(mt) ?? month;
        const hub = norm(r[cHub]);
        if (!hub || !month || /sub-?total|^total/i.test(hub)) continue;
        const period = `${year}-${pad(month)}`;
        const k = `${period}|${hub.toUpperCase()}`;
        const row = acc.get(k) ?? { period, hub };
        for (const [key, i] of Object.entries(idx)) if (i >= 0) row[key] = toNumber(r[i]);
        acc.set(k, row);
      }
    };
    read("customer population", { "metered md": "custMeteredMd", "metered nmd": "custMeteredNmd", "unmetered md": "custUnmeteredMd", "unmetered nmd": "custUnmeteredNmd" });
    read("energy billed (kwh)", { "metered md": "billedKwhMeteredMd", "metered nmd": "billedKwhMeteredNmd", "unmetered md": "billedKwhUnmeteredMd", "unmetered nmd": "billedKwhUnmeteredNmd" });
    read("billing amount (naira)", { "metered md": "billedNgnMeteredMd", "metered nmd": "billedNgnMeteredNmd", "unmetered md": "billedNgnUnmeteredMd", "unmetered nmd": "billedNgnUnmeteredNmd" });
    read("collection (naira)", { md: "collectedNgnMd", nmd: "collectedNgnNmd" });
    read("energy received(kwh)", { total: "energyReceivedKwh" });
    read("energy received(ngn)", { total: "energyReceivedNgn" });
    return [{ dataset: "COMMERCIAL", format: billing.format, rows: [...acc.values()], issues }];
  },
};

const caps: Parser = {
  format: "NERC energy caps schedule",
  detect: (b) => { const sh = findSheet(b, (n) => n === "data"); return !!sh && findRow(sh.grid, (c) => c.some((x) => x.startsWith("cap (kwh)")) && c.includes("feeder name"), 5) >= 0; },
  parse: (b, ctx) => {
    const sh = findSheet(b, (n) => n === "data")!;
    const t = readTable(sh.grid, DATASETS.CAPS, ctx.yearHint)!;
    return [{ dataset: "CAPS", format: caps.format, rows: t.rows, issues: [] }];
  },
};

const genList: Parser = {
  format: "Generation companies list",
  detect: (b) => b.sheets.some((s) => findRow(s.grid, (c) => c.some((x) => x.includes("name of industry")) && c.some((x) => x.includes("size")), 10) >= 0),
  parse: (b, ctx) => {
    const sh = b.sheets.find((s) => findRow(s.grid, (c) => c.some((x) => x.includes("name of industry")), 10) >= 0)!;
    const t = readTable(sh.grid, DATASETS.GENREG, ctx.yearHint, 2)!;
    const tc = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, a, c) => a + c.toUpperCase());
    const rows = t.rows.map((r) => {
      const cat = norm(r.category).toLowerCase();
      return { ...r, location: r.location ?? r.lga, lga: undefined, fuel: r.fuel ? tc(String(r.fuel)) : undefined, category: cat ? (cat.length <= 3 ? cat.toUpperCase() : tc(cat)) : undefined };
    });
    return [{ dataset: "GENREG", format: genList.format, rows, issues: [] }];
  },
};

// Specific layouts first; the generic heading reader last.
const PARSERS: Parser[] = [forecast, feederClean, feederRaw, billing, caps, genList, sbt, technicalSample, generic];

export async function parseWorkbook(buf: ArrayBuffer | Buffer, ctx: ParseContext): Promise<{ format: string; batches: Batch[] } | { error: string }> {
  let book: Book;
  try { book = await readBook(buf); } catch { return { error: "The file could not be read. Upload an .xlsx or .xlsm workbook (Excel 2007 or later)." }; }
  const p = PARSERS.find((x) => x.detect(book));
  if (!p) return { error: "The layout was not recognised. Download the OGSERC template for the return and copy the figures into it." };
  const batches = p.parse(book, ctx).filter((x) => x.rows.length || x.issues.length);
  if (!batches.length) return { error: "The workbook was recognised but holds no data rows." };
  return { format: p === generic ? formatName(book) : p.format, batches };
}

export const KNOWN_FORMATS = [
  "OGSERC Licensee Monthly Return datasheet (Cover, Feeder List, Feeder Return, Commercial Return)",
  "OGSERC GenCo Monthly Return datasheet (Cover, Unit Return, Plant Return)",
  "OGSERC EMPR market analytics workbook (Feeder Register, Data Entry, Hub Commercial Entry)",
  "OGSERC EMPR generation analytics workbook (Plant Register, Unit Returns, Plant Returns)",
  "OGSERC feeder register and SBT monitoring workbook (register, monthly hours, technical sheets, breach referrals)",
  "OGSERC generation register and plan evaluation workbook (Register, Evaluations)",
  "OGSERC load forecast baseline (Inputs)",
  "OGSERC technical data workbook (LOAD NOMINATION, ENERGY DELIVERED, INTERRUPTION)",
  ...[feederClean, feederRaw, billing, caps, genList].map((p) => p.format),
];
export type { Grid };
