import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { resolvePeriod } from "@/lib/period";
import { DATASETS, LICENSEE_DATASETS, COMMISSION_DATASETS } from "@/lib/datasets";
import { KNOWN_FORMATS } from "@/lib/ingest/parsers";
import { periodLabel } from "@/lib/periods";
import UploadForm from "./UploadForm";

export default async function SubmitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const period = await resolvePeriod(await searchParams);
  const lics = await db.select().from(schema.licensees).where(user.isCommission ? eq(schema.licensees.active, true) : eq(schema.licensees.id, user.lic ?? "__none__")).orderBy(schema.licensees.sortOrder);
  const staged = await db.select().from(schema.submissions)
    .where(and(eq(schema.submissions.status, "staged"), user.isCommission ? undefined : eq(schema.submissions.submittedById, user.uid)))
    .orderBy(desc(schema.submissions.createdAt)).limit(10);
  const myLic = lics.find((l) => l.id === user.lic);
  const templateFor = user.isCommission ? lics[0]?.id : user.lic;
  const datasets = user.isCommission ? [...LICENSEE_DATASETS, ...COMMISSION_DATASETS] : (myLic?.obligations ?? LICENSEE_DATASETS);

  return (
    <section className="view">
      <div>
        <h2>Submit data</h2>
        <p className="sub">Upload the month&apos;s returns as an Excel workbook. Use the OGSERC templates, or upload the formats already in use (listed below). Licensee systems can also file through the API.</p>
      </div>
      {staged.length > 0 && (
        <div className="notice">
          {staged.length} upload{staged.length > 1 ? "s are" : " is"} waiting for confirmation.{" "}
          <Link href={`/submit/review?ids=${staged.map((s) => s.id).join(",")}`}>Review and confirm</Link>
        </div>
      )}
      <div className="form-grid">
        <UploadForm licensees={lics.map((l) => ({ id: l.id, name: l.name, area: l.area }))} fixedLicensee={user.isCommission ? null : user.lic} year={Number(period.slice(0, 4))} />
        <div className="card">
          <h3>Templates for {periodLabel(period)}</h3>
          <p className="sub small">Pre-filled with {user.isCommission ? "the selected licensee's" : "your"} feeders and business hubs from the last return. Fill in the figures and upload.</p>
          {user.isCommission && <p className="legend">Templates below are pre-filled for {lics[0]?.name}. Licensees download their own from their account.</p>}
          <ul className="links">
            {datasets.map((d) => (
              <li key={d}>
                <a href={`/api/templates/${d}?licensee=${templateFor ?? ""}&period=${period}`}>{DATASETS[d].label}</a>
                <span className="legend"> · {DATASETS[d].grain}</span>
              </li>
            ))}
            <li><a href={`/api/templates/ALL?licensee=${templateFor ?? ""}&period=${period}`}><b>All returns in one workbook</b></a></li>
          </ul>
          <h3 style={{ marginTop: 6 }}>Formats the Hub reads</h3>
          <ul className="flags" style={{ color: "var(--muted)" }}>{KNOWN_FORMATS.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
