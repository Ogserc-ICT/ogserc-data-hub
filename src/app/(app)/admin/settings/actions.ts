"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getSettings, saveSetting } from "@/lib/settings-db";
import type { Settings } from "@/lib/settings";

export type SetState = { ok?: string; error?: string };

export async function saveSettings(_: SetState, form: FormData): Promise<SetState> {
  const user = await requireAdmin();
  const s = await getSettings();
  const n = (k: string) => { const v = Number(form.get(k)); if (!Number.isFinite(v)) throw new Error(`${k} must be a number.`); return v; };
  try {
    const next: Partial<Settings> = {
      bandHours: Object.fromEntries(Object.keys(s.bandHours).map((b) => [b, n(`band_${b}`)])),
      bandThreshold: n("bandThreshold"), sbtTolerance: n("sbtTolerance"), sbtConsecutive: Math.max(1, Math.round(n("sbtConsecutive"))),
      deliveryRatioMin: n("deliveryRatioMin"), deliveryRatioMax: n("deliveryRatioMax"), hoursMismatchTolerance: n("hoursMismatchTolerance"),
      flags: Object.fromEntries(Object.keys(s.flags).map((k) => [k, n(`flag_${k}`)])) as Settings["flags"],
      marketTargets: s.marketTargets.map((t) => ({ ...t, value: n(`mt_${t.key}`) })),
      genTargets: s.genTargets.map((t) => ({ ...t, value: n(`gt_${t.key}`) })),
      forecast: { low: n("fc_low"), base: n("fc_base"), high: n("fc_high"), startYear: n("fc_startYear"), endYear: n("fc_endYear"), removeDoubleCount: form.get("fc_removeDoubleCount") === "on" },
      planEval: { ...s.planEval, approve: n("pe_approve"), approveWithConditions: n("pe_approveWithConditions"), returnForRevision: n("pe_returnForRevision"), deadlineDays: n("pe_deadlineDays"), cycleDays: n("pe_cycleDays") },
    };
    for (const [k, v] of Object.entries(next)) await saveSetting(k as keyof Settings, v, user.uid);
  } catch (e) { return { error: e instanceof Error ? e.message : "Could not save." }; }
  revalidatePath("/", "layout");
  return { ok: "Settings saved. Reports and monitors use the new values from now on." };
}
