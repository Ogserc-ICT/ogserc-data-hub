/**
 * OGSERC returns and registers, aligned with the Commission's EMPR workbooks:
 *  - Licensee Monthly Return (Feeder List, Feeder Return, Commercial Return) and the
 *    data dictionary in "OGSERC EMPR Ogun Electricity Market Analytics 2026";
 *  - GenCo Monthly Return (Unit Return, Plant Return) from "OGSERC EMPR Ogun Generation Analytics 2026";
 *  - the Feeder Register and SBT Monitoring, and Generation Register and Plan Evaluation workbooks.
 * Column headings match those workbooks so their sheets import directly.
 */
import type { Issue } from "@/db/schema";

export type DatasetCode =
  | "REGISTER" | "FEEDER" | "COMMERCIAL" | "METERING" | "COMPLAINTS"
  | "GENUNIT" | "GENPLANT" | "CAPS" | "GENREG" | "REFERRALS" | "PLANEVAL" | "FORECAST";

export type ColType = "text" | "number" | "int" | "period" | "date";
export type Column = {
  key: string; header: string; type: ColType; required?: boolean; unit?: string; help?: string; min?: number; max?: number;
  /** Other headings accepted on import. */
  alt?: string[];
  /** Stored in the row's ext JSON rather than its own column. */
  ext?: boolean;
  /** A core field: missing values are reported as incomplete. */
  core?: boolean;
};

export type DatasetDef = {
  code: DatasetCode; label: string; short: string;
  filer: "licensee" | "commission"; periodic: boolean; grain: string;
  sheet: string; columns: Column[]; keyCols: string[];
  /** Licensee datasets owed each month (others are registers or Commission records). */
  monthly?: boolean;
};

export const BAND_HOURS: Record<string, number> = { A: 20, B: 16, C: 12, D: 8, E: 4 };
export const BANDS = ["A", "B", "C", "D", "E"] as const;
export const SEGMENTS = ["MD", "NMD", "Mixed"] as const;
export const TARIFF_CLASSES = ["NMD", "MD1", "MD2", "Mixed"] as const;
export const COMPLAINT_CATEGORIES = ["Billing", "Metering", "Supply interruption", "Voltage quality", "Disconnection", "New connection", "Customer service", "Other"] as const;
export const REFERRAL_STATUSES = ["Draft", "Referred to Compliance", "Compliance notice issued", "Remedied", "Band downgraded", "Closed — no action"] as const;

const c = (key: string, header: string, type: ColType, o: Partial<Column> = {}): Column => ({ key, header, type, ...o });
const n = (key: string, header: string, unit: string, o: Partial<Column> = {}) => c(key, header, "number", { unit, min: 0, ...o });
const i = (key: string, header: string, o: Partial<Column> = {}) => c(key, header, "int", { unit: "count", min: 0, ...o });
const MONTH = c("period", "Month", "period", { required: true, help: "Reporting month: 2026-07, Jul-2026 or July (year from the cover)", alt: ["Period (YYYY-MM)", "Reporting month", "Month (cap)"] });
const LIC = c("licenseeCode", "Licensee code", "text", { help: "OGSERC licensee code, e.g. IBEDC. Needed only when one workbook carries several licensees.", alt: ["Licensee"] });
const DQ = [
  c("reference", "Submission ref.", "text", { ext: true, alt: ["Submission reference"] }),
  c("dataSource", "Data source", "text", { ext: true }),
  c("remarks", "Remarks", "text", { ext: true }),
];

export const DATASETS: Record<DatasetCode, DatasetDef> = {
  REGISTER: {
    code: "REGISTER", label: "Feeder register", short: "Feeder register", filer: "licensee", periodic: false,
    grain: "One row per feeder; updates the register (nothing is deleted)", sheet: "Feeder List", keyCols: ["feeder"],
    columns: [
      LIC,
      c("feederCode", "Feeder ID", "text", { help: "OGSERC Feeder ID, e.g. OGF-33-0001 or OGF-11-0002. Issued by OGSERC only; put the licensee's own feeder codes in 'Other IDs and names'." }),
      c("feeder", "Feeder name", "text", { required: true }),
      c("hub", "Business unit", "text", { required: true, alt: ["Business hub"] }),
      c("voltage", "Voltage (kV)", "text", { required: true, help: "33 or 11" }),
      c("level", "Level", "text", { help: "Injection (33 kV point) or Fed (draws through a parent)" }),
      c("parent", "Parent 33 kV injection point", "text", { help: "For Fed feeders: the parent's Feeder ID or name", alt: ["Parent 33 kV Feeder ID"] }),
      c("band", "Current band", "text", { required: true, alt: ["Tariff band", "SBT band"] }),
      c("segment", "Customer segment (MD / NMD / Mixed)", "text", { alt: ["Customer segment"] }),
      c("tariffClass", "Tariff class (NMD / MD1 / MD2 / Mixed)", "text"),
      c("classificationBasis", "Classification basis", "text"),
      c("substation", "Transmission / injection substation", "text", { ext: true, alt: ["Source substation / parent"] }),
      n("ratingMva", "Feeder rating (MVA)", "MVA", { ext: true }),
      n("routeKm", "Route length (km)", "km", { ext: true }),
      i("dtCount", "No. of DTs", { ext: true }),
      n("dtKva", "Installed DT capacity (kVA)", "kVA", { ext: true }),
      i("customers", "Customers connected", { ext: true, alt: ["Customers"] }),
      i("meteredCustomers", "Metered customers", { ext: true }),
      c("loadType", "Dominant load type", "text", { ext: true }),
      c("lga", "LGA", "text", { ext: true }),
      c("status", "Status", "text"),
      c("bandEffectiveFrom", "Band effective from", "date", { ext: true }),
      c("altIds", "Other IDs and names", "text", { help: "The licensee's own feeder codes and other names for this feeder, separated by ;", alt: ["Licensee's own IDs and other names (separate with ;)"] }),
      c("remarks", "Remarks", "text", { ext: true, alt: ["Notes"] }),
    ],
  },
  FEEDER: {
    code: "FEEDER", label: "Feeder return", short: "Feeders", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per feeder per month", sheet: "Feeder Return", keyCols: ["feederCode", "feeder"],
    columns: [
      LIC, MONTH,
      c("feederCode", "Feeder ID", "text", { help: "As held in the feeder register" }),
      c("feeder", "Feeder name", "text"),
      c("band", "Band this month", "text", { help: "A–E; blank uses the register band", alt: ["Service band (A–E)", "Band"] }),
      n("nominatedMwh", "Energy nominated (MWh)", "MWh", { core: true, alt: ["Energy nominated / allocated"] }),
      n("deliveredMwh", "Energy supplied (MWh)", "MWh", { core: true, alt: ["Energy delivered"] }),
      n("hoursPerDay", "Avg supply hours/day", "h/day", { core: true, max: 24, alt: ["Avg. hours of supply per day"] }),
      n("peakLoadMw", "Peak load (MW)", "MW", { ext: true }),
      n("avgLoadMw", "Average load (MW)", "MW", { ext: true }),
      n("powerFactor", "Power factor", "0–1", { ext: true, max: 1 }),
      n("maxKv", "Max voltage (kV)", "kV", { ext: true }),
      n("minKv", "Min voltage (kV)", "kV", { ext: true }),
      i("interruptions", "Total interruptions", { core: true, alt: ["Number of interruptions"] }),
      i("faultTrips", "Fault trips", { ext: true }),
      i("plannedOutages", "Planned outages", { ext: true }),
      i("loadShedding", "Load-shedding events", { ext: true }),
      i("upstreamEvents", "Upstream (TCN/grid) events", { ext: true }),
      n("outageHours", "Total outage duration (h)", "h", { ext: true }),
      n("faultOutageHours", "Fault outage duration (h)", "h", { ext: true }),
      i("customersConnected", "Customers connected", { ext: true }),
      i("customerInterruptions", "Customer interruptions", { ext: true }),
      n("customerHours", "Customer-hours interrupted", "customer-h", { ext: true }),
      i("dtFailures", "DT failures", { ext: true }),
      i("lineFaults", "Line/cable faults", { ext: true }),
      i("overloadedDts", "Overloaded DTs", { ext: true }),
      i("customersBilled", "Customers billed", { ext: true }),
      i("meteredBilled", "Metered customers billed", { ext: true }),
      n("energyBilledMwh", "Energy billed (MWh)", "MWh", { ext: true }),
      n("amountBilledNgn", "Amount billed (₦)", "₦", { ext: true }),
      n("amountCollectedNgn", "Amount collected (₦)", "₦", { ext: true }),
      ...DQ,
      // carried by older layouts; used to register feeders the Hub has not seen
      c("voltage", "Voltage", "text", { alt: ["Voltage (33kV/11kV)", "Voltage (kV)"] }),
      c("hub", "Business unit", "text", { alt: ["Business hub"] }),
      c("parent", "Upstream 33kV feeder", "text", { alt: ["Upstream 33kV feeder (11kV only)", "Parent 33 kV injection point"] }),
    ],
  },
  COMMERCIAL: {
    code: "COMMERCIAL", label: "Commercial return by business unit", short: "Commercial", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per business unit per month", sheet: "Commercial Return", keyCols: ["hub"],
    columns: [
      LIC, MONTH,
      c("hub", "Business unit", "text", { required: true, alt: ["Business hub"] }),
      i("custMeteredMd", "Customers — Metered MD", { core: true, alt: ["Customers: metered MD"] }),
      i("custMeteredNmd", "Customers — Metered NMD", { core: true, alt: ["Customers: metered non-MD"] }),
      i("custUnmeteredMd", "Customers — Unmetered MD", { core: true, alt: ["Customers: unmetered MD"] }),
      i("custUnmeteredNmd", "Customers — Unmetered NMD", { core: true, alt: ["Customers: unmetered non-MD"] }),
      n("energyReceivedKwh", "Energy received (kWh)", "kWh", { core: true, alt: ["Energy received"] }),
      n("energyReceivedNgn", "Value of energy received (₦)", "₦", { alt: ["Energy received at tariff"] }),
      n("billedKwhMeteredMd", "Billed kWh — Metered MD", "kWh", { core: true, alt: ["Energy billed: metered MD"] }),
      n("billedKwhMeteredNmd", "Billed kWh — Metered NMD", "kWh", { core: true, alt: ["Energy billed: metered non-MD"] }),
      n("billedKwhUnmeteredMd", "Billed kWh — Unmetered MD", "kWh", { core: true, alt: ["Energy billed: unmetered MD"] }),
      n("billedKwhUnmeteredNmd", "Billed kWh — Unmetered NMD", "kWh", { core: true, alt: ["Energy billed: unmetered non-MD"] }),
      n("billedNgnMeteredMd", "Billed ₦ — Metered MD", "₦", { ext: true, core: true }),
      n("billedNgnMeteredNmd", "Billed ₦ — Metered NMD", "₦", { ext: true, core: true }),
      n("billedNgnUnmeteredMd", "Billed ₦ — Unmetered MD", "₦", { ext: true, core: true }),
      n("billedNgnUnmeteredNmd", "Billed ₦ — Unmetered NMD", "₦", { ext: true, core: true }),
      n("collectedNgnMd", "Collected ₦ — MD", "₦", { core: true, alt: ["Amount collected: MD"] }),
      n("collectedNgnNmd", "Collected ₦ — NMD", "₦", { core: true, alt: ["Amount collected: non-MD"] }),
      n("arrearsNgn", "Of which arrears recovered (₦)", "₦"),
      i("newMeters", "New meters installed", { ext: true }),
      i("complaintsReceived", "Complaints received", { ext: true }),
      i("complaintsResolved", "Complaints resolved", { ext: true }),
      ...DQ,
    ],
  },
  METERING: {
    code: "METERING", label: "Meter deployment by financing route", short: "Metering", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per business unit per month", sheet: "Metering Return", keyCols: ["hub"],
    columns: [
      LIC, MONTH,
      c("hub", "Business unit", "text", { required: true, alt: ["Business hub"] }),
      i("installedMap", "Meters installed — MAP", { core: true, alt: ["Meters installed: MAP"] }),
      i("installedMaf", "Meters installed — MAF", { core: true, alt: ["Meters installed: MAF"] }),
      i("installedVendor", "Meters installed — vendor-financed", { core: true, alt: ["Meters installed: vendor-financed"] }),
      i("installedDisco", "Meters installed — licensee-financed", { core: true, alt: ["Meters installed: licensee-financed"] }),
      i("replaced", "Faulty meters replaced"),
      i("faultyReported", "Faulty meters reported"),
      i("pendingApplications", "Metering applications pending at month end"),
    ],
  },
  COMPLAINTS: {
    code: "COMPLAINTS", label: "Customer complaints by category", short: "Complaints", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per complaint category per month", sheet: "Complaints Return", keyCols: ["category"],
    columns: [
      LIC, MONTH,
      c("category", "Category", "text", { required: true, help: COMPLAINT_CATEGORIES.join(", ") }),
      i("received", "Complaints received", { required: true }),
      i("resolved", "Complaints resolved", { required: true }),
      i("resolvedInTime", "Resolved within standard time"),
      i("escalated", "Escalated to Forum or OGSERC"),
    ],
  },
  GENUNIT: {
    code: "GENUNIT", label: "Generating unit return", short: "Unit returns", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per generating unit per month", sheet: "Unit Return", keyCols: ["unitCode"],
    columns: [
      LIC, MONTH,
      c("plantCode", "Plant ID", "text", { required: true }),
      c("unitCode", "Unit ID", "text", { required: true }),
      c("unitName", "Unit name", "text", { ext: true }),
      n("installedMw", "Installed capacity (MW)", "MW", { core: true }),
      n("availableMw", "Average available capacity (MW)", "MW", { core: true }),
      n("dependableMw", "Dependable capacity (MW)", "MW", { ext: true }),
      n("peakMw", "Peak generation (MW)", "MW", { ext: true }),
      n("grossMwh", "Gross generation (MWh)", "MWh", { ext: true, core: true }),
      n("auxMwh", "Auxiliary consumption (MWh)", "MWh", { ext: true }),
      n("netMwh", "Net energy sent out (MWh)", "MWh", { core: true }),
      n("operatingHours", "Operating hours", "h", { core: true, max: 744 }),
      n("availableHours", "Available hours", "h", { ext: true, core: true, max: 744 }),
      n("plannedOutageHours", "Planned outage hours", "h", { ext: true, core: true }),
      n("forcedOutageHours", "Forced outage hours", "h", { core: true }),
      i("forcedTrips", "Forced trips", { ext: true }),
      i("starts", "Starts", { ext: true }),
      n("cGas", "Gas / fuel constraint (avg MW)", "MW", { ext: true }),
      n("cGrid", "Grid / evacuation constraint (avg MW)", "MW", { ext: true }),
      n("cOfftaker", "Offtaker / dispatch constraint (avg MW)", "MW", { ext: true }),
      n("cTechnical", "Technical constraint (avg MW)", "MW", { ext: true }),
      n("cOther", "Other constraint (avg MW)", "MW", { ext: true }),
      n("fuelQty", "Fuel consumed (quantity)", "plant unit", { ext: true }),
      n("fuelGj", "Fuel energy consumed (GJ)", "GJ", { ext: true }),
      n("co2T", "CO2 emitted (tonnes)", "t", { ext: true }),
      ...DQ,
    ],
  },
  GENPLANT: {
    code: "GENPLANT", label: "Generating plant return", short: "Plant returns", filer: "licensee", periodic: true, monthly: true,
    grain: "One row per plant per month", sheet: "Plant Return", keyCols: ["plantCode"],
    columns: [
      LIC, MONTH,
      c("plantCode", "Plant ID", "text", { required: true }),
      n("toOgunDiscos", "To Ogun DisCos / state networks (MWh)", "MWh", { ext: true, core: true }),
      n("toOgunBilateral", "To bilateral customers in Ogun (MWh)", "MWh", { ext: true, core: true }),
      n("toGrid", "To national grid / bulk trader (MWh)", "MWh", { ext: true, core: true }),
      n("toOther", "Other offtake (MWh)", "MWh", { ext: true }),
      n("contractedMw", "Contracted capacity (MW)", "MW", { ext: true }),
      n("energyInvoiced", "Energy invoiced (₦)", "₦", { ext: true }),
      n("capacityInvoiced", "Capacity invoiced (₦)", "₦", { ext: true }),
      n("received", "Amount received (₦)", "₦", { ext: true }),
      n("receivables", "Receivables outstanding (₦)", "₦", { ext: true }),
      n("gasNominated", "Gas nominated (MMSCF)", "MMSCF", { ext: true }),
      n("gasDelivered", "Gas delivered (MMSCF)", "MMSCF", { ext: true }),
      n("gasPrice", "Gas price (US$/MMBtu)", "US$/MMBtu", { ext: true }),
      n("fuelCost", "Fuel cost (₦)", "₦", { ext: true }),
      i("lti", "Lost-time injuries", { ext: true }),
      i("envIncidents", "Environmental incidents", { ext: true }),
      i("dispatchNonCompliance", "Dispatch instructions not complied", { ext: true }),
      ...DQ,
    ],
  },
  CAPS: {
    code: "CAPS", label: "Energy caps for unmetered customers", short: "Energy caps", filer: "commission", periodic: true,
    grain: "One row per feeder per month, from the NERC/OGSERC caps order", sheet: "Energy Caps", keyCols: ["feeder"],
    columns: [
      MONTH,
      c("hub", "Business unit", "text", { required: true }),
      c("feeder", "Feeder name", "text", { required: true }),
      c("band", "Service band", "text"),
      n("capKwh", "Cap (kWh)", "kWh", { required: true, alt: ["Monthly cap per customer"] }),
    ],
  },
  GENREG: {
    code: "GENREG", label: "Generation register", short: "Gen. register", filer: "commission", periodic: false,
    grain: "One row per plant; matched by Plant ID or name and updated (nothing is deleted)", sheet: "Plant Register", keyCols: ["name", "location"],
    columns: [
      c("code", "Plant ID", "text", { help: "OGSERC Plant ID, e.g. GP-001 (units: GP-001-U01). Licensee plant IDs (P01) are kept as other IDs." }),
      c("name", "Plant name", "text", { required: true, alt: ["Name of company or IPP", "Name of industry or IPP"] }),
      c("owner", "Owner / licensee", "text", { alt: ["Owner / operator"] }),
      c("licenseeCode", "Licensee code", "text", { alt: ["Licensee"] }),
      c("permitStatus", "Licence status", "text", { alt: ["Regulatory status", "Licence / permit status"] }),
      c("licenceNo", "Licence no.", "text"),
      c("category", "Connection", "text", { alt: ["Generation type"] }),
      c("technology", "Technology", "text", { alt: ["Fuel / technology"] }),
      c("fuel", "Primary fuel", "text", { alt: ["Fuel", "Type of fuel"] }),
      i("units", "Units (no.)", { alt: ["No. of units"] }),
      n("capacityMw", "Installed capacity (MW)", "MW", { alt: ["Size"] }),
      n("availableMw", "Available capacity (MW)", "MW"),
      n("connectionKv", "Connection voltage (kV)", "kV"),
      c("connectionPoint", "Connection point", "text", { alt: ["Grid connection"] }),
      c("offtake", "Offtake", "text", { alt: ["Main offtaker"] }),
      n("contractedOgunMw", "Capacity contracted to Ogun load (MW)", "MW"),
      c("lga", "LGA", "text", { alt: ["LGA / location"] }),
      c("location", "Location", "text", { alt: ["Site address / location"] }),
      c("lat", "Latitude", "number"),
      c("lon", "Longitude", "number"),
      c("year", "Year commissioned", "int", { alt: ["COD year"] }),
      c("status", "Status", "text"),
      c("fuelSupplier", "Fuel supplier / contract", "text"),
      c("lastPlan", "Last plan submitted", "date"),
      c("nextPlanDue", "Next plan due", "date"),
      c("planStatus", "Plan status", "text"),
      c("verified", "Verified with GenCo", "text"),
      c("notes", "Source / notes", "text", { alt: ["Remarks", "Data basis"] }),
    ],
  },
  REFERRALS: {
    code: "REFERRALS", label: "SBT breach referrals", short: "Referrals", filer: "commission", periodic: false,
    grain: "One row per referral; matched by referral number and updated", sheet: "Breach referrals", keyCols: ["ref"],
    columns: [
      c("ref", "Referral no.", "text", { required: true }),
      c("referredOn", "Date referred", "date", { required: true }),
      c("licenseeCode", "Licensee", "text"),
      c("feederCode", "Feeder ID", "text"),
      c("feeder", "Feeder name", "text", { required: true }),
      c("band", "Band", "text"),
      n("floorHours", "Floor (h/day)", "h/day"),
      c("hub", "Hub", "text"),
      i("monthsBreached", "Months breached in a row", { alt: ["Months breached in run"] }),
      n("avgHours", "Average hours, period", "h/day"),
      n("shortfall", "Shortfall vs floor", "h/day"),
      c("dataQualityFlag", "Data quality flag", "text"),
      c("referredBy", "Referred by", "text"),
      c("status", "Status", "text", { required: true }),
      c("caseNo", "Compliance case no.", "text"),
      c("closedOn", "Date closed", "date"),
      c("notes", "Outcome / notes", "text"),
    ],
  },
  PLANEVAL: {
    code: "PLANEVAL", label: "GenCo plan evaluations", short: "Plan evaluations", filer: "commission", periodic: false,
    grain: "One row per plan; matched by evaluation ID and updated", sheet: "Evaluations", keyCols: ["id"],
    columns: [
      c("id", "Eval ID", "text", { required: true }),
      c("plantCode", "Plant ID", "text"),
      c("plantName", "Plant name", "text", { required: true }),
      c("planType", "Plan type", "text", { required: true }),
      c("receivedOn", "Date received", "date", { required: true }),
      c("decidedOn", "Date of decision", "date"),
      ...["G1", "G2", "G3", "G4", "G5"].map((g) => c(g, g, "text")),
      ...["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"].map((s) => c(s, s, "number", { min: 1, max: 5 })),
      c("leadEvaluator", "Lead evaluator", "text"),
      c("conditions", "Key conditions / reasons", "text"),
    ],
  },
  FORECAST: {
    code: "FORECAST", label: "Load forecast assumptions", short: "Forecast inputs", filer: "commission", periodic: false,
    grain: "Growth scenarios and horizon (updates Settings)", sheet: "Inputs", keyCols: ["key"],
    columns: [c("key", "Setting", "text", { required: true }), c("value", "Value", "text", { required: true })],
  },
};

export const LICENSEE_MONTHLY: DatasetCode[] = ["FEEDER", "COMMERCIAL", "METERING", "COMPLAINTS", "GENUNIT", "GENPLANT"];
export const LICENSEE_DATASETS: DatasetCode[] = ["REGISTER", ...LICENSEE_MONTHLY];
export const COMMISSION_DATASETS: DatasetCode[] = ["CAPS", "GENREG", "REFERRALS", "PLANEVAL", "FORECAST"];
export const isDataset = (x: unknown): x is DatasetCode => typeof x === "string" && x in DATASETS;

// ------------------------------------------------------------------ normalisation helpers

export const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
/** Display-level key: upper case, "33 kV" → "33KV". */
export const nameKey = (s: unknown) =>
  norm(s).toUpperCase().replace(/(\d+)\s*K\s*V\b/g, "$1KV").replace(/\s*_\s*/g, "_").replace(/\s+/g, " ");
const ROMAN: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5" };
/** Matching key used across workbooks: ignores case, spacing, punctuation, the word FEEDER and Roman numerals. */
export const looseKey = (s: unknown) =>
  norm(s).toUpperCase().replace(/_/g, " ").replace(/(\d+)\s*K\s*V\b/g, "$1KV")
    .replace(/\b(I{1,3}|IV|V)\b/g, (m) => ROMAN[m] ?? m).replace(/\bFEEDERS?\b/g, "").replace(/[^A-Z0-9]/g, "");
/** Plant matching key: drops company and station words so "Olorunsogo II NIPP Power Station" ≈ "Olorunsogo II Power Station (NIPP)". */
export const plantKey = (s: unknown) =>
  norm(s).toUpperCase().replace(/\(.*?\)/g, " ").replace(/\b(POWER|STATION|PLANT|NIPP|LIMITED|LTD|PLC|COMPANY|CO|NIGERIA|NIG|GENERATION)\b/g, " ")
    .replace(/\b(I{1,3}|IV|V)\b/g, (m) => ROMAN[m] ?? m).replace(/[^A-Z0-9]/g, "");

export function parseBand(v: unknown): { band: string; hours: number } | null {
  const m = norm(v).toUpperCase().match(/^(?:BAND\s*)?([A-E])(?:\s*(\d+)\s*H(?:RS?)?)?$/);
  if (!m) return null;
  return { band: m[1], hours: m[2] ? Number(m[2]) : BAND_HOURS[m[1]] };
}
export function parseVoltage(v: unknown, feederName = ""): "33kV" | "11kV" | "Other" {
  const raw = norm(v);
  if (raw === "33" || /^33\s*kv$/i.test(raw)) return "33kV";
  if (raw === "11" || /^11\s*kv$/i.test(raw)) return "11kV";
  const s = feederName.toUpperCase().replace(/\s/g, "");
  if (/33KV/.test(s)) return "33kV";
  if (/11KV/.test(s)) return "11kV";
  return "Other";
}
export function toNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && v && "result" in v) return toNumber((v as { result: unknown }).result);
  const s = String(v).replace(/[,₦\s]/g, "").replace(/(MW|kWh|MWh|%)$/i, "");
  if (s === "" || s === "-") return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

// ------------------------------------------------------------------ validation

/** Field and cross-field checks. Errors block filing; warnings are filed and reviewed. */
export function validateRows(code: DatasetCode, rows: Record<string, unknown>[]): Issue[] {
  const def = DATASETS[code];
  const issues: Issue[] = [];
  const seen = new Set<string>();
  rows.forEach((r) => {
    const period = typeof r.period === "string" ? r.period : undefined;
    const ref = def.keyCols.map((k) => norm(r[k])).filter(Boolean).join(" · ") || "row";
    const missingCore: string[] = [];
    for (const col of def.columns) {
      const v = r[col.key];
      if (v == null || v === "") {
        if (col.required) issues.push({ level: "error", period, ref, message: `${col.header} is missing.` });
        else if (col.core) missingCore.push(col.header);
        continue;
      }
      if (col.type === "number" || col.type === "int") {
        if (typeof v !== "number" || !Number.isFinite(v)) { issues.push({ level: "error", period, ref, message: `${col.header} is not a number.` }); continue; }
        if (col.min != null && v < col.min) issues.push({ level: "warning", period, ref, message: `${col.header} is below ${col.min}, which is not possible (${round(v)}).` });
        if (col.max != null && v > col.max) issues.push({ level: "warning", period, ref, message: `${col.header} exceeds ${col.max}, which is not possible (${round(v)}).` });
      }
    }
    if (missingCore.length && def.periodic) issues.push({ level: "warning", period, ref, message: `Core fields not reported: ${missingCore.length > 3 ? `${missingCore.length} fields` : missingCore.join(", ")}.` });
    if ((code === "FEEDER" || code === "REGISTER") && !r.feeder && !r.feederCode) issues.push({ level: "error", period, ref, message: "Give the Feeder ID or the feeder name." });
    const dup = `${period}|${r.licenseeCode ?? ""}|${def.keyCols.map((k) => looseKey(r[k])).join("|")}`;
    if (seen.has(dup)) issues.push({ level: "error", period, ref, message: "Appears more than once." });
    seen.add(dup);
    issues.push(...crossChecks(code, r).map((message) => ({ level: "warning" as const, period, ref, message })));
  });
  return issues;
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);
const has = (v: unknown) => typeof v === "number";
const round = (v: number) => Math.round(v * 100) / 100;

function crossChecks(code: DatasetCode, r: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (code === "FEEDER") {
    if (r.band && !parseBand(r.band)) out.push(`Band "${r.band}" is not A–E.`);
    if (has(r.nominatedMwh) && num(r.nominatedMwh) === 0 && num(r.deliveredMwh) > 0) out.push("Energy supplied against zero nomination.");
    if (num(r.nominatedMwh) > 0 && num(r.deliveredMwh) > num(r.nominatedMwh) * 1.05) out.push(`Supplied ${round(num(r.deliveredMwh))} MWh exceeds nomination ${round(num(r.nominatedMwh))} MWh.`);
    if (num(r.hoursPerDay) > 0 && has(r.deliveredMwh) && num(r.deliveredMwh) === 0) out.push("Hours of supply reported with zero energy supplied.");
    if (has(r.faultTrips) && has(r.interruptions) && num(r.faultTrips) + num(r.plannedOutages) + num(r.loadShedding) + num(r.upstreamEvents) > num(r.interruptions)) out.push("Interruption causes add up to more than total interruptions.");
    if (has(r.minKv) && has(r.maxKv) && num(r.minKv) > num(r.maxKv)) out.push("Minimum voltage above maximum voltage.");
    if (has(r.peakLoadMw) && has(r.avgLoadMw) && num(r.avgLoadMw) > num(r.peakLoadMw)) out.push("Average load above peak load.");
    if (has(r.meteredBilled) && num(r.meteredBilled) > num(r.customersBilled)) out.push("Metered customers billed exceed customers billed.");
    if (has(r.amountCollectedNgn) && has(r.amountBilledNgn) && num(r.amountBilledNgn) > 0 && num(r.amountCollectedNgn) > num(r.amountBilledNgn) * 1.25) out.push("Feeder collections exceed 125% of billing.");
  }
  if (code === "REGISTER") {
    if (r.band && !parseBand(r.band)) out.push(`Band "${r.band}" is not A–E.`);
    if (r.segment && !(SEGMENTS as readonly string[]).includes(String(r.segment))) out.push(`Segment "${r.segment}" is not MD, NMD or Mixed.`);
    if (r.tariffClass && !(TARIFF_CLASSES as readonly string[]).includes(String(r.tariffClass))) out.push(`Tariff class "${r.tariffClass}" is not NMD, MD1, MD2 or Mixed.`);
    if (norm(r.level) === "Fed" && !r.parent) out.push("Fed feeder has no parent injection point.");
    if (has(r.meteredCustomers) && num(r.meteredCustomers) > num(r.customers)) out.push("Metered customers exceed customers connected.");
  }
  if (code === "COMMERCIAL") {
    const billed = num(r.billedKwhMeteredMd) + num(r.billedKwhMeteredNmd) + num(r.billedKwhUnmeteredMd) + num(r.billedKwhUnmeteredNmd);
    if (billed > num(r.energyReceivedKwh)) out.push("Energy billed exceeds energy received.");
    const billedNgn = num(r.billedNgnMeteredMd) + num(r.billedNgnMeteredNmd) + num(r.billedNgnUnmeteredMd) + num(r.billedNgnUnmeteredNmd);
    const coll = num(r.collectedNgnMd) + num(r.collectedNgnNmd);
    if (billedNgn > 0 && coll > billedNgn * 1.25) out.push("Collections exceed 125% of billing; confirm arrears recovered.");
    if (billedNgn > 0 && coll > billedNgn && !has(r.arrearsNgn)) out.push("Collections exceed billing but arrears recovered is not reported.");
    if (has(r.arrearsNgn) && num(r.arrearsNgn) > coll) out.push("Arrears recovered exceed total collections.");
    if (billed > 0 && billedNgn === 0) out.push("Energy billed with zero amount billed.");
    if (has(r.complaintsResolved) && num(r.complaintsResolved) > num(r.complaintsReceived)) out.push("Complaints resolved exceed complaints received.");
  }
  if (code === "COMPLAINTS") {
    if (num(r.resolved) > num(r.received)) out.push("Resolved exceeds received (carry-over must be explained).");
    if (has(r.resolvedInTime) && num(r.resolvedInTime) > num(r.resolved)) out.push("Resolved within standard time exceeds resolved.");
    if (r.category && !(COMPLAINT_CATEGORIES as readonly string[]).includes(String(r.category))) out.push(`Category "${r.category}" is not a standard category; reported as Other.`);
  }
  if (code === "GENUNIT") {
    if (num(r.availableMw) > num(r.installedMw)) out.push("Available capacity exceeds installed capacity.");
    if (has(r.grossMwh) && num(r.netMwh) > num(r.grossMwh)) out.push("Net energy exceeds gross generation.");
    if (has(r.auxMwh) && has(r.grossMwh) && num(r.grossMwh) > 0 && num(r.auxMwh) / num(r.grossMwh) > 0.1) out.push("Auxiliary consumption above 10% of gross generation.");
    if (num(r.operatingHours) + num(r.plannedOutageHours) + num(r.forcedOutageHours) > 745) out.push("Operating and outage hours exceed the hours in the month.");
    if (has(r.fuelGj) && num(r.netMwh) > 0) { const hr = (num(r.fuelGj) * 1000) / num(r.netMwh); if (hr < 7000 || hr > 20000) out.push(`Heat rate ${Math.round(hr)} kJ/kWh is outside 7,000–20,000.`); }
  }
  if (code === "GENPLANT") {
    if (has(r.gasDelivered) && has(r.gasNominated) && num(r.gasDelivered) > num(r.gasNominated) * 1.1) out.push("Gas delivered exceeds nomination by more than 10%.");
  }
  return out;
}

// ------------------------------------------------------------------ Commission operational indicators

export type Indicator = { key: string; label: string; group: string; unit?: string };
export const COMMISSION_INDICATORS: Indicator[] = [
  { key: "lic_applications", label: "Licence and permit applications received", group: "Licensing" },
  { key: "lic_issued", label: "Licences issued", group: "Licensing" },
  { key: "permits_issued", label: "Captive, embedded and mini-grid permits issued", group: "Licensing" },
  { key: "lic_pending", label: "Applications pending at month end", group: "Licensing" },
  { key: "inspections", label: "Compliance inspections and feeder audits", group: "Compliance and enforcement" },
  { key: "notices", label: "Compliance notices and directives issued", group: "Compliance and enforcement" },
  { key: "band_reclass", label: "Feeders re-banded by Commission order", group: "Compliance and enforcement" },
  { key: "sanctions_ngn", label: "Sanctions imposed", group: "Compliance and enforcement", unit: "₦" },
  { key: "ccu_received", label: "Complaints and appeals received at OGSERC", group: "Consumer protection" },
  { key: "ccu_resolved", label: "Complaints and appeals resolved by OGSERC", group: "Consumer protection" },
  { key: "hearings", label: "Hearings and forum sittings held", group: "Consumer protection" },
  { key: "instruments", label: "Regulations, orders and directives issued", group: "Regulatory instruments" },
  { key: "consultations", label: "Public consultations and stakeholder engagements", group: "Regulatory instruments" },
  { key: "staff_in_post", label: "Staff in post", group: "Institution" },
  { key: "vacancies", label: "Approved positions vacant", group: "Institution" },
];
