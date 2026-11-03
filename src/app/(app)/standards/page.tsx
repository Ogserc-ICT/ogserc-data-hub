import { requireUser } from "@/lib/auth";
import { BAND_HOURS, COMPLAINT_CATEGORIES, DATASETS } from "@/lib/datasets";
import { KNOWN_FORMATS } from "@/lib/ingest/parsers";

const CHECKS: Record<string, string[]> = {
  REGISTER: ["Band is A–E; segment MD, NMD or Mixed; tariff class NMD, MD1, MD2 or Mixed", "Fed feeders name their parent injection point", "Feeder ID unique within the licensee; other names and IDs kept for matching", "Updates the register; nothing is deleted"],
  FEEDER: ["Feeder matched to the register by Feeder ID, other ID or name", "Hours of supply between 0 and 24", "Supplied energy not above nomination by more than 5%", "No energy against zero nomination; no hours with zero energy", "Interruption causes not above total interruptions; min voltage ≤ max; average load ≤ peak", "Core fields (nomination, supply, hours, interruptions) reported", "Each feeder once per month"],
  COMMERCIAL: ["Energy billed ≤ energy received", "Collections ≤ 125% of billing; arrears reported when collections exceed billing", "Amount billed > 0 when energy is billed", "Complaints resolved ≤ received", "Each business unit once per month"],
  METERING: ["Whole numbers, not negative", "Each business unit once per month"],
  COMPLAINTS: ["Resolved ≤ received", "Resolved in time ≤ resolved", "Standard categories only (others are reported as Other)"],
  GENUNIT: ["Available ≤ installed capacity; net ≤ gross", "Auxiliary consumption ≤ 10% of gross", "Operating and outage hours within the month", "Heat rate 7,000–20,000 kJ/kWh where fuel is reported"],
  GENPLANT: ["Gas delivered not above nomination by more than 10%"],
  CAPS: ["Cap is kWh per unmetered customer per month"],
  GENREG: ["Matched by Plant ID, licensee plant ID or name; updates the register; nothing is deleted"],
  REFERRALS: ["Matched by referral number; status from the referral workflow"],
  PLANEVAL: ["Gates Yes/No; scores 1–5; weighted score and recommendation computed from Settings"],
  FORECAST: ["Growth rates as decimals; start and end years"],
};

export default async function StandardsPage() {
  const user = await requireUser();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://<your-hub-address>";
  return (
    <section className="view">
      <div>
        <h2>Data standards</h2>
        <p className="sub">What each monthly return contains, the units, and the checks applied when it is filed. Column headings follow the OGSERC Licensee and GenCo Monthly Return datasheets and the EMPR data dictionary, so the Commission&apos;s workbooks import directly. Errors stop a return from being filed. Warnings are filed and reviewed by the Commission.</p>
      </div>
      <div className="card">
        <h3>Service bands</h3>
        <p className="sub small">Minimum average daily supply under the service-based tariff: {Object.entries(BAND_HOURS).map(([b, h]) => `Band ${b} ${h} hours`).join(" · ")}. Labels such as A20H are read as Band A.</p>
        <h3>Method</h3>
        <ul className="flags" style={{ color: "var(--muted)" }}>
          <li>No double counting: for each injection point, energy is the higher of its own meter and the sum of the feeders drawn through it.</li>
          <li>A feeder-month meets its band when average hours are at least the band-compliance threshold (Settings) times the committed hours.</li>
          <li>ATC&amp;C = 1 − billing efficiency × collection efficiency, uncapped, in kWh and in naira. Collection efficiency for current bills excludes arrears recovered.</li>
          <li>Estimation ratio = kWh billed per unmetered NMD customer ÷ kWh per metered NMD customer in the same unit.</li>
          <li>Received ÷ feeder-metered compares a unit&apos;s energy-received figure with its de-duplicated feeder meters.</li>
        </ul>
      </div>
      {Object.values(DATASETS).map((d) => (
        <div className="card" key={d.code}>
          <div>
            <h3>{d.label} <span className="legend">· {d.code} · sheet “{d.sheet}”</span></h3>
            <p className="sub small">{d.grain}. Filed by {d.filer === "licensee" ? "each licensee" : "the Commission"}{d.periodic ? ", monthly" : ""}.</p>
          </div>
          <div className="scroll">
            <table className="compact">
              <thead><tr><th>Column</th><th>API key</th><th>Type</th><th>Unit</th><th>Required</th><th>Notes</th></tr></thead>
              <tbody>{d.columns.map((c) => <tr key={c.key}><td>{c.header}</td><td><code>{c.key}</code></td><td>{c.type}</td><td>{c.unit ?? ""}</td><td>{c.required ? "Yes" : "No"}</td><td style={{ fontSize: 13 }}>{[c.help, c.min != null ? `≥ ${c.min}` : "", c.max != null ? `≤ ${c.max}` : ""].filter(Boolean).join(" · ")}</td></tr>)}</tbody>
            </table>
          </div>
          <div><h3 style={{ fontSize: 13 }}>Checks</h3><ul className="flags" style={{ color: "var(--muted)" }}>{(CHECKS[d.code] ?? []).map((c) => <li key={c}>{c}</li>)}</ul></div>
        </div>
      ))}
      <div className="card">
        <h3>Complaint categories</h3>
        <p className="sub small">{COMPLAINT_CATEGORIES.join(" · ")}</p>
        <h3>Workbook layouts the Hub reads</h3>
        <ul className="flags" style={{ color: "var(--muted)" }}>{KNOWN_FORMATS.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      <div className="card">
        <h3>Filing through the API</h3>
        <p className="sub small">Licensee systems can file returns directly. The Commission issues each licensee an API key{user.isAdmin ? " from the Admin page" : ""}. Rows use the API keys in the tables above.</p>
        <pre className="code">{`POST ${origin}/api/v1/submissions
Authorization: Bearer ogs_…
Content-Type: application/json

{
  "dataset": "FEEDER",
  "confirm": true,
  "rows": [
    { "period": "2026-07", "feeder": "IDOWA 33KV FEEDER", "voltage": "33kV", "hub": "Ijebu",
      "band": "A", "hoursPerDay": 21.58, "deliveredMwh": 932.05, "nominatedMwh": 2402.21, "interruptions": 5 }
  ]
}`}</pre>
        <p className="sub small">The response lists errors and warnings. With <code>confirm: true</code> a return without errors is filed at once; otherwise it waits in the Hub for a person to confirm. <code>GET /api/v1/submissions/&lt;id&gt;</code> returns its status and any Commission query. <code>GET /api/v1/datasets</code> describes every dataset.</p>
      </div>
    </section>
  );
}
