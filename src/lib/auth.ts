import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession, type SessionPayload } from "./session";

export type CurrentUser = SessionPayload & { isCommission: boolean; isAdmin: boolean };

/** Why an account may not use the Hub right now, or null if it may. */
export async function accessBlock(u: User): Promise<string | null> {
  if (!u.active) return "That email and password do not match an active account.";
  if (u.role === "licensee") {
    if (!u.licenseeId) return "Your account is not linked to a licensee. Ask the Commission's Hub administrator to link it.";
    const lic = await db.query.licensees.findFirst({ where: eq(schema.licensees.id, u.licenseeId) });
    if (!lic || !lic.active) return "Your organisation's access to the Hub has been suspended. Contact the Commission.";
  }
  return null;
}

/**
 * The signed-in user, re-checked against the database on every request, so a deactivated account,
 * a retired licensee or a password reset takes effect at once.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await db.query.users.findFirst({ where: eq(schema.users.id, s.uid) });
  if (!u || u.sessionVersion !== s.sv) return null;
  if (await accessBlock(u)) return null;
  return {
    uid: u.id, role: u.role, lic: u.licenseeId, name: u.name, sv: u.sessionVersion, mcp: u.mustChangePassword,
    isCommission: u.role !== "licensee", isAdmin: u.role === "admin",
  };
}

export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireCommission(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!u.isCommission) redirect("/");
  return u;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const u = await requireUser();
  if (!u.isAdmin) redirect("/");
  return u;
}

export async function startSession(u: User): Promise<void> {
  const token = await signSession({ uid: u.id, role: u.role, lic: u.licenseeId, name: u.name, sv: u.sessionVersion, mcp: u.mustChangePassword });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_HOURS * 3600,
  });
}
