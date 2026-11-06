"use client";
import { useActionState, useState } from "react";
import { DATASETS, LICENSEE_DATASETS } from "@/lib/datasets";
import { clearSubmissions, createApiKey, createUser, deleteUser, resetPassword, saveLicensee, type AdminState, type KeyState } from "./actions";

function Msg({ s }: { s: AdminState }) {
  if (s.error) return <p className="notice err" role="alert">{s.error}</p>;
  if (s.ok) return <p className="notice" role="status">{s.ok}</p>;
  return null;
}

export function NewUserForm({ licensees }: { licensees: { id: string; name: string; area: string }[] }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(createUser, {});
  const [role, setRole] = useState("licensee");
  return (
    <form action={action} className="card">
      <h3>Add a user</h3>
      <div className="fields">
        <div className="field"><label htmlFor="u_name">Name</label><input id="u_name" name="name" required /></div>
        <div className="field"><label htmlFor="u_email">Email</label><input id="u_email" name="email" type="email" required /></div>
        <div className="field">
          <label htmlFor="u_role">Role</label>
          <select id="u_role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="licensee">Licensee officer (submits own returns)</option>
            <option value="reviewer">Commission reviewer</option>
            <option value="admin">Commission administrator</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="u_lic">Licensee</label>
          <select id="u_lic" name="licenseeId" disabled={role !== "licensee"}>
            {licensees.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.area}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="u_pw">Temporary password</label><input id="u_pw" name="password" type="text" minLength={10} autoComplete="off" required /><span className="hint">At least 10 characters</span></div>
      </div>
      <Msg s={state} />
      <div><button className="primary" type="submit" disabled={pending}>Create account</button></div>
    </form>
  );
}

export function ResetPasswordForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(resetPassword, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Reset password</button>;
  return (
    <form action={action} className="actions">
      <input type="hidden" name="id" value={id} />
      <input name="password" type="text" minLength={10} placeholder="New password" aria-label="New password" autoComplete="off" />
      <button type="submit" disabled={pending}>Save</button>
      {state.ok && <span className="legend">{state.ok}</span>}
      {state.error && <span className="legend" style={{ color: "var(--bad)" }}>{state.error}</span>}
    </form>
  );
}

export function DeleteUserForm({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(deleteUser, {});
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(`Delete ${name}'s account permanently? This cannot be undone. Their past submissions stay on record under their name.`)) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="danger" disabled={pending}>{pending ? "Deleting…" : "Delete"}</button>
      {state.error && <span className="legend" style={{ color: "var(--bad)", display: "block" }}>{state.error}</span>}
    </form>
  );
}

const CLEARABLE = [
  { status: "received", label: "Received" },
  { status: "superseded", label: "Superseded" },
  { status: "staged", label: "Awaiting confirmation" },
  { status: "accepted", label: "Accepted" },
  { status: "queried", label: "Queried" },
  { status: "discarded", label: "Discarded" },
] as const;
const CLEAR_DEFAULT = ["received", "superseded", "staged", "accepted"];

export function ClearSubmissionsForm({ counts }: { counts: Record<string, number> }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(clearSubmissions, {});
  return (
    <form action={action} className="card" onSubmit={(e) => { if (!window.confirm("Permanently delete the selected submissions and all data filed from them? This cannot be undone.")) e.preventDefault(); }}>
      <h3>Clear submissions</h3>
      <p className="sub small">Permanently deletes submissions with the statuses you tick, together with the monthly data filed from them. Overview, report and data pages will no longer show that data. Feeder register changes made by earlier uploads are kept.</p>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: 13, fontWeight: 600 }}>Statuses to clear</legend>
        {CLEARABLE.map((c) => (
          <label key={c.status} style={{ fontSize: 14, display: "flex", gap: 6 }}>
            <input type="checkbox" name={`st_${c.status}`} defaultChecked={CLEAR_DEFAULT.includes(c.status)} />{c.label} <span className="muted">({counts[c.status] ?? 0})</span>
          </label>
        ))}
      </fieldset>
      <div className="fields">
        <div className="field"><label htmlFor="clr_confirm">Type DELETE to confirm</label><input id="clr_confirm" name="confirm" autoComplete="off" placeholder="DELETE" required /></div>
      </div>
      <Msg s={state} />
      <div><button className="primary danger" type="submit" disabled={pending}>{pending ? "Clearing…" : "Clear selected submissions"}</button></div>
    </form>
  );
}

export function LicenseeForm() {
  const [state, action, pending] = useActionState<AdminState, FormData>(saveLicensee, {});
  return (
    <form action={action} className="card">
      <h3>Add or update a licensee</h3>
      <p className="sub" style={{ fontSize: 13 }}>Using an existing short code updates that licensee.</p>
      <div className="fields">
        <div className="field"><label htmlFor="l_id">Hub ID (lower case)</label><input id="l_id" name="id" placeholder="e.g. ibedc" required /></div>
        <div className="field"><label htmlFor="l_code">Licensee code</label><input id="l_code" name="code" placeholder="e.g. IBEDC" required /><span className="hint">As written in returns and the EMPR workbooks</span></div>
        <div className="field"><label htmlFor="l_name">Name</label><input id="l_name" name="name" required /></div>
        <div className="field"><label htmlFor="l_area">Area or franchise</label><input id="l_area" name="area" required /></div>
        <div className="field">
          <label htmlFor="l_type">Type</label>
          <select id="l_type" name="type" defaultValue="Successor DisCo"><option>Successor DisCo</option><option>IEDN</option><option>IEDN / embedded network</option><option>Mini-grid</option><option>Generation licensee</option><option>Integrated (generation + distribution)</option><option>NERC-licensed (monitored)</option></select>
        </div>
        <div className="field">
          <label htmlFor="l_status">Licence status</label>
          <select id="l_status" name="licenceStatus" defaultValue="Licensed">
            <option>Licensed</option><option>Interim licence</option><option>SubCo licence pending</option><option>Unlicensed</option>
          </select>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, fontWeight: 600 }}>Monthly returns owed</legend>
          {LICENSEE_DATASETS.map((d) => (
            <label key={d} style={{ fontSize: 14, display: "flex", gap: 6 }}><input type="checkbox" name={`d_${d}`} defaultChecked={["FEEDER", "COMMERCIAL", "COMPLAINTS", "REGISTER"].includes(d)} />{DATASETS[d].label}</label>
          ))}
        </fieldset>
      </div>
      <Msg s={state} />
      <div><button className="primary" type="submit" disabled={pending}>Save licensee</button></div>
    </form>
  );
}

export function ApiKeyForm({ licensees }: { licensees: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<KeyState, FormData>(createApiKey, {});
  return (
    <form action={action} className="card">
      <h3>Issue an API key</h3>
      <p className="sub small">For a licensee&apos;s billing or SCADA system to file returns directly. The key is shown once; give it to the licensee&apos;s IT lead securely.</p>
      <div className="fields">
        <div className="field"><label htmlFor="k_lic">Licensee</label><select id="k_lic" name="licenseeId">{licensees.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="field"><label htmlFor="k_label">What it is for</label><input id="k_label" name="label" placeholder="e.g. IBEDC billing system" required /></div>
      </div>
      {state.error && <p className="notice err" role="alert">{state.error}</p>}
      {state.key && <div className="notice" role="status"><b>Copy this key now; it will not be shown again.</b><pre className="code" style={{ margin: "6px 0 0", userSelect: "all" }}>{state.key}</pre></div>}
      <div><button className="primary" type="submit" disabled={pending}>Issue key</button></div>
    </form>
  );
}
