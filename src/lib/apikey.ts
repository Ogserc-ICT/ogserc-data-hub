import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { allowRequest } from "./throttle";

export const hashKey = (k: string) => createHash("sha256").update(k).digest("hex");

export function newKey() {
  const key = `ogs_${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

/** The licensee behind a Bearer key, or null. */
export async function licenseeFromRequest(req: Request) {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(ogs_[A-Za-z0-9_-]{20,})$/);
  if (!m) return null;
  const [k] = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.keyHash, hashKey(m[1])), isNull(schema.apiKeys.revokedAt)));
  if (!k) return null;
  await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, k.id));
  return { licenseeId: k.licenseeId, keyLabel: k.label, keyId: k.id };
}

/** API limits: per key, and per IP address for requests with a missing or wrong key. */
const API_PER_KEY = { limit: 120, windowMin: 10 };
const API_BAD_AUTH_PER_IP = { limit: 20, windowMin: 15 };

const ipOf = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";

/** Authenticates and rate-limits an API request. Returns the licensee, or a ready-made error response. */
export async function apiAuth(req: Request): Promise<{ licenseeId: string; keyLabel: string } | Response> {
  const ip = ipOf(req);
  const auth = await licenseeFromRequest(req);
  if (!auth) {
    if (!(await allowRequest(`apiauth:${ip}`, API_BAD_AUTH_PER_IP.limit, API_BAD_AUTH_PER_IP.windowMin)))
      return Response.json({ error: "Too many requests with an invalid key. Try again later." }, { status: 429, headers: { "Retry-After": String(API_BAD_AUTH_PER_IP.windowMin * 60) } });
    return Response.json({ error: "Missing or invalid API key." }, { status: 401 });
  }
  if (!(await allowRequest(`api:${auth.keyId}`, API_PER_KEY.limit, API_PER_KEY.windowMin)))
    return Response.json({ error: `Rate limit reached: at most ${API_PER_KEY.limit} requests per ${API_PER_KEY.windowMin} minutes per key.` }, { status: 429, headers: { "Retry-After": "60" } });
  return { licenseeId: auth.licenseeId, keyLabel: auth.keyLabel };
}
