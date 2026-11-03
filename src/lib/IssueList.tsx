import type { Issue } from "@/db/schema";
import { periodLabel } from "./periods";

/** Errors first, then warnings grouped by message so long lists stay readable. */
export function IssueList({ issues, limit = 12 }: { issues: Issue[]; limit?: number }) {
  if (!issues.length) return <ul className="checks"><li className="pass"><span className="mk">✓</span><span>No problems found.</span></li></ul>;
  const groups = new Map<string, { level: Issue["level"]; message: string; refs: string[] }>();
  for (const i of issues) {
    const msg = i.message.replace(/\([^)]*\)/g, "").replace(/[\d.,]+ MWh/g, "").replace(/\s+/g, " ").replace(/\s+([.,;])/g, "$1").trim();
    const k = `${i.level}|${msg}`;
    const g = groups.get(k) ?? { level: i.level, message: msg, refs: [] };
    if (i.ref || i.period) g.refs.push([i.ref, i.period ? periodLabel(i.period, "short") : ""].filter(Boolean).join(", "));
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.level === b.level ? b.refs.length - a.refs.length : a.level === "error" ? -1 : 1));
  return (
    <ul className="checks">
      {list.slice(0, limit).map((g) => (
        <li key={g.level + g.message} className={g.level === "error" ? "err" : "fail"}>
          <span className="mk">{g.level === "error" ? "✕" : "!"}</span>
          <span>
            {g.message}
            {g.refs.length > 0 && <small className="refs"> {g.refs.length} case{g.refs.length > 1 ? "s" : ""}: {g.refs.slice(0, 4).join("; ")}{g.refs.length > 4 ? "; …" : ""}</small>}
          </span>
        </li>
      ))}
      {list.length > limit && <li className="legend">{list.length - limit} more kinds of issue. Download the issue list from the submission page.</li>}
    </ul>
  );
}
