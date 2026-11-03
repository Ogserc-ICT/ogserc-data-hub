export function periodLabel(p: string, style: "long" | "short" = "long"): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: style, year: "numeric", timeZone: "UTC" });
}
export function monthShort(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
}
/** Months newest first, ending with the current month in Lagos time. */
export function recentPeriods(now = new Date(), count = 24): string[] {
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  let y = lagos.getUTCFullYear(), m = lagos.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}
/** Default reporting period: the month just closed. */
export function defaultPeriod(now = new Date()): string {
  return recentPeriods(now, 2)[1];
}
export function isPeriod(x: unknown): x is string {
  return typeof x === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
}
export function daysIn(p: string): number {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function addMonths(p: string, n: number): string {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
/** The trailing window of `n` months ending at p, oldest first. */
export function window(p: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(p, i - n + 1));
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** Finds a month name in free text ("January Average HOS" → 1). */
export function monthFromText(s: string): number | null {
  const t = s.toLowerCase();
  for (let i = 0; i < 12; i++) if (new RegExp(`\\b${MONTHS[i]}`).test(t)) return i + 1;
  return null;
}
/** Parses "Jan-2026", "January 2026", "2026-01", Excel dates. */
export function parsePeriod(v: unknown, fallbackYear?: number): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}`;
  if (typeof v !== "string") return null;
  const s: string = v.trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) return s;
  const m = monthFromText(s);
  const y = s.match(/(20\d\d)/)?.[1];
  if (m && (y || fallbackYear)) return `${y ?? fallbackYear}-${String(m).padStart(2, "0")}`;
  return null;
}
