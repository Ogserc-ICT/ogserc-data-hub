import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { isPeriod, isSpanKind, makeSpan, periodLabel, recentPeriods, spanOptions } from "@/lib/periods";
import { DATASETS } from "@/lib/datasets";
import { commercial, commission, complaints, complianceGrid, dataQuality } from "@/lib/metrics";
import { sbtMonitor, OPEN_REFERRAL } from "@/lib/sbt";
import { generation } from "@/lib/generation";
import { loadForecast } from "@/lib/forecast";
import { getSettings } from "@/lib/settings-db";
import { targetStatus, type Target } from "@/lib/settings";
import { Columns, HBars, LineChart, StatusPill, fmt, ngn, pct } from "@/lib/ui";
import { Findings, Note, PrintButton, ReportPeriod, ScopeSelect, SignOff } from "./Client";
import { setReportStatus } from "./actions";

export const metadata = { title: "OGEM Market Report · OGSERC Data Hub" };

const EDITION = { month: "Monthly", quarter: "Quarterly", year: "Annual" } as const;

const SECTIONS = [
  ["summary", "Executive summary"], ["supply", "Supply and reliability"], ["sbt", "Service-based tariff band monitoring"], ["commercial", "Commercial performance"],
  ["comparison", "Licensee comparison and business-unit league"], ["metering", "Metering, estimated billing and energy caps"], ["complaints", "Customer complaints"],
  ["generation", "Generation"], ["demand", "Demand and load forecast baseline"], ["commission", "Commission operations"],
  ["quality", "Data quality and compliance with reporting obligations"], ["findings", "Regulatory findings and directives"], ["signoff", "Sign-off"],
] as const;

type Ind = { label: string; unit: string; cur: number | null | undefined; prev: number | null | undefined; ytd?: number | null; target?: Target; kind: "pct" | "gwh" | "n" | "h" | "x" | "ngnbn" | "ngn" | "d2" };
const show = (v: number | null | undefined, k: Ind["kind"]) =>
  v == null || !Number.isFinite(v) ? "—" : k === "pct" ? pct(v) : k === "gwh" ? fmt(v / 1000, 2) : k === "h" ? fmt(v, 2) : k === "x" ? `${fmt(v, 2)}×` : k === "ngnbn" ? fmt(v / 1e9, 2) : k === "ngn" ? fmt(v, 2) : k === "d2" ? fmt(v, 2) : fmt(v);
const chg = (a: number | null | undefined, b: number | null | undefined, k: Ind["kind"]) => {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return "—";
  if (k === "pct") { const d = (a - b) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)} pts`; }
  if (!b) return "—";
  const d = ((a - b) / Math.abs(b)) * 100; return `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`;
};

function IndicatorTable({ rows, prevLabel, curLabel, ytdLabel }: { rows: Ind[]; prevLabel: string; curLabel: string; ytdLabel: string | null }) {
  return (
    <div className="scroll">
      <table className="compact ind">
        <thead><tr><th>Indicator</th><th>Unit</th><th className="n">{curLabel}</th><th className="n">{prevLabel}</th><th className="n">Change</th>{ytdLabel && <th className="n">{ytdLabel}</th>}<th className="n">Target</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const st = targetStatus(r.target, r.cur);
            return (
              <tr key={r.label}>
                <td>{r.label}</td><td className="muted">{r.unit}</td>
                <td className="n num"><b>{show(r.cur, r.kind)}</b></td><td className="n num">{show(r.prev, r.kind)}</td><td className="n num">{chg(r.cur, r.prev, r.kind)}</td>
                {ytdLabel && <td className="n num">{r.ytd === undefined ? "" : show(r.ytd, r.kind)}</td>}
                <td className="n num">{r.target ? `${r.target.dir === "min" ? "≥" : "≤"} ${r.target.unit === "pct" ? pct(r.target.value, 0) : r.target.unit === "x" ? `${r.target.value}×` : fmt(r.target.value)}` : ""}</td>
                <td>{st === "on" ? <span className="st on">✔ On target</span> : st === "off" ? <span className="st off">✖ {r.target!.dir === "min" ? "Below" : "Above"} target</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireCommission();
  const sp = await searchParams;
  // The report opens on the current month; ?span= picks a quarterly or annual edition and ?period= its last month.
  const current = recentPeriods()[0];
  const kind = isSpanKind(sp.span) ? sp.span : "month";
  const asked = typeof sp.period === "string" && isPeriod(sp.period) && sp.period <= current && recentPeriods(new Date(), 48).includes(sp.period) ? sp.period : current;
  const span = makeSpan(kind, asked, current);
  const period = span.end, M = span.months;
  const multi = M.length > 1;
  const lics = await db.select().from(schema.licensees).orderBy(asc(schema.licensees.sortOrder));
  const scope = typeof sp.licensee === "string" ? lics.find((l) => l.id === sp.licensee) ?? null : null;
  const L = scope?.id ?? null;
  const reportKey = L ? `${span.key}:${L}` : span.key;
  const range = { months: M, prevMonths: span.prevMonths };
  const [s, cgs, com, comAll, cmp, sbt, gen, fc, ops, dq, notes] = await Promise.all([
    getSettings(), Promise.all(M.map((m) => complianceGrid(m, L))), commercial(period, { licensee: L, ...range }), L ? commercial(period, range) : null, complaints(period, { licensee: L, ...range }), sbtMonitor(period, L),
    generation(period, M), loadForecast(period, L), commission(period, M), dataQuality(period, L, M),
    db.select().from(schema.reportNotes).where(eq(schema.reportNotes.period, reportKey)),
  ]);
  // Returns status over the span: one grid per month, totals added up; the grid shown is the last month's.
  const cg = cgs.at(-1)!;
  const cgTotals = { due: sum(cgs.map((g) => g.totals.due)), received: sum(cgs.map((g) => g.totals.received)), missing: sum(cgs.map((g) => g.totals.missing)) };
  const P = span.label; // "November 2026", "Q4 2026", "2026"
  const inP = multi ? `over ${span.range}` : `in ${P}`;
  const tech = com.tech, T = tech.total, TP = tech.prev, C = com.total, CP = com.prev;
  const all = comAll ?? com;
  const note = (k: string) => notes.find((n) => n.section === k)?.body ?? "";
  const status = notes.find((n) => n.section === "_status")?.status ?? "draft";
  const tg = (k: string) => s.marketTargets.find((t) => t.key === k);
  const LN = (id: string) => lics.find((l) => l.id === id);
  const reference = `OGSERC/EMPR/FPR/${span.key.replace("-", "/")}/${scope?.code || "OGEM"}`;
  const cur = span.short, prv = span.prevShort;
  const ytdLabel = kind === "year" ? null : `YTD (Jan–${makeSpan("month", period, current).short})`;
  const curLabel = kind === "month" ? `This month (${cur})` : span.partial ? `${cur} to date` : cur;
  const prevLabel = kind === "month" ? `Previous (${prv})` : `${prv}${span.partial ? " (same months)" : ""}`;
  const findings = (() => { try { return JSON.parse(note("_findings") || "[]"); } catch { return []; } })();
  const signoff = (() => { try { const v = JSON.parse(note("_signoff") || "null"); if (Array.isArray(v)) return v; } catch { /* default */ } return [
    { role: "Prepared by (EMPR analyst)", name: "", designation: "", date: "" }, { role: "Reviewed by (Head, EMPR)", name: "", designation: "", date: "" }, { role: "Approved by", name: "", designation: "", date: "" },
  ]; })();

  // Findings the data already supports, offered to the analyst as starting points.
  const suggestions = [
    ...(T.compliance != null && T.compliance < s.flags.critComp ? [{ finding: `Only ${pct(T.compliance, 0)} of reporting feeder-months met their service band ${inP}.`, directive: "Submit a band restoration plan for every feeder in breach for two or more consecutive months, or apply for re-banding with evidence.", responsible: scope?.code || "Distribution licensees", deadline: "" }] : []),
    ...(com.reconciliation.ratio != null && com.reconciliation.ratio > (tg("receivedVsMetered")?.value ?? 1.1) ? [{ finding: `Energy received in billing returns is ${fmt(com.reconciliation.ratio, 2)}× the de-duplicated feeder-metered energy.`, directive: "Carry out a joint meter reconciliation of injection and feeder meters with OGSERC metering staff and restate energy received.", responsible: scope?.code || "Distribution licensees / OGSERC Metering", deadline: "" }] : []),
    ...(C.estimationRatio != null && C.estimationRatio > (tg("estimationRatio")?.value ?? 1) ? [{ finding: `Unmetered non-MD customers were billed ${fmt(C.estimationRatio, 2)}× the energy of metered non-MD customers per head.`, directive: "Submit the estimated-billing methodology by feeder and refund any billing above the applicable energy cap.", responsible: scope?.code || "Distribution licensees", deadline: "" }] : []),
    ...(sbt.totals.candidates ? [{ finding: `${sbt.totals.candidates} feeders breached their band floor for ${s.sbtConsecutive} or more consecutive months and are not yet referred.`, directive: "Log breach referrals to Compliance for each candidate feeder.", responsible: "OGSERC Performance Monitoring", deadline: "" }] : []),
    ...(cgTotals.missing ? [{ finding: `${cgTotals.missing} of ${cgTotals.due} returns due for ${P} had not been filed.`, directive: "File the outstanding returns through the Data Hub.", responsible: "Licensees concerned", deadline: "" }] : []),
  ];

  const Section = ({ id, n, title, children, noNote }: { id: string; n: number; title: string; children: React.ReactNode; noNote?: boolean }) => (
    <section className="rsec" id={id}>
      <h2><span className="secno">{n}.</span>{title}</h2>
      {children}
      {!noNote && <Note reportKey={reportKey} section={id} body={note(id)} editable />}
    </section>
  );
  const licComparison = lics.filter((l) => l.obligations.includes("FEEDER") || l.obligations.includes("COMMERCIAL")).map((l) => {
    const t = (comAll ?? com).tech.byLicensee.find((x) => x.licenseeId === l.id);
    const c = all.byLicensee.find((x) => x.licenseeId === l.id);
    return { l, t, c };
  });
  const allT = (comAll ?? com).tech.total, allC = all.total;

  return (
    <article className="report">
      <div className="report-tools no-print">
        <ReportPeriod span={kind} period={period} licensee={L ?? ""} options={{ month: spanOptions("month"), quarter: spanOptions("quarter"), year: spanOptions("year") }} />
        <ScopeSelect span={kind} period={period} value={L ?? ""} licensees={lics.filter((l) => l.obligations.includes("FEEDER")).map((l) => ({ id: l.id, label: `${l.code} — ${l.name}` }))} />
        <form action={setReportStatus} className="actions" style={{ alignItems: "center" }}>
          <input type="hidden" name="period" value={reportKey} />
          <input type="hidden" name="status" value={status === "approved" ? "draft" : "approved"} />
          <span className={`pill ${status === "approved" ? "s-validated" : "s-flagged"}`}>{status === "approved" ? "Approved for issue" : "Draft"}</span>
          <button type="submit">{status === "approved" ? "Return to draft" : "Approve for issue"}</button>
        </form>
        <div className="actions">
          <a className="btn" href={`/api/export?period=${period}`}>Data annex (.xlsx)</a>
          <PrintButton />
        </div>
      </div>

      {/* Printed first page on the OGSERC letterhead (registers/OGSERC_Letterhead_1_Classic.docx); the letterhead parts show only in print. */}
      <div className="lh-page">
      <div className="lh-part lh-border" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lh-part lh-watermark" src="/brand/letterhead-watermark.jpg" alt="" aria-hidden="true" />
      <div className="lh-part lh-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="lh-logo" src="/brand/letterhead-logo.png" alt="OGSERC" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="lh-name" src="/brand/letterhead-name.png" alt="Ogun State Electricity Regulatory Commission" />
        <div className="lh-rule" />
      </div>
      <header className="cover">
        <span className="eyebrow">Ogun State Electricity Regulatory Commission (OGSERC) · EMPR Division</span>
        <h1>OGEM {EDITION[kind]} Market Report</h1>
        <p className="cover-period">{scope ? scope.name : "Ogun State Electricity Market"} · {P}{multi ? ` (${span.range}${span.partial ? ", to date" : ""})` : ""}</p>
        <div className="scroll"><table className="meta">
          <tbody>
            <tr><th>Reporting period</th><td>{multi ? `${P} · ${span.range}` : P}</td><th>Coverage</th><td>{scope ? `${scope.code} — ${scope.name}` : "All licensees"}</td></tr>
            <tr><th>Report reference</th><td className="num">{reference}</td><th>Status</th><td>{status === "approved" ? "Approved for issue" : "Draft"}</td></tr>
            <tr><th>Generated</th><td>{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" })}</td><th>Distribution</th><td>OGSERC Board; Ministry of Energy; {scope ? scope.code : "licensees"}</td></tr>
          </tbody>
        </table></div>
        {dq.examples && <p className="notice err">This edition includes example data in some sections. Remove it before issue.</p>}
        <nav className="toc no-print">{SECTIONS.map(([id, t], i) => <a key={id} href={`#${id}`}>{i + 1}. {t}</a>)}</nav>
      </header>
      <div className="lh-part lh-foot">
        <p>Floors 5 &amp; 6, OPIC Towers, Central Business District, Oke-Ilewo, Abeokuta, Ogun State</p>
        <div className="lh-band" />
      </div>
      </div>

      <Section id="summary" n={1} title="Executive summary">
        <div className="kpis">
          <Kpi vs={span.noun} k="Avg. supply per feeder" v={`${fmt(T.avgHours, 1)} h/day`} d={chg(T.avgHours, TP.avgHours, "h")} />
          <Kpi vs={span.noun} k="Band compliance" v={pct(T.compliance, 0)} d={chg(T.compliance, TP.compliance, "pct")} />
          <Kpi vs={span.noun} k="Energy supplied" v={`${fmt(T.delivered / 1000, 1)} GWh`} d={chg(T.delivered, TP.delivered, "gwh")} />
          <Kpi vs={span.noun} k="Fulfilment" v={pct(T.fulfilment, 0)} d={chg(T.fulfilment, TP.fulfilment, "pct")} />
          <Kpi vs={span.noun} k="Billing efficiency" v={pct(C.be)} d={chg(C.be, CP.be, "pct")} />
          <Kpi vs={span.noun} k="Collection efficiency" v={pct(C.ce)} d={chg(C.ce, CP.ce, "pct")} />
          <Kpi vs={span.noun} k="ATC&C (kWh / ₦)" v={`${pct(C.atcc, 0)} / ${pct(C.atccNgn, 0)}`} d={chg(C.atcc, CP.atcc, "pct")} />
          <Kpi vs={span.noun} k="Returns received" v={`${cgTotals.received} of ${cgTotals.due}`} d="" />
        </div>
        <ul className="bullets">
          {tech.hasData && <li>{multi ? `Over ${span.range}` : `In ${P}`}, {T.reporting} of {T.feeders} feeders reported hours of supply, averaging {fmt(T.avgHours, 1)} hours a day. {multi ? `${pct(T.compliance, 0)} of feeder-months` : `${T.meeting} (${pct(T.compliance, 0)})`} met their band commitment (hours at or above {pct(s.bandThreshold, 0)} of the band floor).</li>}
          {tech.hasData && <li>Feeders supplied {fmt(T.delivered / 1000, 1)} GWh against {fmt(T.nominated / 1000, 1)} GWh nominated, a fulfilment of {pct(T.fulfilment, 0)}; {fmt(T.unserved / 1000, 1)} GWh went unserved. Energy is counted once per injection point.</li>}
          {com.hasData && <li>Licensees reported {fmt(C.receivedMwh / 1000, 1)} GWh received and billed {fmt(C.billedMwh / 1000, 1)} GWh ({pct(C.be, 0)}). They billed {ngn(C.billedNgn)} and collected {ngn(C.collected)} ({pct(C.ce, 1)}). ATC&amp;C loss was {pct(C.atcc)} by energy and {pct(C.atccNgn)} by value.</li>}
          {com.hasData && <li>The metering rate stood at {pct(C.meteringRate)} of {fmt(C.customers)} customers. Unmetered non-MD customers were billed {fmt(C.estimationRatio, 2)}× the kWh per head of metered non-MD customers.</li>}
          {com.reconciliation.ratio != null && Math.abs(com.reconciliation.ratio - 1) > 0.05 && <li>Energy received in billing returns is {fmt(com.reconciliation.ratio, 2)}× the feeder-metered energy. The two returns should reconcile (section 4).</li>}
          {sbt.totals.breaches > 0 && <li>{sbt.totals.breaches} feeders breached their band floor in {periodLabel(period)}; {sbt.list.filter((x) => x.run >= s.sbtConsecutive).length} have breached for {s.sbtConsecutive}+ consecutive months. {sbt.totals.openReferrals} breach referrals are open with Compliance.</li>}
          {cgTotals.missing > 0 && <li>{cgTotals.missing} of {cgTotals.due} returns due for {multi ? "the period" : "the month"} had not been filed when this report was generated.</li>}
        </ul>
      </Section>

      <Section id="supply" n={2} title="Supply and reliability (feeder returns)">
        {!tech.hasData ? <p className="empty">No feeder returns were filed for {P}.</p> : (<>
          <IndicatorTable curLabel={curLabel} prevLabel={prevLabel} ytdLabel={ytdLabel} rows={[
            { label: "Energy nominated", unit: "GWh", cur: T.nominated, prev: TP.nominated, ytd: tech.ytd.nominated, kind: "gwh" },
            { label: "Energy supplied (feeder meters)", unit: "GWh", cur: T.delivered, prev: TP.delivered, ytd: tech.ytd.delivered, kind: "gwh" },
            { label: "Fulfilment", unit: "%", cur: T.fulfilment, prev: TP.fulfilment, ytd: tech.ytd.fulfilment, target: tg("fulfilment"), kind: "pct" },
            { label: "Unserved energy", unit: "GWh", cur: T.unserved, prev: TP.unserved, ytd: tech.ytd.unserved, kind: "gwh" },
            { label: "Average supply hours per day", unit: "h", cur: T.avgHours, prev: TP.avgHours, ytd: tech.ytd.avgHours, kind: "h" },
            { label: "Band compliance (feeder-months meeting band)", unit: "%", cur: T.compliance, prev: TP.compliance, ytd: tech.ytd.compliance, target: tg("compliance"), kind: "pct" },
            { label: "Feeder returns received (energy supplied entered)", unit: "no.", cur: T.returned, prev: TP.returned, ytd: tech.ytd.returned, kind: "n" },
            { label: "Interruptions", unit: "no.", cur: T.interruptions, prev: TP.interruptions, ytd: tech.ytd.interruptions, kind: "n" },
            { label: "Fault trips", unit: "no.", cur: T.faultTrips, prev: TP.faultTrips, ytd: tech.ytd.faultTrips, kind: "n" },
            { label: "SAIDI (customer-weighted outage hours)", unit: "h", cur: T.saidi, prev: TP.saidi, ytd: tech.ytd.saidi, kind: "d2" },
            { label: "SAIFI (interruptions per customer)", unit: "no.", cur: T.saifi, prev: TP.saifi, ytd: tech.ytd.saifi, kind: "d2" },
          ]} />
          <div className="two">
            <div>
              <h3>Supply hours by band against the band floor</h3>
              <HBars max={24} ticks={[0, 6, 12, 18, 24]} unit=" h" legend="Marker: hours committed for the band"
                items={tech.byBand.map((b) => ({ label: `Band ${b.band} (${b.reporting})`, value: b.avgHours, target: b.threshold, tone: (b.avgHours ?? 0) >= b.threshold * s.bandThreshold ? "ok" : (b.avgHours ?? 0) >= b.threshold - 4 ? "warn" : "bad" }))} />
            </div>
            <div>
              <h3>Average supply hours, last {tech.months.length} months</h3>
              <LineChart months={tech.months} max={24} format={(v) => fmt(v, 1)} series={[{ name: "Hours per day", values: tech.trend.map((t) => (t.reporting ? t.avgHours : null)), tone: "s1" }]} />
            </div>
          </div>
          <div className="scroll"><table className="compact">
            <thead><tr><th>Band</th><th className="n">Feeders</th><th className="n">Owed (h)</th><th className="n">Avg h/day</th><th className="n">Meeting band</th><th className="n">Supplied (MWh)</th><th className="n">Fulfilment</th><th className="n">Interruptions / feeder</th></tr></thead>
            <tbody>{tech.byBand.map((b) => <tr key={b.band}><td>Band {b.band}</td><td className="n num">{b.reporting}</td><td className="n num">{b.threshold}</td><td className="n num">{fmt(b.avgHours, 1)}</td><td className="n num">{b.meeting} ({pct(b.compliance, 0)})</td><td className="n num">{fmt(b.delivered)}</td><td className="n num">{pct(b.fulfilment, 0)}</td><td className="n num">{fmt(b.interruptionsPerFeeder, 1)}</td></tr>)}</tbody>
          </table></div>
          {tech.bySegment.length > 1 && (<>
            <h3>By customer segment</h3>
            <div className="scroll"><table className="compact">
              <thead><tr><th>Segment</th><th className="n">Feeders</th><th className="n">Avg h/day</th><th className="n">Band compliance</th><th className="n">Supplied (MWh)</th><th className="n">Interruptions</th></tr></thead>
              <tbody>{tech.bySegment.map((x) => <tr key={x.segment}><td>{x.segment}</td><td className="n num">{x.reporting}</td><td className="n num">{fmt(x.avgHours, 1)}</td><td className="n num">{pct(x.compliance, 0)}</td><td className="n num">{fmt(x.delivered)}</td><td className="n num">{fmt(x.interruptions)}</td></tr>)}</tbody>
            </table></div>
            <p className="legend">MD feeders serve maximum-demand customers on contractual 20–24 hour supply. Segments marked &quot;inferred by OGSERC&quot; await licensee confirmation ({tech.unconfirmedClass} feeders).</p>
          </>)}
          {tech.worst.length > 0 && (<>
            <h3>Ten feeders furthest below their band commitment — {P}{multi ? " (average over the period)" : ""}</h3>
            <div className="scroll"><table className="compact">
              <thead><tr><th>Feeder</th><th>Licensee</th><th>Unit</th><th>Band</th><th className="n">Avg h/day</th><th className="n">Owed h/day</th><th className="n">Hour gap</th><th className="n">Interruptions</th></tr></thead>
              <tbody>{tech.worst.map((w, i) => <tr key={w.feeder}><td>{i + 1}. {w.feeder}{w.code ? <small className="refs"> · {w.code}</small> : null}</td><td>{LN(w.licenseeId)?.code}</td><td>{w.hub}</td><td>{w.band}</td><td className="n num">{fmt(w.hours, 1)}</td><td className="n num">{w.owed}</td><td className="n num bad">{fmt(w.gap, 1)}</td><td className="n num">{w.interruptions}</td></tr>)}</tbody>
            </table></div>
          </>)}
          {tech.rationing.length > 0 && (<>
            <h3>Hours withheld between injection points and the feeders drawn through them</h3>
            <div className="scroll"><table className="compact">
              <thead><tr><th>Injection point</th><th>Unit</th><th className="n">Fed feeders</th><th className="n">Injection h/day</th><th className="n">Fed avg h/day</th><th className="n">Withheld (h)</th></tr></thead>
              <tbody>{tech.rationing.slice(0, 10).map((r) => <tr key={r.injection}><td>{r.injection}</td><td>{r.hub}</td><td className="n num">{r.children}</td><td className="n num">{fmt(r.injectionHours, 1)}</td><td className="n num">{fmt(r.downstreamHours, 1)}</td><td className="n num">{fmt(r.withheld, 1)}</td></tr>)}</tbody>
            </table></div>
            {tech.meterBelow > 0 && <p className="callout"><b>Metering integrity.</b> {tech.meterBelow} injection meters read below the sum of the feeders they supply this month. Group energy was taken from the downstream meters; the injection meters should be tested.</p>}
          </>)}
        </>)}
      </Section>

      <Section id="sbt" n={3} title="Service-based tariff band monitoring">
        <p>{multi ? <>Position as at {periodLabel(period)}, the last month of the period. </> : null}Each feeder&apos;s monthly average hours are tested against its band floor{s.sbtTolerance ? ` less a ${pct(s.sbtTolerance, 0)} tolerance` : ""}. A feeder that breaches for {s.sbtConsecutive} consecutive months becomes a referral candidate for Compliance.</p>
        <div className="kpis">
          <Kpi vs={span.noun} k="Feeders monitored" v={fmt(sbt.totals.monitored)} d={`${sbt.totals.reported} reported hours`} />
          <Kpi vs={span.noun} k="Met band floor" v={fmt(sbt.totals.met)} d={pct(sbt.totals.reported ? sbt.totals.met / sbt.totals.reported : null, 0)} />
          <Kpi vs={span.noun} k="Breaches this month" v={fmt(sbt.totals.breaches)} d="" />
          <Kpi vs={span.noun} k="Referral candidates" v={fmt(sbt.totals.candidates)} d={`${sbt.totals.openReferrals} referrals open`} />
        </div>
        {sbt.list.filter((x) => x.candidate).length > 0 && (<>
          <h3>Referral candidates (breached {s.sbtConsecutive}+ consecutive months, not yet referred)</h3>
          <div className="scroll"><table className="compact">
            <thead><tr><th>Feeder</th><th>Unit</th><th>Band</th><th className="n">Floor</th><th className="n">Hours</th><th className="n">Months in a row</th><th>Data quality</th></tr></thead>
            <tbody>{sbt.list.filter((x) => x.candidate).sort((a, b) => b.run - a.run).slice(0, 15).map((x) => <tr key={x.id}><td>{x.name}</td><td>{x.hub}</td><td>{x.band}</td><td className="n num">{x.floor}</td><td className="n num">{fmt(x.hours, 1)}</td><td className="n num">{x.run}</td><td style={{ fontSize: 12 }}>{x.dq}</td></tr>)}</tbody>
          </table></div>
          <p className="legend"><Link className="no-print" href={`/sbt?period=${period}`}>Log referrals in the SBT monitor</Link></p>
        </>)}
        <h3>Breach referrals by status</h3>
        <div className="scroll"><table className="compact">
          <thead><tr><th>Status</th><th className="n">Referrals</th></tr></thead>
          <tbody>{[...new Set(sbt.referrals.map((r) => r.status))].map((st) => <tr key={st}><td>{st}</td><td className="n num">{sbt.referrals.filter((r) => r.status === st).length}</td></tr>)}
            {!sbt.referrals.length && <tr><td colSpan={2} className="legend">No referrals logged.</td></tr>}</tbody>
        </table></div>
        {sbt.totals.dqFlags > 0 && <p className="legend">{sbt.totals.dqFlags} feeders carry data-quality flags for the year to date: {sbt.list.filter((x) => x.dq === "Possible interpolation").length} show straight-line (interpolated) runs of monthly hours and {sbt.list.filter((x) => x.zero).length} report zero-hour months. Query these before referral.</p>}
      </Section>

      <Section id="commercial" n={4} title="Commercial performance (business-unit returns)">
        {!com.hasData ? <p className="empty">No commercial returns were filed for {P}.</p> : (<>
          <IndicatorTable curLabel={curLabel} prevLabel={prevLabel} ytdLabel={ytdLabel} rows={[
            { label: "Customers", unit: "no.", cur: C.customers, prev: CP.customers, kind: "n" },
            { label: "Metering rate", unit: "%", cur: C.meteringRate, prev: CP.meteringRate, ytd: com.ytd.meteringRate, target: tg("meteringRate"), kind: "pct" },
            { label: "Energy received (licensee return)", unit: "GWh", cur: C.receivedMwh, prev: CP.receivedMwh, ytd: com.ytd.receivedMwh, kind: "gwh" },
            { label: "Energy billed", unit: "GWh", cur: C.billedMwh, prev: CP.billedMwh, ytd: com.ytd.billedMwh, kind: "gwh" },
            { label: "Billing efficiency (kWh)", unit: "%", cur: C.be, prev: CP.be, ytd: com.ytd.be, target: tg("be"), kind: "pct" },
            { label: "Billing efficiency (₦)", unit: "%", cur: C.beNgn, prev: CP.beNgn, ytd: com.ytd.beNgn, kind: "pct" },
            { label: "Amount billed", unit: "₦bn", cur: C.billedNgn, prev: CP.billedNgn, ytd: com.ytd.billedNgn, kind: "ngnbn" },
            { label: "Amount collected", unit: "₦bn", cur: C.collected, prev: CP.collected, ytd: com.ytd.collected, kind: "ngnbn" },
            { label: "Collection efficiency", unit: "%", cur: C.ce, prev: CP.ce, ytd: com.ytd.ce, target: tg("ce"), kind: "pct" },
            { label: "Collection efficiency — current bills", unit: "%", cur: C.ceCurrent, prev: CP.ceCurrent, ytd: com.ytd.ceCurrent, kind: "pct" },
            { label: "ATC&C loss (kWh)", unit: "%", cur: C.atcc, prev: CP.atcc, ytd: com.ytd.atcc, target: tg("atcc"), kind: "pct" },
            { label: "ATC&C loss (₦)", unit: "%", cur: C.atccNgn, prev: CP.atccNgn, ytd: com.ytd.atccNgn, target: tg("atccNgn"), kind: "pct" },
            { label: "Revenue yield (₦ collected per kWh received)", unit: "₦/kWh", cur: C.revenueYield, prev: CP.revenueYield, ytd: com.ytd.revenueYield, kind: "ngn" },
            { label: "Estimation ratio (unmetered ÷ metered NMD kWh/customer)", unit: "×", cur: C.estimationRatio, prev: CP.estimationRatio, ytd: com.ytd.estimationRatio, target: tg("estimationRatio"), kind: "x" },
            { label: "Energy received ÷ feeder-metered energy", unit: "×", cur: com.reconciliation.ratio, prev: null, target: tg("receivedVsMetered"), kind: "x" },
            { label: "New meters installed", unit: "no.", cur: C.newMeters ?? com.installTrend.at(-1)?.installed ?? null, prev: CP.newMeters, kind: "n" },
            { label: "Complaint resolution rate", unit: "%", cur: C.complaintResolution ?? cmp.total.resolution, prev: CP.complaintResolution, target: tg("complaintResolution"), kind: "pct" },
          ]} />
          <div className="two">
            <div>
              <h3>Efficiency trend</h3>
              <LineChart months={com.months} max={1} format={(v) => `${Math.round(v * 100)}%`} series={[
                { name: "Billing efficiency (kWh)", values: com.trend.map((t) => t.be), tone: "s1" },
                { name: "Collection efficiency", values: com.trend.map((t) => t.ce), tone: "s2" },
                { name: "ATC&C (kWh)", values: com.trend.map((t) => t.atcc), tone: "s3" },
                { name: "ATC&C (₦)", values: com.trend.map((t) => t.atccNgn), tone: "s4" },
              ]} />
            </div>
            <div>
              <h3>Billed and collected</h3>
              <LineChart months={com.months} format={(v) => ngn(v)} series={[{ name: "Billed", values: com.trend.map((t) => t.billedNgn || null), tone: "s1" }, { name: "Collected", values: com.trend.map((t) => t.collected || null), tone: "s2" }]} />
            </div>
          </div>
          {com.reconciliation.ratio != null && <p className="callout"><b>Energy reconciliation.</b> Feeder meters show {fmt(com.reconciliation.feederDeliveredMwh / 1000, 2)} GWh supplied (de-duplicated); billing returns show {fmt(C.receivedMwh / 1000, 2)} GWh received, {fmt(com.reconciliation.ratio, 2)}× the metered figure. Billing efficiency is measured against energy received, so an overstated denominator understates losses.</p>}
        </>)}
      </Section>

      <Section id="comparison" n={5} title="Licensee comparison and business-unit league">
        <h3>Licensee comparison — {P}</h3>
        <div className="scroll"><table className="compact">
          <thead><tr><th>Licensee</th><th className="n">Supplied (GWh)</th><th className="n">Avg h/day</th><th className="n">Band compliance</th><th className="n">BE (kWh)</th><th className="n">CE</th><th className="n">ATC&amp;C (kWh)</th><th className="n">ATC&amp;C (₦)</th></tr></thead>
          <tbody>
            {licComparison.map(({ l, t, c }) => <tr key={l.id} className={l.id === L ? "hl" : undefined}><td>{l.code}<small className="refs" style={{ display: "block" }}>{l.name}</small></td><td className="n num">{t ? fmt(t.delivered / 1000, 2) : "—"}</td><td className="n num">{fmt(t?.avgHours, 1)}</td><td className="n num">{pct(t?.compliance, 0)}</td><td className="n num">{pct(c?.be)}</td><td className="n num">{pct(c?.ce)}</td><td className="n num">{pct(c?.atcc)}</td><td className="n num">{pct(c?.atccNgn)}</td></tr>)}
            <tr className="total"><td>Ogun State</td><td className="n num">{fmt(allT.delivered / 1000, 2)}</td><td className="n num">{fmt(allT.avgHours, 1)}</td><td className="n num">{pct(allT.compliance, 0)}</td><td className="n num">{pct(allC.be)}</td><td className="n num">{pct(allC.ce)}</td><td className="n num">{pct(allC.atcc)}</td><td className="n num">{pct(allC.atccNgn)}</td></tr>
          </tbody>
        </table></div>
        <h3>Business-unit league{scope ? ` — ${scope.code}` : ""}</h3>
        <div className="scroll"><table className="compact">
          <thead><tr><th>Business unit</th><th className="n">Supplied (GWh)</th><th className="n">Avg h/day</th><th className="n">Band compliance</th><th className="n">BE (kWh)</th><th className="n">CE</th><th className="n">ATC&amp;C (kWh)</th><th className="n">ATC&amp;C (₦)</th><th className="n">Received ÷ metered</th></tr></thead>
          <tbody>{com.byHub.map((h) => { const t = tech.byHub.find((x) => x.hubId === h.hubId); return (
            <tr key={h.hub}><td>{h.hub}</td><td className="n num">{t ? fmt(t.delivered / 1000, 2) : "—"}</td><td className="n num">{fmt(t?.avgHours, 1)}</td><td className="n num">{pct(t?.compliance, 0)}</td><td className="n num">{pct(h.be)}</td><td className="n num">{pct(h.ce)}</td><td className={`n num ${(h.atcc ?? 0) > s.flags.critAtc ? "bad" : ""}`}>{pct(h.atcc)}</td><td className="n num">{pct(h.atccNgn)}</td><td className="n num">{h.receivedVsMetered != null ? `${fmt(h.receivedVsMetered, 2)}×` : "—"}</td></tr>); })}</tbody>
        </table></div>
        <p className="legend">ATC&amp;C above {pct(s.flags.critAtc, 0)} is flagged critical and above {pct(s.flags.watchAtc, 0)} watch, per OGSERC working thresholds.</p>
      </Section>

      <Section id="metering" n={6} title="Metering, estimated billing and energy caps">
        {!com.hasData ? <p className="empty">No customer population returns were filed.</p> : (<>
          <p>{fmt(C.metered)} of {fmt(C.customers)} customers ({pct(C.meteringRate)}) were metered. Among maximum-demand customers the rate was {pct(C.mdMeteringRate)}. Metered non-MD customers were billed {fmt(C.kwhPerMeteredNmd, 0)} kWh each and unmetered non-MD customers {fmt(C.kwhPerUnmeteredNmd, 0)} kWh{com.caps.avgCap ? `, against an average feeder cap of ${fmt(com.caps.avgCap, 0)} kWh` : ""}.</p>
          <div className="scroll"><table className="compact">
            <thead><tr><th>Business unit</th><th className="n">Customers</th><th className="n">Metering rate</th><th className="n">kWh / metered NMD</th><th className="n">kWh / unmetered NMD</th><th className="n">Estimation ratio</th><th className="n">Avg cap (kWh)</th><th className="n">Billed ÷ cap</th></tr></thead>
            <tbody>{com.byHub.map((h) => <tr key={h.hub}><td>{h.hub}</td><td className="n num">{fmt(h.customers)}</td><td className="n num">{pct(h.meteringRate)}</td><td className="n num">{fmt(h.kwhPerMeteredNmd, 0)}</td><td className="n num">{fmt(h.kwhPerUnmeteredNmd, 0)}</td><td className={`n num ${(h.estimationRatio ?? 0) > 1 ? "bad" : ""}`}>{h.estimationRatio != null ? `${fmt(h.estimationRatio, 2)}×` : "—"}</td><td className="n num">{fmt(h.avgCap, 0)}</td><td className={`n num ${(h.billedVsCap ?? 0) > 1 ? "bad" : ""}`}>{h.billedVsCap != null ? `${fmt(h.billedVsCap, 2)}×` : "—"}</td></tr>)}</tbody>
          </table></div>
          <p className="legend">Estimation ratio above 1: estimated (unmetered) customers billed more energy per head than metered peers. Billed ÷ cap above 1: average unmetered billing exceeded the energy cap (NERC Order NERC/307/2022 or its OGSERC successor).</p>
          <div className="two">
            <div><h3>Metering rate, last {com.months.length} months</h3><LineChart months={com.months} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} series={[{ name: "Metered share", values: com.trend.map((t) => (t.customers ? t.meteringRate : null)), tone: "s1" }]} /></div>
            <div><h3>Average energy cap, last {com.months.length} months</h3><LineChart months={com.months} format={(v) => fmt(v, 0)} series={[{ name: "kWh per customer", values: com.caps.trend.map((t) => t.avgCap), tone: "s2" }]} /></div>
          </div>
          {com.installTrend.some((t) => t.installed) ? (<><h3>Meters installed</h3><Columns months={com.months} values={com.installTrend.map((t) => t.installed || null)} /></>) : <p className="legend">No meter installations were reported for these months.</p>}
        </>)}
      </Section>

      <Section id="complaints" n={7} title="Customer complaints">
        {!cmp.hasData && C.complaintsReceived == null ? <p className="empty">No complaints returns were filed for {P}.</p> : (<>
          <p>Licensees recorded {fmt(cmp.hasData ? cmp.total.received : C.complaintsReceived)} complaints and resolved {fmt(cmp.hasData ? cmp.total.resolved : C.complaintsResolved)} ({pct(cmp.hasData ? cmp.total.resolution : C.complaintResolution)}).{cmp.total.inTime != null ? ` ${pct(cmp.total.inTime)} of resolutions met the standard time.` : ""}{cmp.hasData ? ` ${fmt(cmp.total.escalated)} were escalated to the Forum or the Commission.` : ""}</p>
          {cmp.hasData && <div className="two">
            <div><h3>By category</h3><HBars max={Math.max(...cmp.byCategory.map((c) => c.received), 1) * 1.1} ticks={[]} items={[...cmp.byCategory].sort((a, b) => b.received - a.received).map((c) => ({ label: c.category, value: c.received, text: `${fmt(c.received)} · ${pct(c.received ? c.resolved / c.received : null, 0)}`, tone: "accent" }))} /></div>
            <div><h3>Received and resolved</h3><LineChart months={cmp.trend.map((t) => t.period)} series={[{ name: "Received", values: cmp.trend.map((t) => t.received || null), tone: "s1" }, { name: "Resolved", values: cmp.trend.map((t) => t.resolved || null), tone: "s2" }]} /></div>
          </div>}
        </>)}
      </Section>

      <Section id="generation" n={8} title="Generation">
        <p>The register holds {gen.plants} plants serving Ogun State with {fmt(gen.capacity, 1)} MW installed{gen.available ? ` (${fmt(gen.available, 0)} MW reported available where known)` : ""}.</p>
        <div className="two">
          <div><h3>Installed capacity by connection</h3><HBars max={Math.max(...gen.byCategory.map((c) => c.capacity), 1) * 1.1} ticks={[]} unit=" MW" items={gen.byCategory.map((c) => ({ label: `${c.key} (${c.plants})`, value: c.capacity, text: `${fmt(c.capacity, 1)} MW`, tone: "accent" }))} /></div>
          <div><h3>Largest plants</h3><table className="compact"><tbody>{gen.largest.slice(0, 8).map((a) => <tr key={a.id}><td>{a.name}<small className="refs" style={{ display: "block" }}>{a.code} · {[a.category, a.technology || a.fuel, a.status].filter(Boolean).join(" · ")}</small></td><td className="n num">{fmt(a.capacityMw, 1)} MW</td></tr>)}</tbody></table></div>
        </div>
        {gen.month ? (<>
          <h3>Plant performance (GenCo returns)</h3>
          <div className="scroll"><table className="compact">
            <thead><tr><th>Plant</th><th className="n">Net MWh</th><th className="n">Capacity availability</th><th className="n">Capacity factor</th><th className="n">Forced outage rate</th><th className="n">Heat rate</th><th className="n">Share to Ogun</th><th className="n">Collection</th><th className="n">Gas fill</th></tr></thead>
            <tbody>{gen.plantKpis.map((p) => <tr key={p.plant}><td>{p.plant}</td><td className="n num">{fmt(p.netMwh)}</td><td className="n num">{pct(p.capAvailability, 0)}</td><td className="n num">{pct(p.capacityFactor, 0)}</td><td className="n num">{pct(p.forcedOutageRate, 1)}</td><td className="n num">{fmt(p.heatRate, 0)}</td><td className="n num">{pct(p.shareOgun, 0)}</td><td className="n num">{pct(p.collectionRate, 0)}</td><td className="n num">{pct(p.gasFill, 0)}</td></tr>)}</tbody>
          </table></div>
        </>) : <p className="legend">No GenCo unit returns were filed for the month. Olorunsogo I (OPP) and Olorunsogo II (NDPHC) are monitored and awaiting their first returns.</p>}
        <h3>Capacity recovery and expansion plans</h3>
        <div className="scroll"><table className="compact">
          <thead><tr><th>Eval ID</th><th>Plant</th><th>Plan type</th><th>Received</th><th className="n">Days</th><th>Gates</th><th className="n">Score</th><th>Recommendation</th><th>Within {s.planEval.deadlineDays} days</th></tr></thead>
          <tbody>{gen.plans.map((p) => <tr key={p.id}><td>{p.id}{p.isExample ? <small className="refs"> · example</small> : null}</td><td>{p.plantName}</td><td>{p.planType}</td><td>{p.receivedOn}</td><td className="n num">{p.days}</td><td>{p.gatesPassed == null ? "—" : p.gatesPassed ? "Passed" : "Failed"}</td><td className="n num">{p.score ?? "—"}</td><td>{p.recommendation ?? "—"}</td><td>{p.withinDeadline}</td></tr>)}
            {!gen.plans.length && <tr><td colSpan={9} className="legend">No plans received.</td></tr>}</tbody>
        </table></div>
        {gen.planDue.filter((p) => p.overdue).length > 0 && <p className="legend">Plans overdue or never submitted: {gen.planDue.filter((p) => p.overdue).map((p) => p.plant).join("; ")}.</p>}
      </Section>

      <Section id="demand" n={9} title="Demand and load forecast baseline">
        {fc.declaredMw == null ? <p className="empty">No feeder returns this year to build the baseline from.</p> : (<>
          <p>Across {fc.months.length} months of {period.slice(0, 4)}, declared demand (energy nominated) averaged {fmt(fc.declaredMw, 1)} MW against {fmt(fc.deliveredMw, 1)} MW delivered, leaving {pct(fc.unservedShare, 0)} of declared demand unserved. Annualised, that is {fmt(fc.annualDeclaredGwh, 0)} GWh of declared demand. At the Base growth rate of {pct(fc.assumptions.base, 0)} a year, average declared demand reaches {fmt(fc.scenarios.base.at(-1), 0)} MW by {fc.years.at(-1)} (Low {fmt(fc.scenarios.low.at(-1), 0)} MW, High {fmt(fc.scenarios.high.at(-1), 0)} MW).</p>
          <div className="two">
            <div><h3>Declared and delivered, average MW</h3><LineChart months={fc.months} format={(v) => fmt(v, 0)} series={[{ name: "Declared demand", values: fc.monthly.map((m) => m.declaredMw), tone: "s1" }, { name: "Delivered", values: fc.monthly.map((m) => m.deliveredMw), tone: "s2" }]} /></div>
            <div><h3>Declared demand to {fc.years.at(-1)}, average MW</h3>
              <table className="compact"><thead><tr><th>Year</th><th className="n">Low</th><th className="n">Base</th><th className="n">High</th></tr></thead>
                <tbody>{fc.years.map((y, i) => (i % 2 === 0 || i === fc.years.length - 1) && <tr key={y}><td>{y}</td><td className="n num">{fmt(fc.scenarios.low[i], 0)}</td><td className="n num">{fmt(fc.scenarios.base[i], 0)}</td><td className="n num">{fmt(fc.scenarios.high[i], 0)}</td></tr>)}</tbody></table>
            </div>
          </div>
          <p className="legend">Average MW = energy ÷ hours; peak demand needs feeder peak-load returns. Figures are de-duplicated for 33/11 kV double counting ({fmt(fc.doubleCount.factor, 3)} of the gross feeder sum). Growth rates are planning assumptions from Settings, not measured.</p>
        </>)}
      </Section>

      <Section id="commission" n={10} title="Commission operations">
        <p>Returns compliance for {multi ? "the period" : "the month"} stood at {cgTotals.due ? pct(cgTotals.received / cgTotals.due, 0) : "—"}.</p>
        {ops.every((o) => o.value == null) ? <p className="empty">No activity recorded for {P}. <Link className="no-print" href={`/commission?period=${period}`}>Record it</Link></p> : (
          <div className="scroll"><table className="compact">
            <thead><tr><th>Area</th><th>Indicator</th><th className="n">{multi ? P : "Month"}</th><th>Notes</th></tr></thead>
            <tbody>{ops.filter((o) => o.value != null || o.note).map((o) => <tr key={o.key}><td className="muted">{o.group}</td><td>{o.label}</td><td className="n num">{o.unit === "₦" ? ngn(o.value) : fmt(o.value)}</td><td style={{ fontSize: 13 }}>{o.note}</td></tr>)}</tbody>
          </table></div>
        )}
      </Section>

      <Section id="quality" n={11} title="Data quality and compliance with reporting obligations">
        <div className="scroll"><table className="compact">
          <tbody>
            <tr><td>Feeder returns expected (registered feeders{multi ? ` × ${M.length} months` : ""})</td><td className="n num">{fmt(tech.expected * M.length)}</td></tr>
            <tr><td>Feeder returns received (energy supplied entered)</td><td className="n num">{fmt(T.returned)}</td></tr>
            <tr><td>Feeder return rate</td><td className="n num">{pct(tech.expected ? T.returned / (tech.expected * M.length) : null)}</td></tr>
            <tr><td>Feeders reporting hours of supply</td><td className="n num">{fmt(T.reporting)}</td></tr>
            <tr><td>Core technical fields complete (nomination, supply, hours, interruptions)</td><td className="n num">{pct(T.coreComplete)}</td></tr>
            <tr><td>Feeder returns with extended technical fields (peak load, voltage, customers, outage hours)</td><td className="n num">{fmt(T.extendedReported)}</td></tr>
            <tr><td>Business-unit billing returns received</td><td className="n num">{com.byHub.length}</td></tr>
            <tr><td>Returns accepted after EMPR review</td><td className="n num">{dq.validatedReturns} of {dq.returns}</td></tr>
            <tr><td>Validation warnings raised on {multi ? "the period" : "this month"}&apos;s returns</td><td className="n num">{fmt(dq.count)}</td></tr>
            <tr><td>Feeders whose segment and tariff class await licensee confirmation</td><td className="n num">{fmt(tech.unconfirmedClass)}</td></tr>
            <tr><td>Returns due for {multi ? "the period" : "the month"} not yet filed</td><td className="n num">{cgTotals.missing} of {cgTotals.due}</td></tr>
          </tbody>
        </table></div>
        {dq.byKind.length > 0 && <div className="scroll"><table className="compact"><thead><tr><th>Validation warning</th><th className="n">Cases</th></tr></thead><tbody>{dq.byKind.slice(0, 12).map((k) => <tr key={k.kind}><td>{k.kind}</td><td className="n num">{k.n}</td></tr>)}</tbody></table></div>}
        <h3>Returns status{multi ? ` — ${periodLabel(period)}` : ""}</h3>
        <div className="scroll"><table className="nowrap compact">
          <thead><tr><th>Licensee</th>{cg.datasets.map((d) => <th key={d}>{DATASETS[d].short}</th>)}</tr></thead>
          <tbody>{cg.grid.map(({ licensee: l, cells }) => <tr key={l.id}><td className="lic">{l.code}<small>{l.name}</small></td>{cells.map((c) => <td key={c.dataset}><StatusPill s={c.status} /></td>)}</tr>)}</tbody>
        </table></div>
      </Section>

      <section className="rsec" id="findings">
        <h2><span className="secno">12.</span>Regulatory findings and directives</h2>
        <Findings reportKey={reportKey} initial={findings} suggestions={suggestions} />
      </section>

      <section className="rsec" id="signoff">
        <h2><span className="secno">13.</span>Sign-off</h2>
        <SignOff reportKey={reportKey} initial={signoff} />
        <p className="legend">Generated from the OGSERC Data Hub for {user.name}. Figures are as filed by licensees and may be revised by later submissions. Method: energy counted once per injection point; band met when hours ≥ {pct(s.bandThreshold, 0)} of the band commitment; ATC&amp;C = 1 − billing efficiency × collection efficiency.</p>
      </section>
    </article>
  );
}

function Kpi({ k, v, d, vs = "month" }: { k: string; v: string; d: string; vs?: string }) {
  return <div className="kpi"><span className="k">{k}</span><span className="v">{v}</span>{d && d !== "—" && <span className="d">{d} on previous {vs}</span>}</div>;
}
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
void OPEN_REFERRAL;
