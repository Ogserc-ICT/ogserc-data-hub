"use client";
import { useState } from "react";
import type { Sheet } from "@/lib/workbook";

const colName = (i: number) => { let n = "", x = i + 1; while (x > 0) { const m = (x - 1) % 26; n = String.fromCharCode(65 + m) + n; x = Math.floor((x - 1) / 26); } return n; };
const MAX_ROWS = 400;

export default function WorkbookView({ sheets }: { sheets: Sheet[] }) {
  const [i, setI] = useState(0);
  const s = sheets[Math.min(i, sheets.length - 1)];
  const pct = new Set(s.pctCols);
  const cols = Math.max(...s.rows.map((r) => r.length));
  const shown = s.rows.slice(0, MAX_ROWS);
  const show = (v: Sheet["rows"][number][number], c: number, r: number) => {
    if (v == null || v === "") return "";
    if (v instanceof Date) return v.toLocaleDateString("en-GB");
    if (typeof v === "number") return r > s.headerRow && pct.has(c) ? `${(v * 100).toFixed(1)}%` : v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
    return v;
  };
  return (
    <div className="wb">
      <div className="wb-scroll">
        <table className="wb-grid">
          <thead><tr><th className="rh" />{Array.from({ length: cols }, (_, c) => <th className="ch" key={c}>{colName(c)}</th>)}</tr></thead>
          <tbody>
            {shown.map((row, r) => (
              <tr key={r} className={r === s.headerRow ? "hdr" : undefined}>
                <th className="rh">{r + 1}</th>
                {Array.from({ length: cols }, (_, c) => <td key={c} className={typeof row[c] === "number" ? "n" : undefined} style={{ minWidth: Math.min((s.widths[c] ?? 12) * 7, 300) }}>{show(row[c], c, r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.rows.length > MAX_ROWS && <p className="legend" style={{ padding: "6px 10px" }}>Showing {MAX_ROWS} of {s.rows.length.toLocaleString("en-GB")} rows. Download the workbook for all of them.</p>}
      <div className="wb-tabs" role="tablist" aria-label="Sheets">
        {sheets.map((x, k) => <button key={x.name} type="button" role="tab" aria-selected={k === i} onClick={() => setI(k)}>{x.name} <small>{Math.max(0, x.rows.length - x.headerRow - 1)}</small></button>)}
      </div>
    </div>
  );
}
