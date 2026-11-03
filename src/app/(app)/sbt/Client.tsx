"use client";
import { useActionState, useState } from "react";
import { logReferrals, type RefState } from "./actions";

export function CandidateForm({ period, candidates }: { period: string; candidates: { id: string; name: string; hub: string; band: string; floor: number; hours: number | null; run: number; dq: string }[] }) {
  const [state, action, pending] = useActionState<RefState, FormData>(logReferrals, {});
  const [checked, setChecked] = useState<string[]>(candidates.map((c) => c.id));
  if (!candidates.length) return <p className="legend">No feeder has breached long enough to be referred.</p>;
  return (
    <form action={action} className="view" style={{ gap: 10 }}>
      <input type="hidden" name="period" value={period} />
      <div className="scroll"><table className="compact">
        <thead><tr><th><input type="checkbox" aria-label="All" checked={checked.length === candidates.length} onChange={(e) => setChecked(e.target.checked ? candidates.map((c) => c.id) : [])} /></th><th>Feeder</th><th>Unit</th><th>Band</th><th className="n">Floor</th><th className="n">Hours</th><th className="n">Months in a row</th><th>Data quality</th></tr></thead>
        <tbody>{candidates.map((c) => (
          <tr key={c.id}>
            <td><input type="checkbox" name="feeder" value={c.id} aria-label={c.name} checked={checked.includes(c.id)} onChange={(e) => setChecked((x) => (e.target.checked ? [...x, c.id] : x.filter((y) => y !== c.id)))} /></td>
            <td>{c.name}</td><td>{c.hub}</td><td>{c.band}</td><td className="n num">{c.floor}</td><td className="n num">{c.hours?.toFixed(1) ?? "—"}</td><td className="n num">{c.run}</td><td style={{ fontSize: 12 }}>{c.dq}</td>
          </tr>))}</tbody>
      </table></div>
      <div className="actions" style={{ alignItems: "center" }}>
        <button className="primary" type="submit" disabled={pending || !checked.length}>{pending ? "Logging…" : `Log ${checked.length} referral${checked.length === 1 ? "" : "s"} to Compliance`}</button>
        {state.ok && <span className="legend">{state.ok}</span>}{state.error && <span className="legend" style={{ color: "var(--bad)" }}>{state.error}</span>}
      </div>
      <p className="legend">Feeders flagged for possible interpolation or zero hours should be queried with the licensee before referral.</p>
    </form>
  );
}
