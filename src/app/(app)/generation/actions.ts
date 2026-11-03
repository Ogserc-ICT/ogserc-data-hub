"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";

export type PlanState = { ok?: string; error?: string };
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Records a GenCo plan as received and starts the evaluation clock. */
export async function recordPlan(_: PlanState, form: FormData): Promise<PlanState> {
  await requireCommission();
  const plantId = String(form.get("plantId") ?? "");
  const planType = form.get("planType") === "Expansion" ? "Expansion" : "Capacity recovery";
  const receivedOn = String(form.get("receivedOn") ?? "");
  const plant = await db.query.generationAssets.findFirst({ where: eq(schema.generationAssets.id, plantId) });
  if (!plant) return { error: "Choose the plant." };
  if (!isDate(receivedOn)) return { error: "Enter the date the plan was received." };
  const ids = await db.select({ id: schema.planEvaluations.id }).from(schema.planEvaluations);
  const n = Math.max(0, ...ids.map((x) => Number(x.id.match(/^EV-(\d+)$/)?.[1] ?? 0))) + 1;
  const id = `EV-${String(n).padStart(3, "0")}`;
  await db.insert(schema.planEvaluations).values({ id, plantId, plantName: plant.name, planType, receivedOn });
  await db.update(schema.generationAssets).set({ planStatus: "Under evaluation" }).where(eq(schema.generationAssets.id, plantId));
  revalidatePath("/generation");
  return { ok: `${id} recorded for ${plant.name}.` };
}

/** Records the gate results, criterion scores (1–5) and decision. */
export async function scorePlan(_: PlanState, form: FormData): Promise<PlanState> {
  await requireCommission();
  const id = String(form.get("id") ?? "");
  const ev = await db.query.planEvaluations.findFirst({ where: eq(schema.planEvaluations.id, id) });
  if (!ev) return { error: "Evaluation not found." };
  const gates: Record<string, "Yes" | "No" | null> = {};
  for (const g of ["G1", "G2", "G3", "G4", "G5"]) { const v = String(form.get(g) ?? ""); gates[g] = v === "Yes" ? "Yes" : v === "No" ? "No" : null; }
  const scores: Record<string, number | null> = {};
  for (const k of ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]) { const v = Number(form.get(k)); scores[k] = v >= 1 && v <= 5 ? v : null; }
  const decidedOn = String(form.get("decidedOn") ?? "");
  if (decidedOn && !isDate(decidedOn)) return { error: "Decision date must be a date." };
  await db.update(schema.planEvaluations).set({
    gates, scores, decidedOn: decidedOn || null, leadEvaluator: String(form.get("leadEvaluator") ?? "").slice(0, 120),
    conditions: String(form.get("conditions") ?? "").slice(0, 3000), updatedAt: new Date(),
  }).where(eq(schema.planEvaluations.id, id));
  if (ev.plantId) await db.update(schema.generationAssets).set({ planStatus: decidedOn ? "Decided" : "Under evaluation" }).where(eq(schema.generationAssets.id, ev.plantId));
  revalidatePath("/generation");
  return { ok: "Evaluation saved." };
}
