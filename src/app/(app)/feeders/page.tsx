import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { BANDS, SEGMENTS, looseKey } from "@/lib/datasets";
import { monthShort, periodLabel, window } from "@/lib/periods";
import { LineChart, fmt } from "@/lib/ui";

export default async function FeedersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const period = await resolvePeriod(sp);
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const band = typeof sp.band === "string" ? sp.band : "";
  const seg = typeof sp.segment === "string" ? sp.segment : "";
  const lic = user.isCommission ? (typeof sp.licensee === "string" ? sp.licensee : "") : user.lic ?? "__none__";
  const [lics, hubs, feeders] = await Promise.all([
    db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder)),
    db.select().from(schema.hubs),
    db.select().from(schema.feeders).where(lic ? eq(schema.feeders.licenseeId, lic) : undefined).orderBy(asc(schema.feeders.licenseeId), asc(schema.feeders.code), asc(schema.feeders.name)),
  ]);
  const byId = new Map(feeders.map((f) => [f.id, f]));
  const list = feeders.filter((f) => (!band || f.band === band) && (!seg || f.segment === seg) && (!q || looseKey(f.name).includes(looseKey(q)) || f.code?.toUpperCase() === q.toUpperCase() || f.aliases.some((a) => looseKey(a).includes(looseKey(q)))));
  const sel = typeof sp.id === "string" ? byId.get(sp.id) : list.length === 1 ? list[0] : undefined;
  const months = window(period, 12);
  const profile = sel ? await db.select().from(schema.feederMonthly).where(and(eq(schema.feederMonthly.feederId, sel.id), inArray(schema.feederMonthly.period, months))) : [];
  const H = (id: string | null) => hubs.find((h) => h.id === id)?.name ?? "";
  const children = sel ? feeders.filter((f) => f.parentId === sel.id) : [];
  const qs = (o: Record<string, string>) => new URLSearchParams({ period, ...(lic && user.isCommission ? { licensee: lic } : {}), ...(q ? { q } : {}), ...(band ? { band } : {}), ...(seg ? { segment: seg } : {}), ...o }).toString();

  return (
    <section className="view">
      <div>
        <h2>Feeder register</h2>
        <p className="sub">Every registered feeder with its OGSERC Feeder ID, business unit, level and parent injection point, service band, customer segment and tariff class. Licensees update it through the Feeder List sheet of the monthly return.</p>
      </div>
      <form className="filters" method="get">
        <input type="hidden" name="period" value={period} />
        {user.isCommission && <label className="ctl" htmlFor="flic">Licensee<select id="flic" name="licensee" defaultValue={lic}><option value="">All</option>{lics.filter((l) => l.obligations.includes("FEEDER")).map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>}
        <label className="ctl" htmlFor="fband">Band<select id="fband" name="band" defaultValue={band}><option value="">All</option>{BANDS.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="ctl" htmlFor="fseg">Segment<select id="fseg" name="segment" defaultValue={seg}><option value="">All</option>{SEGMENTS.map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="ctl" htmlFor="fq">Find<input id="fq" name="q" defaultValue={q} placeholder="Name or Feeder ID" /></label>
        <button type="submit">Apply</button>
        <span style={{ marginLeft: "auto" }} className="legend">{list.length} of {feeders.length} feeders</span>
      </form>
      {sel && (
        <div className="card">
          <div className="card-head">
            <div><h3>{sel.code ? `${sel.code} · ` : ""}{sel.name}</h3>
              <p className="sub small">{lics.find((l) => l.id === sel.licenseeId)?.code} · {H(sel.hubId)} · {sel.voltage} · {sel.level ?? "Level not set"}{sel.parentId ? ` from ${byId.get(sel.parentId)?.name}` : ""} · Band {sel.band ?? "—"} · {sel.segment ?? "segment not set"} / {sel.tariffClass ?? "class not set"}{sel.classificationBasis ? ` (${sel.classificationBasis})` : ""}</p></div>
            <Link className="btn" href={`/feeders?${qs({ id: "" })}`}>Close</Link>
          </div>
          <div className="two">
            <div><h3>Hours of supply, 12 months to {monthShort(period)}</h3><LineChart months={months} max={24} format={(v) => fmt(v, 1)} refLine={sel.band ? { value: { A: 20, B: 16, C: 12, D: 8, E: 4 }[sel.band] ?? 0, label: `Band ${sel.band} floor` } : undefined} series={[{ name: "Hours per day", values: months.map((m) => profile.find((p) => p.period === m)?.hoursPerDay ?? null), tone: "s1" }]} /></div>
            <div><h3>Energy supplied and nominated (MWh)</h3><LineChart months={months} format={(v) => fmt(v, 0)} series={[{ name: "Supplied", values: months.map((m) => profile.find((p) => p.period === m)?.deliveredMwh ?? null), tone: "s1" }, { name: "Nominated", values: months.map((m) => profile.find((p) => p.period === m)?.nominatedMwh ?? null), tone: "s2", dashed: true }]} /></div>
          </div>
          {children.length > 0 && <p className="legend">Feeders drawn through this injection point: {children.map((c) => c.name).join("; ")}.</p>}
          {sel.aliases.length > 0 && <p className="legend">Also known in returns as: {sel.aliases.join("; ")}.</p>}
          {Object.keys(sel.attrs).length > 0 && <p className="legend">{Object.entries(sel.attrs).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>}
        </div>
      )}
      <div className="card">
        <div className="scroll" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="compact">
            <thead><tr><th>Feeder ID</th><th>Feeder</th>{!lic && <th>Licensee</th>}<th>Unit</th><th>kV</th><th>Level</th><th>Parent injection point</th><th>Band</th><th>Segment</th><th>Class</th><th>Basis</th></tr></thead>
            <tbody>{list.map((f) => (
              <tr key={f.id}>
                <td className="num">{f.code ?? "—"}</td><td><Link href={`/feeders?${qs({ id: f.id })}`}>{f.name}</Link></td>{!lic && <td>{lics.find((l) => l.id === f.licenseeId)?.code}</td>}
                <td>{H(f.hubId)}</td><td>{f.voltage.replace("kV", "")}</td><td>{f.level ?? ""}</td><td style={{ fontSize: 12 }}>{f.parentId ? byId.get(f.parentId)?.name : ""}</td><td>{f.band}</td><td>{f.segment}</td><td>{f.tariffClass}</td><td style={{ fontSize: 12 }} className="muted">{f.classificationBasis}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </div>
      <p className="legend">Data shown for {periodLabel(period)} and the eleven months before it.</p>
    </section>
  );
}
