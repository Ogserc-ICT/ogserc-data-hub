"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { isPeriod } from "@/lib/periods";
import { nextReferralRef, sbtMonitor } from "@/lib/sbt";
import { REFERRAL_STATUSES } from "@/lib/datasets";

export type RefState = { ok?: string; error?: string };

/** Logs a referral to Compliance for each chosen candidate feeder. */
export async function logReferrals(_: RefState, form: FormData): Promise<RefState> {
  const user = await requireCommission();
  const period = String(form.get("period") ?? "");
  const ids = form.getAll("feeder").map(String);
  if (!isPeriod(period) || !ids.length) return { error: "Tick at least one feeder." };
  const mon = await sbtMonitor(period);
  const next = await nextReferralRef(period.slice(0, 4));
  let k = 0;
  for (const id of ids) {
    const x = mon.list.find((f) => f.id === id && f.candidate);
    if (!x) continue;
    k++;
    await db.insert(schema.referrals).values({
      ref: next(k), licenseeId: x.licenseeId, feederId: x.id, feederName: x.name, band: x.band, floorHours: x.floor, hub: x.hub,
      monthsBreached: x.run, avgHours: x.ytdAvg, shortfall: x.shortfall, dataQualityFlag: x.dq, referredOn: new Date().toISOString().slice(0, 10),
      referredBy: user.name, status: "Referred to Compliance",
    });
  }
  revalidatePath("/sbt");
  return { ok: `${k} referral${k === 1 ? "" : "s"} logged.` };
}

export async function updateReferral(form: FormData) {
  await requireCommission();
  const ref = String(form.get("ref") ?? "");
  const status = String(form.get("status") ?? "");
  if (!(REFERRAL_STATUSES as readonly string[]).includes(status)) return;
  const closing = /remedied|downgraded|closed/i.test(status);
  await db.update(schema.referrals).set({
    status, caseNo: String(form.get("caseNo") ?? "").trim() || null, notes: String(form.get("notes") ?? "").trim().slice(0, 2000),
    closedOn: closing ? String(form.get("closedOn") ?? "") || new Date().toISOString().slice(0, 10) : null, updatedAt: new Date(),
  }).where(eq(schema.referrals.ref, ref));
  revalidatePath("/sbt");
}
