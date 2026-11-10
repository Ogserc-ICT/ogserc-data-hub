import "server-only";
import { cookies } from "next/headers";
import { defaultPeriod, isPeriod, isSpanKind, makeSpan, recentPeriods, spanOptions, type Span, type SpanKind } from "./periods";

/** Period from ?period=, then the remembered cookie, then last month. */
export async function resolvePeriod(sp: Record<string, string | string[] | undefined>): Promise<string> {
  const q = sp.period;
  const periods = recentPeriods();
  if (isPeriod(q) && periods.includes(q)) return q;
  const c = (await cookies()).get("ogserc_period")?.value;
  if (isPeriod(c) && periods.includes(c)) return c;
  return defaultPeriod();
}

/**
 * Monthly, quarterly or annual span from ?span= and ?period= (the span's last month).
 * Without a period it falls back to the remembered month, as the other views do.
 */
export async function resolveSpan(sp: Record<string, string | string[] | undefined>): Promise<Span> {
  const current = recentPeriods()[0];
  const kind: SpanKind = isSpanKind(sp.span) ? sp.span : "month";
  const q = sp.period;
  const asked = isPeriod(q) && q <= current && recentPeriods(new Date(), 48).includes(q) ? q : await resolvePeriod(sp);
  return makeSpan(kind, asked, current);
}

/** Choices for the Report type / Reporting period pickers. */
export const allSpanOptions = () => ({ month: spanOptions("month"), quarter: spanOptions("quarter"), year: spanOptions("year") });
