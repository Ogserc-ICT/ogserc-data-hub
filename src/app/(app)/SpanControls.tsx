"use client";
import { usePathname, useRouter } from "next/navigation";
import { SPAN_KINDS, type SpanKind } from "@/lib/periods";

type Opt = { value: string; label: string };

/**
 * Report type (monthly / quarterly / annual), reporting period and licensee pickers for a Commission view.
 * `keep` carries the view's own query parameters (a filter tab, say) across a change.
 */
export default function SpanControls({ span, period, licensee, licensees, allLabel, options, keep = {} }: {
  span: SpanKind; period: string; licensee: string; licensees: { id: string; label: string }[]; allLabel: string;
  options: Record<SpanKind, Opt[]>; keep?: Record<string, string>;
}) {
  const router = useRouter();
  const path = usePathname();
  const go = (k: SpanKind, p: string, l: string) => {
    const q = new URLSearchParams({ ...keep, ...(k !== "month" ? { span: k } : {}), period: p, ...(l ? { licensee: l } : {}) });
    if (k === "month") document.cookie = `ogserc_period=${p}; path=/; max-age=31536000; samesite=lax`;
    router.push(`${path}?${q.toString()}`);
  };
  return (
    <div className="report-tools no-print" style={{ justifyContent: "flex-start" }}>
      <label className="ctl" htmlFor="vspan">Report type
        <select id="vspan" value={span} onChange={(e) => { const k = e.target.value as SpanKind; go(k, options[k][0].value, licensee); }}>
          {SPAN_KINDS.map((s) => <option key={s.kind} value={s.kind}>{s.label}</option>)}
        </select>
      </label>
      <label className="ctl" htmlFor="vperiod">Reporting period
        <select id="vperiod" value={period} onChange={(e) => go(span, e.target.value, licensee)}>
          {!options[span].some((o) => o.value === period) && <option value={period}>{period}</option>}
          {options[span].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="ctl" htmlFor="vlic">Licensee
        <select id="vlic" value={licensee} onChange={(e) => go(span, period, e.target.value)}>
          <option value="">{allLabel}</option>
          {licensees.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
    </div>
  );
}
