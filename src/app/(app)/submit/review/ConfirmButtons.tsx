"use client";
import { useActionState } from "react";
import Link from "next/link";
import { confirmSubmission, discardSubmission, type ConfirmState } from "../actions";

export default function ConfirmButtons({ id, blocked }: { id: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmSubmission, {});
  if (state.done) return <p className="notice" role="status">{state.done} <Link href={`/submissions/${id}`}>View the submission</Link></p>;
  return (
    <div className="actions" style={{ alignItems: "center" }}>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button className="primary" type="submit" disabled={pending || blocked}>{pending ? "Filing…" : "Confirm and file"}</button>
      </form>
      <form action={discardSubmission}>
        <input type="hidden" name="id" value={id} />
        <button type="submit">Discard</button>
      </form>
      {blocked && <span className="legend" style={{ color: "var(--bad)" }}>Correct the errors in the workbook and upload it again.</span>}
      {state.error && <span className="legend" style={{ color: "var(--bad)" }} role="alert">{state.error}</span>}
    </div>
  );
}
