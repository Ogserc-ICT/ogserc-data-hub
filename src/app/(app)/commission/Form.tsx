"use client";
import { useActionState } from "react";
import type { Indicator } from "@/lib/datasets";
import { saveActivity, type SaveState } from "./actions";

export default function ActivityForm({ period, rows }: { period: string; rows: (Indicator & { value: number | null; note: string })[] }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveActivity, {});
  const groups = [...new Set(rows.map((r) => r.group))];
  return (
    <form action={action} className="view" key={period}>
      <input type="hidden" name="period" value={period} />
      {groups.map((g) => (
        <div className="card" key={g}>
          <h3>{g}</h3>
          <div className="scroll">
            <table className="compact">
              <thead><tr><th>Indicator</th><th className="n" style={{ width: 140 }}>This month</th><th>Notes</th></tr></thead>
              <tbody>
                {rows.filter((r) => r.group === g).map((r) => (
                  <tr key={r.key}>
                    <td><label htmlFor={`v_${r.key}`}>{r.label}{r.unit ? ` (${r.unit})` : ""}</label></td>
                    <td className="n"><input id={`v_${r.key}`} name={`v_${r.key}`} className="n" inputMode="decimal" defaultValue={r.value ?? ""} style={{ width: 120, textAlign: "right" }} /></td>
                    <td><input name={`n_${r.key}`} aria-label={`Notes: ${r.label}`} defaultValue={r.note} style={{ width: "100%" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="actions" style={{ alignItems: "center" }}>
        <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save activity"}</button>
        {state.ok && <span className="legend" role="status">{state.ok}</span>}
        {state.error && <span className="legend" style={{ color: "var(--bad)" }} role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
