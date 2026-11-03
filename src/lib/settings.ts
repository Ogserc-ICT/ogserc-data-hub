/**
 * Commission settings. Defaults are the values in the EMPR, SBT, generation and forecast workbooks;
 * administrators change them on the Admin page.
 */
export type Target = { key: string; label: string; value: number; dir: "min" | "max"; unit: "pct" | "x" | "kJ" | "n" };

export const DEFAULT_SETTINGS = {
  bandHours: { A: 20, B: 16, C: 12, D: 8, E: 4 } as Record<string, number>,
  /** A feeder-month meets its band when hours ≥ threshold × committed hours (EMPR workbook p_Thr). */
  bandThreshold: 0.98,
  /** SBT monitoring: tolerance below floor and consecutive breach months before referral. */
  sbtTolerance: 0,
  sbtConsecutive: 2,
  deliveryRatioMin: 0.8,
  deliveryRatioMax: 1.05,
  hoursMismatchTolerance: 2,
  flags: { critComp: 0.5, critFul: 0.7, watchComp: 0.8, critAtc: 0.4, watchAtc: 0.25 },
  /** Placeholder targets from the EMPR workbook, to be adopted in a performance-standards instrument. */
  marketTargets: [
    { key: "fulfilment", label: "Fulfilment (supplied ÷ nominated)", value: 0.9, dir: "min", unit: "pct" },
    { key: "compliance", label: "Band compliance", value: 1, dir: "min", unit: "pct" },
    { key: "be", label: "Billing efficiency (kWh)", value: 0.9, dir: "min", unit: "pct" },
    { key: "ce", label: "Collection efficiency", value: 0.9, dir: "min", unit: "pct" },
    { key: "atcc", label: "ATC&C loss (kWh)", value: 0.2, dir: "max", unit: "pct" },
    { key: "atccNgn", label: "ATC&C loss (₦)", value: 0.3, dir: "max", unit: "pct" },
    { key: "meteringRate", label: "Metering rate", value: 0.6, dir: "min", unit: "pct" },
    { key: "estimationRatio", label: "Estimation ratio", value: 1, dir: "max", unit: "x" },
    { key: "complaintResolution", label: "Complaint resolution", value: 0.9, dir: "min", unit: "pct" },
    { key: "receivedVsMetered", label: "Received ÷ feeder-metered", value: 1.1, dir: "max", unit: "x" },
  ] as Target[],
  genFlags: { critAv: 0.5, watchAv: 0.7, critFor: 0.2, watchFor: 0.1, hrLo: 7000, hrHi: 20000, auxHi: 0.1 },
  genTargets: [
    { key: "capAvailability", label: "Capacity availability", value: 0.85, dir: "min", unit: "pct" },
    { key: "capacityFactor", label: "Capacity factor", value: 0.6, dir: "min", unit: "pct" },
    { key: "forcedOutageRate", label: "Forced outage rate", value: 0.05, dir: "max", unit: "pct" },
    { key: "auxRatio", label: "Auxiliary consumption", value: 0.05, dir: "max", unit: "pct" },
    { key: "heatRate", label: "Heat rate (kJ/kWh)", value: 10500, dir: "max", unit: "kJ" },
    { key: "collectionRate", label: "Collection rate", value: 0.9, dir: "min", unit: "pct" },
    { key: "gasFill", label: "Gas supply fill rate", value: 0.9, dir: "min", unit: "pct" },
    { key: "shareOgun", label: "Share of output to Ogun offtakers", value: 0.3, dir: "min", unit: "pct" },
    { key: "lti", label: "Lost-time injuries", value: 0, dir: "max", unit: "n" },
  ] as Target[],
  forecast: { low: 0.04, base: 0.07, high: 0.1, startYear: 2026, endYear: 2036, removeDoubleCount: true },
  planEval: {
    approve: 70, approveWithConditions: 55, returnForRevision: 40, cycleDays: 365, deadlineDays: 60,
    gates: [
      { ref: "G1", name: "Complete submission", requirement: "All sections of the OGSERC plan template completed and signed by the licensee's accountable officer" },
      { ref: "G2", name: "Valid licence", requirement: "Generation licence valid for the plant and capacity in the plan (or application filed for a new plant)" },
      { ref: "G3", name: "Qualified engineer", requirement: "Technical sections signed by a COREN-registered engineer" },
      { ref: "G4", name: "Fuel or resource evidence", requirement: "Signed gas supply agreement, letter of intent or resource assessment covering the plan period" },
      { ref: "G5", name: "Compliance standing", requirement: "No unresolved critical finding or overdue enforcement order against the licensee" },
    ],
    criteria: {
      "Capacity recovery": [
        { ref: "R1", name: "Diagnosis of lost capacity", weight: 15 }, { ref: "R2", name: "Technical remedy", weight: 15 },
        { ref: "R3", name: "Capacity and availability gain", weight: 20 }, { ref: "R4", name: "Fuel supply security", weight: 15 },
        { ref: "R5", name: "Cost reasonableness", weight: 15 }, { ref: "R6", name: "Schedule and financing", weight: 10 },
        { ref: "R7", name: "Evacuation and grid readiness", weight: 5 }, { ref: "R8", name: "Health, safety and environment", weight: 5 },
      ],
      Expansion: [
        { ref: "E1", name: "Need and alignment", weight: 15 }, { ref: "E2", name: "Technical design and standards", weight: 15 },
        { ref: "E3", name: "Grid connection and evacuation", weight: 15 }, { ref: "E4", name: "Fuel or resource supply", weight: 15 },
        { ref: "E5", name: "Economic and tariff impact", weight: 15 }, { ref: "E6", name: "Financing and sponsor capability", weight: 10 },
        { ref: "E7", name: "Schedule realism", weight: 5 }, { ref: "E8", name: "Environmental and social", weight: 10 },
      ],
    } as Record<string, { ref: string; name: string; weight: number }[]>,
  },
};

export type Settings = typeof DEFAULT_SETTINGS;

export function recommendation(s: Settings, gatesPassed: boolean | null, score: number | null): string | null {
  if (gatesPassed === false) return "Return for revision";
  if (score == null) return null;
  const p = s.planEval;
  return score >= p.approve ? "Approve" : score >= p.approveWithConditions ? "Approve with conditions" : score >= p.returnForRevision ? "Return for revision" : "Reject";
}

/** Weighted score out of 100 from 1–5 scores. */
export function weightedScore(criteria: { ref: string; weight: number }[], scores: Record<string, number | null>, keys: string[]): number | null {
  if (!criteria.length || keys.every((k) => scores[k] == null)) return null;
  let total = 0;
  criteria.forEach((cr, i) => { const v = scores[keys[i]]; if (v != null) total += (v / 5) * cr.weight; });
  return Math.round(total);
}

export function targetStatus(t: Target | undefined, v: number | null | undefined): "on" | "off" | null {
  if (!t || v == null || !Number.isFinite(v)) return null;
  return t.dir === "min" ? (v >= t.value ? "on" : "off") : v <= t.value ? "on" : "off";
}
