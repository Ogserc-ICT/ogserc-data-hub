import type { FilingStatus } from "./metrics";
import { monthShort } from "./periods";

export const STATUS_LABEL: Record<FilingStatus, string> = {
  missing: "Missing", received: "Received", flagged: "Flagged", accepted: "Accepted", queried: "Queried", "not-required": "Not required",
};
const STATUS_CLASS: Record<FilingStatus, string> = {
  missing: "s-missing", received: "s-received", flagged: "s-flagged", accepted: "s-validated", queried: "s-queried", "not-required": "s-na",
};
export function StatusPill({ s }: { s: FilingStatus }) {
  if (s === "not-required") return <span className="s-na">Not required</span>;
  return <span className={`pill ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>;
}

export const fmt = (v: number | null | undefined, d = 0) =>
  v != null && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";
export const pct = (v: number | null | undefined, d = 1) => (v != null && Number.isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");
/** Naira in billions or millions. */
export const ngn = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e9) return `₦${(v / 1e9).toFixed(2)}bn`;
  if (Math.abs(v) >= 1e6) return `₦${(v / 1e6).toFixed(1)}m`;
  return `₦${fmt(v)}`;
};
export const change = (cur: number | null | undefined, prev: number | null | undefined, asPoints = false) => {
  if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  if (asPoints) return (cur - prev) * 100;
  return prev ? (cur - prev) / Math.abs(prev) : null;
};

// ----------------------------------------------------------------- charts (server-rendered SVG, theme tokens)

export type BarItem = { label: string; value: number | null; text?: string; tone?: "ok" | "warn" | "bad" | "accent" | "muted"; target?: number | null };

/** Horizontal bars with optional per-row target marker. */
export function HBars({ items, max, ticks, unit = "", legend }: { items: BarItem[]; max: number; ticks: number[]; unit?: string; legend?: string }) {
  if (!items.length) return <div className="empty">No data for this period.</div>;
  return (
    <div className="hbars">
      {items.map((it) => (
        <div className="bar-row" key={it.label}>
          <span className="lab" title={it.label}>{it.label}</span>
          <div className="track">
            <div className={`fill ${it.tone ?? "accent"}`} style={{ width: `${Math.max(0, Math.min((it.value ?? 0) / max, 1)) * 100}%` }} />
            {it.target != null && <div className="target" style={{ left: `calc(${Math.min(it.target / max, 1) * 100}% - 1px)` }} />}
          </div>
          <span className="val">{it.text ?? `${fmt(it.value, 1)}${unit}`}</span>
        </div>
      ))}
      <div className="axis"><span /><span className="ticks">{ticks.map((t) => <span key={t}>{t}{unit}</span>)}</span><span /></div>
      {legend && <span className="legend">{legend}</span>}
    </div>
  );
}

export type Series = { name: string; values: (number | null)[]; tone: "s1" | "s2" | "s3" | "s4"; dashed?: boolean };

/** Line chart across months; values share one axis. */
export function LineChart({ months, series, format = (v: number) => fmt(v), height = 190, min = 0, max: maxIn, refLine }: {
  months: string[]; series: Series[]; format?: (v: number) => string; height?: number; min?: number; max?: number; refLine?: { value: number; label: string };
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (!all.length) return <div className="empty">No data for these months.</div>;
  const W = 560, H = height, L = 52, R = 14, T = 14, B = 26;
  const max = maxIn ?? niceMax(Math.max(...all, refLine?.value ?? 0));
  const x = (i: number) => L + (months.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (months.length - 1));
  const y = (v: number) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (max - min));
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
            <text x={L - 6} y={y(t) + 4} className="tick" textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {months.map((m, i) => <text key={m} x={x(i)} y={H - 8} className="tick" textAnchor="middle">{monthShort(m)}</text>)}
        {refLine && (
          <g>
            <line x1={L} x2={W - R} y1={y(refLine.value)} y2={y(refLine.value)} className="ref" />
            <text x={W - R} y={y(refLine.value) - 4} className="tick" textAnchor="end">{refLine.label}</text>
          </g>
        )}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
          const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : acc), "");
          const last = [...pts].reverse().find(Boolean);
          return (
            <g key={s.name} className={s.tone}>
              <path d={d} className="line" strokeDasharray={s.dashed ? "5 4" : undefined} />
              {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 4 : 2.5} className="dot" />)}
              {last && <text x={last[0] - 6} y={si % 2 ? last[1] + 17 : last[1] - 8} className="endlabel" textAnchor="end">{format(s.values.filter((v) => v != null).at(-1)!)}</text>}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="keys">{series.map((s) => <span key={s.name} className={`key ${s.tone}`}><i />{s.name}</span>)}</figcaption>
      )}
    </figure>
  );
}

/** Vertical columns for a single series across months. */
export function Columns({ months, values, format = (v: number) => fmt(v), height = 170 }: { months: string[]; values: (number | null)[]; format?: (v: number) => string; height?: number }) {
  const all = values.filter((v): v is number => v != null);
  if (!all.length || all.every((v) => v === 0)) return <div className="empty">No data for these months.</div>;
  const W = 560, H = height, L = 52, R = 10, T = 18, B = 26;
  const max = niceMax(Math.max(...all));
  const bw = ((W - L - R) / months.length) * 0.6;
  const x = (i: number) => L + ((i + 0.5) * (W - L - R)) / months.length;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={L} x2={W - R} y1={y(f * max)} y2={y(f * max)} className="grid" /><text x={L - 6} y={y(f * max) + 4} className="tick" textAnchor="end">{format(f * max)}</text></g>
        ))}
        {values.map((v, i) => v != null && (
          <g key={i} className="s1">
            <rect x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, H - B - y(v))} className="col" rx="2" />
            {i === values.length - 1 && <text x={x(i)} y={y(v) - 5} className="endlabel" textAnchor="middle">{format(v)}</text>}
          </g>
        ))}
        {months.map((m, i) => <text key={m} x={x(i)} y={H - 8} className="tick" textAnchor="middle">{monthShort(m)}</text>)}
      </svg>
    </figure>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
