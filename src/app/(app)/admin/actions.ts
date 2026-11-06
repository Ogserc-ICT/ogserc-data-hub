"use server";
import { revalidatePath } from "next/cache";
import { eq, inArray, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import { requireAdmin } from "@/lib/auth";
import { LICENSEE_DATASETS, type DatasetCode } from "@/lib/datasets";
import { newKey } from "@/lib/apikey";
import { and, isNull } from "drizzle-orm";
import type { Role, SubmissionStatus } from "@/db/schema";

export type AdminState = { ok?: string; error?: string };

const ROLES: Role[] = ["admin", "reviewer", "licensee"];

export async function createUser(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "") as Role;
  const licenseeId = String(form.get("licenseeId") ?? "") || null;
  const password = String(form.get("password") ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (!name) return { error: "Enter the person's name." };
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  if (role === "licensee") {
    if (!licenseeId) return { error: "Licensee users must be linked to a licensee." };
    const lic = await db.query.licensees.findFirst({ where: eq(schema.licensees.id, licenseeId) });
    if (!lic) return { error: `There is no licensee with the code "${licenseeId}".` };
    if (!lic.active) return { error: `${lic.name} is retired. Restore it before adding users to it.` };
  }
  if (password.length < 10) return { error: "Use a temporary password of at least 10 characters." };
  const exists = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (exists) return { error: "An account with that email already exists." };
  try {
    await db.insert(schema.users).values({
      email, name, role, licenseeId: role === "licensee" ? licenseeId : null, passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true,
    });
  } catch (e) {
    console.error("createUser failed", e);
    return { error: "The account could not be created. Check the details and try again." };
  }
  revalidatePath("/admin");
  return { ok: `Account created for ${name}. Share the temporary password with them directly; they will be asked to choose their own when they first sign in.` };
}

export async function resetPassword(_: AdminState, form: FormData): Promise<AdminState> {
  const me = await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (id === me.uid) return { error: "Change your own password from the Account page." };
  const password = String(form.get("password") ?? "");
  if (password.length < 10) return { error: "Use at least 10 characters." };
  // A reset signs the user out everywhere and makes them choose a new password at next sign-in.
  const done = await db
    .update(schema.users)
    .set({ passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true, sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, id))
    .returning({ id: schema.users.id });
  if (!done.length) return { error: "That user no longer exists." };
  revalidatePath("/admin");
  return { ok: "Password reset. They will set a new one at next sign-in." };
}

export async function toggleUser(form: FormData) {
  const me = await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (id === me.uid) return; // never lock yourself out
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!u) return;
  // Deactivating also ends any open sessions.
  await db.update(schema.users).set({ active: !u.active, sessionVersion: sql`${schema.users.sessionVersion} + 1` }).where(eq(schema.users.id, id));
  revalidatePath("/admin");
}

/**
 * Permanently removes an account. Records the person touched keep their content: submissions still show the
 * submitter's name (stored on the submission), but the links back to the account are cleared.
 */
export async function deleteUser(_: AdminState, form: FormData): Promise<AdminState> {
  const me = await requireAdmin();
  const id = String(form.get("id") ?? "");
  if (id === me.uid) return { error: "You cannot delete your own account." };
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!u) return { error: "That user no longer exists." };
  try {
    await db.transaction(async (tx) => {
      await tx.update(schema.submissions).set({ submittedById: null }).where(eq(schema.submissions.submittedById, id));
      await tx.update(schema.submissions).set({ reviewedById: null }).where(eq(schema.submissions.reviewedById, id));
      await tx.update(schema.apiKeys).set({ createdById: null }).where(eq(schema.apiKeys.createdById, id));
      await tx.update(schema.commissionMonthly).set({ updatedById: null }).where(eq(schema.commissionMonthly.updatedById, id));
      await tx.update(schema.reportNotes).set({ updatedById: null }).where(eq(schema.reportNotes.updatedById, id));
      await tx.update(schema.settings).set({ updatedById: null }).where(eq(schema.settings.updatedById, id));
      await tx.delete(schema.users).where(eq(schema.users.id, id));
    });
  } catch (e) {
    console.error("deleteUser failed", e);
    return { error: "The account could not be deleted. Try again, or deactivate it instead." };
  }
  revalidatePath("/admin");
  return { ok: `${u.name}'s account has been deleted.` };
}

/** Submission statuses an administrator may clear in bulk (form fields st_<status>). */
const CLEARABLE: SubmissionStatus[] = ["received", "superseded", "staged", "accepted", "queried", "discarded"];

/**
 * Deletes every submission with the chosen statuses. Filings and the monthly data rows they supplied are removed
 * with them (ON DELETE CASCADE), so dashboards and reports no longer show that data.
 */
export async function clearSubmissions(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const statuses = CLEARABLE.filter((s) => form.get(`st_${s}`) === "on");
  if (!statuses.length) return { error: "Choose at least one status to clear." };
  if (String(form.get("confirm") ?? "").trim() !== "DELETE") return { error: "Type DELETE in capitals to confirm." };
  let n = 0;
  try {
    n = (await db.delete(schema.submissions).where(inArray(schema.submissions.status, statuses)).returning({ id: schema.submissions.id })).length;
  } catch (e) {
    console.error("clearSubmissions failed", e);
    return { error: "The submissions could not be cleared. Nothing was deleted." };
  }
  revalidatePath("/", "layout");
  return { ok: n ? `Cleared ${n} submission${n === 1 ? "" : "s"} and the data filed from them.` : "There were no submissions with those statuses." };
}

export async function saveLicensee(_: AdminState, form: FormData): Promise<AdminState> {
  await requireAdmin();
  const id = String(form.get("id") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const area = String(form.get("area") ?? "").trim();
  const type = String(form.get("type") ?? "");
  const code = String(form.get("code") ?? "").trim().toUpperCase();
  const licenceStatus = String(form.get("licenceStatus") ?? "Licensed").trim() || "Licensed";
  const obligations = LICENSEE_DATASETS.filter((d) => form.get(`d_${d}`) === "on") as DatasetCode[];
  if (!/^[a-z0-9-]{2,30}$/.test(id)) return { error: "Short code: 2–30 lowercase letters, digits or hyphens." };
  if (!name || !area) return { error: "Enter the licensee's name and area." };
  if (!type) return { error: "Choose a licence type." };
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) return { error: "Licensee code: 2–12 capital letters or digits, e.g. IBEDC." };
  if (!obligations.length) return { error: "Choose at least one monthly return." };
  const v = { name, area, type, code, licenceStatus, obligations };
  await db.insert(schema.licensees).values({ id, ...v, sortOrder: 100 }).onConflictDoUpdate({ target: schema.licensees.id, set: v });
  revalidatePath("/", "layout");
  return { ok: `${name} saved.` };
}

export async function toggleLicensee(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const l = await db.query.licensees.findFirst({ where: eq(schema.licensees.id, id) });
  if (!l) return;
  await db.update(schema.licensees).set({ active: !l.active }).where(eq(schema.licensees.id, id));
  revalidatePath("/", "layout");
}

export async function saveHubAliases(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const aliases = String(form.get("aliases") ?? "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20);
  await db.update(schema.hubs).set({ aliases }).where(eq(schema.hubs.id, id));
  revalidatePath("/admin");
}

export type KeyState = { key?: string; error?: string };

export async function createApiKey(_: KeyState, form: FormData): Promise<KeyState> {
  const me = await requireAdmin();
  const licenseeId = String(form.get("licenseeId") ?? "");
  const label = String(form.get("label") ?? "").trim().slice(0, 80);
  if (!licenseeId || !label) return { error: "Choose a licensee and describe what the key is for." };
  const k = newKey();
  await db.insert(schema.apiKeys).values({ licenseeId, label, prefix: k.prefix, keyHash: k.hash, createdById: me.uid });
  revalidatePath("/admin");
  return { key: k.key };
}

export async function revokeApiKey(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), isNull(schema.apiKeys.revokedAt)));
  revalidatePath("/admin");
}
