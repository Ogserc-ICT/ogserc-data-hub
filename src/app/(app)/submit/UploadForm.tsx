"use client";
import { useActionState, useState } from "react";
import { uploadWorkbook, type UploadState } from "./actions";

const MAX_MB = 4;

export default function UploadForm({ licensees, fixedLicensee, year }: { licensees: { id: string; name: string; area: string }[]; fixedLicensee: string | null; year: number }) {
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadWorkbook, {});
  // Checked here too, because an oversized request is rejected by the host before the app can explain why.
  const [tooBig, setTooBig] = useState<string | null>(null);
  return (
    <form action={action} className="card">
      <h3>Upload a workbook</h3>
      <div className="fields">
        {fixedLicensee ? (
          <input type="hidden" name="licensee" value={fixedLicensee} />
        ) : (
          <div className="field">
            <label htmlFor="licensee">Licensee</label>
            <select id="licensee" name="licensee" required defaultValue={licensees[0]?.id}>
              {licensees.map((l) => <option key={l.id} value={l.id}>{l.name} — {l.area}</option>)}
            </select>
            <span className="hint">For energy caps, choose the distribution licensee the caps apply to.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="year">Year, if the file names months only</label>
          <input id="year" name="year" type="number" min={2020} max={2100} defaultValue={year} className="n" />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="file">Excel workbook (.xlsx)</label>
          <input id="file" name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required
            onChange={(e) => {
              const f = e.target.files?.[0];
              setTooBig(f && f.size > MAX_MB * 1024 * 1024 ? `${f.name} is ${(f.size / 1048576).toFixed(1)} MB. The limit is ${MAX_MB} MB: split it by month or remove unused sheets, then upload each part.` : null);
            }} />
          <span className="hint">Up to {MAX_MB} MB. The Hub recognises the layout and the months it covers. You check the result before anything is filed.</span>
        </div>
      </div>
      {tooBig && <p className="notice err" role="alert">{tooBig}</p>}
      {state.error && !tooBig && <p className="notice err" role="alert">{state.error}</p>}
      <div><button className="primary" type="submit" disabled={pending || !!tooBig}>{pending ? "Reading the workbook…" : "Upload and check"}</button></div>
    </form>
  );
}
