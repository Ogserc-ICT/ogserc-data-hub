"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, schema } from "@/db";
import { SESSION_COOKIE } from "@/lib/session";
import { accessBlock, startSession } from "@/lib/auth";
import { clearEmail, lockedFor, recordFailure } from "@/lib/throttle";

export type LoginState = { error?: string };

// A real bcrypt hash of a random string, compared when the email is unknown so response time doesn't reveal which emails exist.
const DUMMY_HASH = "$2a$12$5mLY2v3LliITjG5dav5P2OGaODCWq7ktvUYPrRg3RZXBGfQ1cRWsG";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export async function login(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const ip = await clientIp();

  const wait = await lockedFor(email, ip);
  if (wait) return { error: `Too many failed sign-in attempts. Try again in ${wait} minute${wait > 1 ? "s" : ""}.` };

  const u = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) {
    await recordFailure(email, ip);
    return { error: "That email and password do not match an active account." };
  }
  const blocked = await accessBlock(u);
  if (blocked) return { error: blocked };

  await clearEmail(email);
  await startSession(u);
  redirect(u.mustChangePassword ? "/account" : "/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
