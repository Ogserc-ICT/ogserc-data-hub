// Edge-safe session helpers (used by middleware and server code).
import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/db/schema";

export const SESSION_COOKIE = "ogserc_session";
export const SESSION_HOURS = 12;

/** sv: the user's session version when signed in. mcp: must change password before using the Hub. */
export type SessionPayload = { uid: string; role: Role; lic: string | null; name: string; sv: number; mcp: boolean };

function key() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return { uid: String(payload.uid), role: payload.role as Role, lic: (payload.lic as string | null) ?? null, name: String(payload.name ?? ""), sv: Number(payload.sv ?? 0), mcp: payload.mcp === true };
  } catch {
    return null;
  }
}
