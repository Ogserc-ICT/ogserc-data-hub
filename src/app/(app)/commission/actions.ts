"use server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { COMMISSION_INDICATORS, toNumber } from "@/lib/datasets";
import { isPeriod } from "@/lib/periods";

export type SaveState = { ok?: string; error?: string };

export async function saveActivity(_: SaveState, form: FormData): Promise<SaveState> {
  const user = await requireCommission();
  const period = String(form.get("period") ?? "");
  if (!isPeriod(period)) return { error: "Choose a month." };
  for (const ind of COMMISSION_INDICATORS) {
    const raw = String(form.get(`v_${ind.key}`) ?? "").trim();
    const note = String(form.get(`n_${ind.key}`) ?? "").trim().slice(0, 500);
    const value = raw === "" ? null : toNumber(raw);
    if (raw !== "" && value == null) return { error: `${ind.label}: enter a number.` };
    const v = { value, note, updatedById: user.uid, updatedAt: new Date() };
    await db.insert(schema.commissionMonthly).values({ period, indicator: ind.key, ...v }).onConflictDoUpdate({ target: [schema.commissionMonthly.period, schema.commissionMonthly.indicator], set: v });
  }
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}
