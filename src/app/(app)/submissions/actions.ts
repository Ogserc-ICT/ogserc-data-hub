"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";

export type ReviewState = { error?: string };

export async function reviewSubmission(_: ReviewState, form: FormData): Promise<ReviewState> {
  const user = await requireCommission();
  const id = String(form.get("id") ?? "");
  const act = String(form.get("act") ?? "");
  const note = String(form.get("note") ?? "").trim().slice(0, 2000);
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || !["received", "accepted", "queried"].includes(s.status)) return { error: "This submission can no longer be reviewed." };
  if (!["accept", "query", "reset"].includes(act)) return { error: "Unknown action." };
  // Separation of duties: whoever filed a return cannot also accept or query it.
  if (act !== "reset" && s.submittedById === user.uid) return { error: "You filed this submission, so another Commission reviewer must review it." };
  if (act === "query" && note.length < 5) return { error: "Say what the licensee should correct or explain." };
  const status = act === "accept" ? "accepted" : act === "query" ? "queried" : "received";
  await db.update(schema.submissions).set({ status, reviewNote: act === "query" ? note : "", reviewedById: user.uid, reviewedAt: new Date() }).where(eq(schema.submissions.id, id));
  revalidatePath("/", "layout");
  return {};
}
