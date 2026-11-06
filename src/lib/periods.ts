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
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let m = a; m <= b; m = addMonths(m, 1)) out.push(m);
  return out;
}

// ----------------------------------------------------------------- report spans (month, quarter, year)

export type SpanKind = "month" | "quarter" | "year";
export const SPAN_KINDS: { kind: SpanKind; label: string }[] = [
  { kind: "month", label: "Monthly" }, { kind: "quarter", label: "Quarterly" }, { kind: "year", label: "Annual" },
];
export function isSpanKind(x: unknown): x is SpanKind {
  return x === "month" || x === "quarter" || x === "year";
}

export type Span = {
  kind: SpanKind;
  /** Last month covered (capped at the current month for a quarter or year still in progress). */
  end: string;
  /** Months covered, oldest first. */
  months: string[];
  /** The same months one period earlier (previous month, quarter or year), for comparison. */
  prevMonths: string[];
  /** Key for report notes: "2026-11", "2026-Q4" or "2026-FY". */
  key: string;
  /** "November 2026", "Q4 2026", "2026". */
  label: string;
  /** "November 2026", "October – November 2026", "January – November 2026". */
  range: string;
  /** True when the quarter or year has months still to come. */
  partial: boolean;
  /** Column headings: "Nov" / "Oct", "Q4 2026" / "Q3 2026", "2026" / "2025". */
  short: string;
  prevShort: string;
  /** Noun for comparisons: "month", "quarter", "year". */
  noun: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The month, quarter or year containing `p`, cut off at `current` so it never runs into the future. */
export function makeSpan(kind: SpanKind, p: string, current = recentPeriods(new Date(), 1)[0]): Span {
  const [y, m] = p.split("-").map(Number);
  const q = Math.floor((m - 1) / 3) + 1;
  const startM = kind === "month" ? m : kind === "quarter" ? (q - 1) * 3 + 1 : 1;
  const fullEndM = kind === "month" ? m : kind === "quarter" ? q * 3 : 12;
  const fullEnd = `${y}-${pad(fullEndM)}`;
  const end = fullEnd > current ? (current >= `${y}-${pad(startM)}` ? current : fullEnd) : fullEnd;
  const months = monthsBetween(`${y}-${pad(startM)}`, end);
  const shift = kind === "month" ? 1 : kind === "quarter" ? 3 : 12;
  const prevMonths = months.map((x) => addMonths(x, -shift));
  const range = months.length === 1 ? periodLabel(end) : `${monthName(months[0])} – ${periodLabel(end)}`;
  const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y;
  return {
    kind, end, months, prevMonths, range, partial: end < fullEnd,
    key: kind === "month" ? end : kind === "quarter" ? `${y}-Q${q}` : `${y}-FY`,
    label: kind === "month" ? periodLabel(end) : kind === "quarter" ? `Q${q} ${y}` : String(y),
    short: kind === "month" ? monthShort(end) : kind === "quarter" ? `Q${q} ${y}` : String(y),
    prevShort: kind === "month" ? monthShort(prevMonths[0]) : kind === "quarter" ? `Q${pq} ${py}` : String(y - 1),
    noun: kind,
  };
}
function monthName(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

/** Choices for the report's period picker, newest first; each value is the span's end month. */
export function spanOptions(kind: SpanKind, now = new Date()): { value: string; label: string }[] {
  const current = recentPeriods(now, 1)[0];
  if (kind === "month") return recentPeriods(now).map((p) => ({ value: p, label: periodLabel(p) }));
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const p of recentPeriods(now, kind === "quarter" ? 24 : 48)) {
    const s = makeSpan(kind, p, current);
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    out.push({ value: s.end, label: `${s.label}${s.partial ? " (to date)" : ""}` });
  }
  return out;
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
