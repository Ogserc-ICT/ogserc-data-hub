"use client";
import { useActionState, useMemo, useState } from "react";
import { recordPlan, scorePlan, type PlanState } from "./actions";

type Crit = { ref: string; name: string; weight: number };
type Gate = { ref: string; name: string; requirement: string };

export function RecordPlan({ plants }: { plants: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(recordPlan, {});
  return (
    <form action={action} className="fields">
      <div className="field"><label htmlFor="pp">Plant</label><select id="pp" name="plantId">{plants.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
      <div className="field"><label htmlFor="pt">Plan type</label><select id="pt" name="planType"><option>Capacity recovery</option><option>Expansion</option></select></div>
      <div className="field"><label htmlFor="pr">Date received</label><input id="pr" name="receivedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></div>
      <div className="field" style={{ justifyContent: "flex-end" }}><button className="primary" type="submit" disabled={pending}>Record plan submission</button></div>
      {state.ok && <p className="notice" style={{ gridColumn: "1/-1" }}>{state.ok}</p>}{state.error && <p className="notice err" style={{ gridColumn: "1/-1" }}>{state.error}</p>}
    </form>
  );
}

export function ScorePlan({ ev, gates, criteria, bands }: {
  ev: { id: string; gates: Record<string, string | null>; scores: Record<string, number | null>; decidedOn: string | null; leadEvaluator: string; conditions: string };
  gates: Gate[]; criteria: Crit[]; bands: { approve: number; approveWithConditions: number; returnForRevision: number };
}) {
  const [state, action, pending] = useActionState<PlanState, FormData>(scorePlan, {});
  const [g, setG] = useState(ev.gates);
  const [s, setS] = useState(ev.scores);
  const keys = ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];
  const score = useMemo(() => (keys.every((k) => s[k] == null) ? null : Math.round(criteria.reduce((a, c, i) => a + ((s[keys[i]] ?? 0) / 5) * c.weight, 0))), [s, criteria]); // eslint-disable-line react-hooks/exhaustive-deps
  const gateVals = gates.map((x) => g[x.ref]);
  const passed = gateVals.every((v) => v === "Yes") ? true : gateVals.some((v) => v === "No") ? false : null;
  const rec = passed === false ? "Return for revision" : score == null ? "—" : score >= bands.approve ? "Approve" : score >= bands.approveWithConditions ? "Approve with conditions" : score >= bands.returnForRevision ? "Return for revision" : "Reject";
  return (
    <form action={action} className="view" style={{ gap: 12 }}>
      <input type="hidden" name="id" value={ev.id} />
      <table className="compact"><thead><tr><th>Gate</th><th>Requirement</th><th>Result</th></tr></thead>
        <tbody>{gates.map((x) => <tr key={x.ref}><td>{x.ref} {x.name}</td><td style={{ fontSize: 13 }}>{x.requirement}</td><td><select name={x.ref} value={g[x.ref] ?? ""} onChange={(e) => setG({ ...g, [x.ref]: e.target.value || null })} aria-label={x.ref}><option value="">—</option><option>Yes</option><option>No</option></select></td></tr>)}</tbody></table>
      <table className="compact"><thead><tr><th>Criterion</th><th className="n">Weight</th><th className="n">Score (1–5)</th><th className="n">Points</th></tr></thead>
        <tbody>{criteria.map((c, i) => <tr key={c.ref}><td>{c.ref} {c.name}</td><td className="n num">{c.weight}%</td><td className="n"><select name={keys[i]} value={s[keys[i]] ?? ""} onChange={(e) => setS({ ...s, [keys[i]]: e.target.value ? Number(e.target.value) : null })} aria-label={c.name}><option value="">—</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select></td><td className="n num">{s[keys[i]] != null ? Math.round(((s[keys[i]] as number) / 5) * c.weight) : ""}</td></tr>)}
          <tr className="total"><td>Weighted score (out of 100)</td><td className="n num">100%</td><td /><td className="n num">{score ?? "—"}</td></tr></tbody></table>
      <p><b>Recommendation: {rec}</b> <span className="legend">· Approve ≥ {bands.approve}, with conditions ≥ {bands.approveWithConditions}, return for revision ≥ {bands.returnForRevision}, otherwise reject. Any failed gate returns the plan for revision.</span></p>
      <div className="fields">
        <div className="field"><label htmlFor={`d-${ev.id}`}>Date of decision</label><input id={`d-${ev.id}`} name="decidedOn" type="date" defaultValue={ev.decidedOn ?? ""} /></div>
        <div className="field"><label htmlFor={`l-${ev.id}`}>Lead evaluator</label><input id={`l-${ev.id}`} name="leadEvaluator" defaultValue={ev.leadEvaluator} /></div>
        <div className="field" style={{ gridColumn: "1/-1" }}><label htmlFor={`c-${ev.id}`}>Key conditions / reasons</label><textarea id={`c-${ev.id}`} name="conditions" rows={3} defaultValue={ev.conditions} /></div>
      </div>
      <div className="actions" style={{ alignItems: "center" }}><button className="primary" type="submit" disabled={pending}>Save evaluation</button>{state.ok && <span className="legend">{state.ok}</span>}{state.error && <span className="legend" style={{ color: "var(--bad)" }}>{state.error}</span>}</div>
    </form>
  );
}
