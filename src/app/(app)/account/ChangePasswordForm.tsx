"use client";
import { useActionState } from "react";
import { changePassword, type AccountState } from "./actions";

export default function ChangePasswordForm() {
  const [state, action, pending] = useActionState<AccountState, FormData>(changePassword, {});
  return (
    <form action={action} className="card" style={{ maxWidth: 480 }}>
      <h3>Change password</h3>
      <div className="field">
        <label htmlFor="pw_cur">Current password</label>
        <input id="pw_cur" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="field">
        <label htmlFor="pw_new">New password</label>
        <input id="pw_new" name="next" type="password" autoComplete="new-password" minLength={10} required />
        <span className="hint">At least 10 characters</span>
      </div>
      <div className="field">
        <label htmlFor="pw_conf">Confirm new password</label>
        <input id="pw_conf" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </div>
      {state.error && <p className="notice err" role="alert">{state.error}</p>}
      {state.ok && <p className="notice" role="status">{state.ok}</p>}
      <div><button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Change password"}</button></div>
    </form>
  );
}
