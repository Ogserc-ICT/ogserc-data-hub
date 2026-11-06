"use server";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { isPeriod } from "@/lib/periods";

export type NoteState = { ok?: boolean; error?: string };

/**
 * Report keys are period + scope ("2026-07", "2026-Q3", "2026-FY", optionally ":ibedc"),
 * so each monthly, quarterly, annual and licensee edition keeps its own commentary.
 */
const validKey = (k: string) => /^\d{4}-(0[1-9]|1[0-2]|Q[1-4]|FY)(:[a-z0-9-]+)?$/.test(k);

export async function saveNote(_: NoteState, form: FormData): Promise<NoteState> {
  const user = await requireCommission();
  const period = String(form.get("period") ?? "");
  const section = String(form.get("section") ?? "").slice(0, 40);
  const body = String(form.get("body") ?? "").slice(0, 20000);
  if (!validKey(period) || !section) return { error: "Missing period or section." };
  const v = { body, updatedById: user.uid, updatedAt: new Date() };
  await db.insert(schema.reportNotes).values({ period, section, ...v }).onConflictDoUpdate({ target: [schema.reportNotes.period, schema.reportNotes.section], set: v });
  revalidatePath("/report");
  return { ok: true };
}

export async function setReportStatus(form: FormData) {
  const user = await requireCommission();
  const period = String(form.get("period") ?? "");
  const status = form.get("status") === "approved" ? "approved" : "draft";
  if (!validKey(period)) return;
  const v = { body: status, status, updatedById: user.uid, updatedAt: new Date() } as const;
  await db.insert(schema.reportNotes).values({ period, section: "_status", ...v }).onConflictDoUpdate({ target: [schema.reportNotes.period, schema.reportNotes.section], set: v });
  revalidatePath("/report");
}
void isPeriod;
