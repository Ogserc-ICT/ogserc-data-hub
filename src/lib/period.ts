import "server-only";
import { cookies } from "next/headers";
import { defaultPeriod, isPeriod, recentPeriods } from "./periods";

/** Period from ?period=, then the remembered cookie, then last month. */
export async function resolvePeriod(sp: Record<string, string | string[] | undefined>): Promise<string> {
  const q = sp.period;
  const periods = recentPeriods();
  if (isPeriod(q) && periods.includes(q)) return q;
  const c = (await cookies()).get("ogserc_period")?.value;
  if (isPeriod(c) && periods.includes(c)) return c;
  return defaultPeriod();
}
