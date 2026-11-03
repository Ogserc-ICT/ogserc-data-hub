import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { daysIn, window } from "./periods";
import { getSettings } from "./settings-db";
import { recommendation, weightedScore, type Settings } from "./settings";

const sum = (xs: (number | null | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const e = (x: Record<string, unknown>, k: string) => (typeof x[k] === "number" ? (x[k] as number) : null);
const r = (a: number, b: number) => (b ? a / b : null);

/** Generation KPIs on the EMPR generation workbook's method, plus the register and plan cycle. */
export async function generation(period: string) {
  const s = await getSettings();
  const months = window(period, 7);
  const [assets, units, plantRows, evals, lics] = await Promise.all([
    db.select().from(schema.generationAssets),
    db.select().from(schema.genUnitMonthly).where(inArray(schema.genUnitMonthly.period, months)),
    db.select().from(schema.genPlantMonthly).where(eq(schema.genPlantMonthly.period, period)),
    db.select().from(schema.planEvaluations),
    db.select().from(schema.licensees),
  ]);
  const cap = (xs: typeof assets) => sum(xs.map((a) => a.capacityMw));
  const group = (key: (a: (typeof assets)[number]) => string) => [...new Set(assets.map(key))].map((k) => ({ key: k, plants: assets.filter((a) => key(a) === k).length, capacity: cap(assets.filter((a) => key(a) === k)) })).sort((a, b) => b.capacity - a.capacity);

  const kpis = (us: typeof units) => {
    const hours = (u: (typeof units)[number]) => daysIn(u.period) * 24;
    const inst = sum(us.map((u) => (u.installedMw ?? 0) * hours(u))), avail = sum(us.map((u) => (u.availableMw ?? 0) * hours(u)));
    const net = sum(us.map((u) => u.netMwh)), gross = sum(us.map((u) => e(u.ext, "grossMwh"))), aux = sum(us.map((u) => e(u.ext, "auxMwh")));
    const op = sum(us.map((u) => u.operatingHours)), fo = sum(us.map((u) => u.forcedOutageHours));
    const fuelRows = us.filter((u) => e(u.ext, "fuelGj") != null && (u.netMwh ?? 0) > 0);
    const heatRate = fuelRows.length ? (sum(fuelRows.map((u) => e(u.ext, "fuelGj"))) * 1000) / sum(fuelRows.map((u) => u.netMwh)) : null;
    const lost = (k: string) => sum(us.map((u) => (e(u.ext, k) ?? 0) * hours(u)));
    return {
      units: us.length, installedMw: sum([...new Map(us.map((u) => [u.unitCode, u.installedMw])).values()]), netMwh: net,
      capAvailability: r(avail, inst), capacityFactor: r(net, inst), timeAvailability: r(sum(us.map((u) => e(u.ext, "availableHours"))), sum(us.map(hours))),
      forcedOutageRate: r(fo, fo + op), auxRatio: r(aux, gross), heatRate, efficiency: heatRate ? 3600 / heatRate : null,
      lost: { gas: lost("cGas"), grid: lost("cGrid"), offtaker: lost("cOfftaker"), technical: lost("cTechnical"), other: lost("cOther") },
      co2: sum(us.map((u) => e(u.ext, "co2T"))),
    };
  };
  const cur = units.filter((u) => u.period === period);
  const plantKpis = [...new Set(cur.map((u) => `${u.licenseeId}|${u.plantCode}`))].map((k) => {
    const [lic, code] = k.split("|");
    const l = lics.find((x) => x.id === lic);
    const asset = assets.find((a) => a.aliases.includes(`${(l?.code || lic).toUpperCase()}:${code.toUpperCase()}`) || a.code === code);
    const pr = plantRows.find((p) => p.licenseeId === lic && p.plantCode === code);
    const x = pr?.ext ?? {};
    const delivered = sum(["toOgunDiscos", "toOgunBilateral", "toGrid", "toOther"].map((f) => e(x, f)));
    return {
      plant: asset?.name ?? `${l?.code ?? lic} ${code}`, licensee: l?.code ?? lic, ...kpis(cur.filter((u) => u.licenseeId === lic && u.plantCode === code)),
      shareOgun: r(sum([e(x, "toOgunDiscos"), e(x, "toOgunBilateral")]), delivered), collectionRate: r(e(x, "received") ?? 0, sum([e(x, "energyInvoiced"), e(x, "capacityInvoiced")])),
      gasFill: r(e(x, "gasDelivered") ?? 0, e(x, "gasNominated") ?? 0), lti: e(x, "lti"),
    };
  });
  const today = new Date().toISOString().slice(0, 10);
  const plans = evals.map((ev) => planView(s, ev, today)).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn));
  const lastPlan = (id: string) => evals.filter((x) => x.plantId === id).map((x) => x.receivedOn).sort().at(-1) ?? null;
  // Annual plans are owed by grid-connected generating companies in the Commission's register.
  const planDue = assets.filter((a) => /^grid/i.test(a.category)).map((a) => {
    const last = lastPlan(a.id) ?? (typeof a.attrs.lastPlan === "string" ? a.attrs.lastPlan : null);
    const due = a.nextPlanDue ?? (last ? addDays(last, s.planEval.cycleDays) : null);
    return { plant: a.name, code: a.code, last, due, overdue: !last || (due != null && due < today) };
  });

  return {
    plants: assets.length, capacity: cap(assets), available: sum(assets.map((a) => a.availableMw)),
    byCategory: group((a) => a.category || "Unspecified"), byFuel: group((a) => a.fuel || "Not stated"), byStatus: group((a) => a.status || "Not recorded"),
    largest: [...assets].sort((a, b) => (b.capacityMw ?? 0) - (a.capacityMw ?? 0)).slice(0, 10),
    month: cur.length ? kpis(cur) : null, plantKpis, trend: months.map((m) => ({ period: m, ...kpis(units.filter((u) => u.period === m)) })),
    plans, planDue, settings: s,
  };
}

const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function planView(s: Settings, ev: typeof schema.planEvaluations.$inferSelect, today = new Date().toISOString().slice(0, 10)) {
  const criteria = s.planEval.criteria[ev.planType] ?? [];
  const gateVals = Object.values(ev.gates);
  const gatesPassed = gateVals.length && gateVals.every((g) => g != null) ? gateVals.every((g) => g === "Yes") : gateVals.some((g) => g === "No") ? false : null;
  const score = weightedScore(criteria, ev.scores, ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
  const days = ev.decidedOn ? daysBetween(ev.receivedOn, ev.decidedOn) : daysBetween(ev.receivedOn, today);
  return {
    ...ev, criteria, gatesPassed, score, recommendation: recommendation(s, gatesPassed, score), days,
    deadline: addDays(ev.receivedOn, s.planEval.deadlineDays),
    withinDeadline: ev.decidedOn ? (days <= s.planEval.deadlineDays ? "Yes" : "No") : days > s.planEval.deadlineDays ? "Overdue" : "Open",
  };
}
