"use client";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <main className="login">
      <form action={action} className="card">
        <div>
          <span className="eyebrow">Ogun State Electricity Regulatory Commission</span>
          <h2 style={{ fontSize: 22 }}>OGSERC Data Hub</h2>
          <p className="sub">Sign in with the account the Commission issued to you.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {state.error && <p className="notice err" role="alert">{state.error}</p>}
        <button className="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        <p className="legend">Forgotten your password? Ask the Commission&apos;s Hub administrator to reset it.</p>
      </form>
    </main>
  );
}
