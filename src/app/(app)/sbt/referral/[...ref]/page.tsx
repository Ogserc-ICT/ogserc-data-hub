import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireCommission } from "@/lib/auth";
import { fmt } from "@/lib/ui";
import { PrintButton } from "../../../report/Client";

/** The SBT referral form, ready to file through the Registry. */
export default async function ReferralForm({ params }: { params: Promise<{ ref: string[] }> }) {
  await requireCommission();
  const ref = (await params).ref.map(decodeURIComponent).join("/");
  const r = await db.query.referrals.findFirst({ where: eq(schema.referrals.ref, ref) });
  if (!r) notFound();
  const lic = await db.query.licensees.findFirst({ where: eq(schema.licensees.id, r.licenseeId) });
  const f = r.feederId ? await db.query.feeders.findFirst({ where: eq(schema.feeders.id, r.feederId) }) : null;
  const rows: [string, string][] = [
    ["Referral no.", r.ref], ["Date referred", r.referredOn], ["Licensee", lic ? `${lic.code} — ${lic.name}` : r.licenseeId], ["Feeder ID", f?.code ?? "—"], ["Feeder name", r.feederName],
    ["Business unit", r.hub ?? "—"], ["Service band", r.band ?? "—"], ["Band floor (hours/day)", fmt(r.floorHours, 0)], ["Consecutive months in breach", fmt(r.monthsBreached)],
    ["Average hours, period", fmt(r.avgHours, 2)], ["Shortfall against floor (hours/day)", fmt(r.shortfall, 2)], ["Data quality flag", r.dataQualityFlag ?? "—"],
    ["Referred by", r.referredBy], ["Status", r.status], ["Compliance case no.", r.caseNo ?? ""], ["Date closed", r.closedOn ?? ""], ["Outcome / notes", r.notes],
  ];
  return (
    <article className="report" style={{ maxWidth: 760 }}>
      <div className="report-tools no-print"><span /><PrintButton /></div>
      <header className="cover" style={{ borderBottomWidth: 2 }}>
        <span className="eyebrow">Ogun State Electricity Regulatory Commission · Performance Monitoring unit, Engineering Services</span>
        <h1 style={{ fontSize: 26 }}>Service-based tariff breach referral</h1>
        <p className="cover-meta">To: Compliance and Enforcement · Through: Registry</p>
      </header>
      <table className="compact meta-form"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>
      <p>The feeder above has delivered average daily supply below the floor for its service band for the months shown, as reported by the licensee in its monthly returns. It is referred to Compliance for investigation and enforcement under the Ogun State Power Law, 2024 and the applicable service-based tariff order.</p>
      <div className="signoff">
        {["Referred by (Analyst, Performance Monitoring)", "Reviewed by (Head, Performance Monitoring)", "Received by (Compliance)"].map((role) => (
          <div key={role} className="sign"><b>{role}</b><label><span>Name:</span><span className="sigline" /></label><label><span>Signature:</span><span className="sigline" /></label><label><span>Date:</span><span className="sigline" /></label></div>
        ))}
      </div>
    </article>
  );
}
