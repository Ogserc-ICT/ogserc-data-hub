"use server";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import { requireUser, startSession } from "@/lib/auth";

export type AccountState = { ok?: string; error?: string };

export async function changePassword(_: AccountState, form: FormData): Promise<AccountState> {
  const me = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, me.uid) });
  if (!u) redirect("/login");
  if (!(await bcrypt.compare(current, u.passwordHash))) return { error: "Your current password is not correct." };
  if (next.length < 10) return { error: "Choose a new password of at least 10 characters." };
  if (next !== confirm) return { error: "The two new passwords do not match." };
  if (next === current) return { error: "Choose a password different from your current one." };

  const [updated] = await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(next, 12), mustChangePassword: false, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, u.id))
    .returning();
  // Other sessions are now signed out; keep this one going with a fresh cookie.
  await startSession(updated);
  if (u.mustChangePassword) redirect("/");
  return { ok: "Password changed. You have been signed out everywhere else." };
}
