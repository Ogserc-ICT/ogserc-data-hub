import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Sign-in rate limiting, stored in Postgres so it works across serverless instances.
 * - Per email: 5 failures within 15 minutes locks that email for 15 minutes.
 * - Per IP address: 25 failures within 15 minutes locks that address for 15 minutes.
 */
const WINDOW_MIN = 15;
const LOCK_MIN = 15;
const LIMITS = { email: 5, ip: 25 } as const;

type Kind = keyof typeof LIMITS;
const k = (kind: Kind, v: string) => `${kind}:${v}`;

/** Minutes left on the longest active lock for these keys, or 0 if none. */
export async function lockedFor(email: string, ip: string): Promise<number> {
  const rows = await db.select().from(schema.loginThrottle).where(inArray(schema.loginThrottle.key, [k("email", email), k("ip", ip)]));
  const now = Date.now();
  const ms = Math.max(0, ...rows.map((r) => (r.lockedUntil ? r.lockedUntil.getTime() - now : 0)));
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

export async function recordFailure(email: string, ip: string): Promise<void> {
  for (const [kind, v] of [["email", email], ["ip", ip]] as const) {
    const limit = LIMITS[kind];
    // Start a fresh window if the old one has expired, otherwise count up; lock once the limit is reached.
    await db.execute(sql`
      INSERT INTO login_throttle (key, failures, window_start, locked_until)
      VALUES (${k(kind, v)}, 1, now(), NULL)
      ON CONFLICT (key) DO UPDATE SET
        failures = CASE WHEN login_throttle.window_start < now() - make_interval(mins => ${WINDOW_MIN}) THEN 1 ELSE login_throttle.failures + 1 END,
        window_start = CASE WHEN login_throttle.window_start < now() - make_interval(mins => ${WINDOW_MIN}) THEN now() ELSE login_throttle.window_start END,
        locked_until = CASE
          WHEN (CASE WHEN login_throttle.window_start < now() - make_interval(mins => ${WINDOW_MIN}) THEN 1 ELSE login_throttle.failures + 1 END) >= ${limit}
          THEN now() + make_interval(mins => ${LOCK_MIN})
          ELSE login_throttle.locked_until END
    `);
  }
}

export async function clearEmail(email: string): Promise<void> {
  await db.delete(schema.loginThrottle).where(eq(schema.loginThrottle.key, k("email", email)));
}

/**
 * Fixed-window request counter for the API. Returns true if this request is within the limit.
 * Reuses the throttle table: `failures` counts requests in the current window.
 */
export async function allowRequest(key: string, limit: number, windowMin: number): Promise<boolean> {
  const rows = await db.execute<{ failures: number }>(sql`
    INSERT INTO login_throttle (key, failures, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      failures = CASE WHEN login_throttle.window_start < now() - make_interval(mins => ${windowMin}) THEN 1 ELSE login_throttle.failures + 1 END,
      window_start = CASE WHEN login_throttle.window_start < now() - make_interval(mins => ${windowMin}) THEN now() ELSE login_throttle.window_start END
    RETURNING failures
  `);
  return Number(rows[0]?.failures ?? 0) <= limit;
}
