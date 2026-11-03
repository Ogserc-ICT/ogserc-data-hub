"use client";
import { useActionState, useRef, useState } from "react";
import { reviewSubmission, type ReviewState } from "./actions";

/** The chosen action travels in a hidden field, since a submit button's own name/value is not sent with a server action. */
export default function ReviewControls({ id, reviewed, ownSubmission }: { id: string; reviewed: boolean; ownSubmission: boolean }) {
  const [querying, setQuerying] = useState(false);
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewSubmission, {});
  const act = useRef<HTMLInputElement>(null);
  const set = (v: string) => () => { if (act.current) act.current.value = v; };
  const err = state.error && <span className="legend" role="alert" style={{ color: "var(--bad)" }}>{state.error}</span>;

  if (ownSubmission) {
    return (
      <form action={action} className="actions" style={{ flexDirection: "column", alignItems: "flex-start" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="act" ref={act} defaultValue="" />
        <span className="legend">You filed this submission. Another Commission reviewer must review it.</span>
        {reviewed && <button type="submit" onClick={set("reset")} disabled={pending}>Reset</button>}
        {err}
      </form>
    );
  }
  return (
    <form action={action} className="actions" style={{ flexDirection: querying ? "column" : "row", alignItems: querying ? "stretch" : "center", flexWrap: "wrap" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="act" ref={act} defaultValue="" />
      {querying ? (
        <>
          <textarea name="note" rows={2} aria-label="Query to the licensee" placeholder="What should the licensee correct or explain?" required minLength={5} />
          <div className="actions">
            <button type="submit" onClick={set("query")} disabled={pending}>Send query</button>
            <button type="button" onClick={() => setQuerying(false)}>Cancel</button>
          </div>
        </>
      ) : (
        <>
          <button type="submit" onClick={set("accept")} disabled={pending}>Accept</button>
          <button type="button" onClick={() => setQuerying(true)}>Query</button>
          {reviewed && <button type="submit" onClick={set("reset")} disabled={pending}>Reset</button>}
        </>
      )}
      {err}
    </form>
  );
}
