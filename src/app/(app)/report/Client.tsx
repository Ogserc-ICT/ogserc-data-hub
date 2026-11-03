"use client";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { saveNote, type NoteState } from "./actions";

export function PrintButton() {
  return <button type="button" className="primary" onClick={() => window.print()}>Print or save as PDF</button>;
}

export function ScopeSelect({ period, value, licensees }: { period: string; value: string; licensees: { id: string; label: string }[] }) {
  const router = useRouter();
  return (
    <label className="ctl" htmlFor="scope">Report for
      <select id="scope" value={value} onChange={(e) => router.push(`/report?period=${period}${e.target.value ? `&licensee=${e.target.value}` : ""}`)}>
        <option value="">Ogun State (all licensees)</option>
        {licensees.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </label>
  );
}

function useSaver(onDone: () => void) {
  return useActionState<NoteState, FormData>(async (s, f) => { const r = await saveNote(s, f); if (r.ok) onDone(); return r; }, {});
}

/** Commission commentary under a report section. Shows as plain paragraphs in print. */
export function Note({ reportKey, section, body, editable, placeholder }: { reportKey: string; section: string; body: string; editable: boolean; placeholder?: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useSaver(() => setEditing(false));
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (editing)
    return (
      <form action={action} className="note-edit no-print">
        <input type="hidden" name="period" value={reportKey} />
        <input type="hidden" name="section" value={section} />
        <label className="legend" htmlFor={`note-${section}`}>EMPR analyst commentary (separate paragraphs with a blank line)</label>
        <textarea id={`note-${section}`} name="body" rows={6} defaultValue={body} placeholder={placeholder} />
        <div className="actions">
          <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save commentary"}</button>
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          {state.error && <span className="legend" style={{ color: "var(--bad)" }}>{state.error}</span>}
        </div>
      </form>
    );
  return (
    <div className="note">
      {paras.map((p, i) => <p key={i}>{p}</p>)}
      {editable && <button type="button" className="linkbtn no-print" onClick={() => setEditing(true)}>{paras.length ? "Edit commentary" : "Add analyst commentary"}</button>}
    </div>
  );
}

type Finding = { finding: string; directive: string; responsible: string; deadline: string };

/** Section 12: regulatory findings and directives, edited as a table. */
export function Findings({ reportKey, initial, suggestions }: { reportKey: string; initial: Finding[]; suggestions: Finding[] }) {
  const [rows, setRows] = useState<Finding[]>(initial.length ? initial : []);
  const [dirty, setDirty] = useState(false);
  const [state, action, pending] = useSaver(() => setDirty(false));
  const upd = (i: number, k: keyof Finding, v: string) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x))); setDirty(true); };
  return (
    <form action={action} className="findings">
      <input type="hidden" name="period" value={reportKey} />
      <input type="hidden" name="section" value="_findings" />
      <input type="hidden" name="body" value={JSON.stringify(rows.filter((r) => r.finding.trim()))} />
      <div className="scroll">
        <table className="compact">
          <thead><tr><th style={{ width: 28 }}>#</th><th>Finding</th><th>Directive / required action</th><th>Responsible</th><th>Deadline</th><th className="no-print" /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="num">{i + 1}</td>
                {(["finding", "directive", "responsible", "deadline"] as const).map((k) => (
                  <td key={k}>
                    <textarea className="cellinput no-print" rows={k === "finding" || k === "directive" ? 3 : 1} value={r[k]} aria-label={`${k} ${i + 1}`} onChange={(e) => upd(i, k, e.target.value)} />
                    <span className="print-only">{r[k]}</span>
                  </td>
                ))}
                <td className="no-print"><button type="button" className="linkbtn" onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); setDirty(true); }}>Remove</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="legend">No findings recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="actions no-print" style={{ alignItems: "center" }}>
        <button type="button" onClick={() => { setRows((r) => [...r, { finding: "", directive: "", responsible: "", deadline: "" }]); setDirty(true); }}>Add a finding</button>
        {suggestions.length > 0 && <button type="button" onClick={() => { setRows((r) => [...r, ...suggestions.filter((s) => !r.some((x) => x.finding === s.finding))]); setDirty(true); }}>Add suggested findings ({suggestions.length})</button>}
        <button className="primary" type="submit" disabled={pending || !dirty}>{pending ? "Saving…" : "Save findings"}</button>
        {state.ok && !dirty && <span className="legend">Saved.</span>}
      </div>
    </form>
  );
}

type Sign = { role: string; name: string; designation: string; date: string };

export function SignOff({ reportKey, initial }: { reportKey: string; initial: Sign[] }) {
  const [rows, setRows] = useState<Sign[]>(initial);
  const [state, action, pending] = useSaver(() => {});
  return (
    <form action={action}>
      <input type="hidden" name="period" value={reportKey} />
      <input type="hidden" name="section" value="_signoff" />
      <input type="hidden" name="body" value={JSON.stringify(rows)} />
      <div className="signoff">
        {rows.map((r, i) => (
          <div key={r.role} className="sign">
            <b>{r.role}</b>
            {(["name", "designation", "date"] as const).map((k) => (
              <label key={k}><span>{k[0].toUpperCase() + k.slice(1)}:</span>
                <input className="no-print" value={r[k]} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} />
                <span className="print-only">{r[k]}</span>
              </label>
            ))}
            <label><span>Signature:</span><span className="sigline" /></label>
          </div>
        ))}
      </div>
      <div className="actions no-print"><button type="submit" disabled={pending}>{pending ? "Saving…" : "Save sign-off"}</button>{state.ok && <span className="legend">Saved.</span>}</div>
    </form>
  );
}
