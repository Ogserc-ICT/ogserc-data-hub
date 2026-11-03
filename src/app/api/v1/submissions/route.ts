import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiAuth } from "@/lib/apikey";
import { DATASETS, isDataset } from "@/lib/datasets";
import { commit, hasErrors, stage } from "@/lib/ingest/commit";
import { recentPeriods } from "@/lib/periods";

export const dynamic = "force-dynamic";
const MAX_ROWS = 20000;

/**
 * File a return from a licensee system.
 * POST /api/v1/submissions   Authorization: Bearer ogs_…
 * { "dataset": "FEEDER", "rows": [ { "period": "2026-07", "feeder": "…", … } ], "confirm": true }
 * With confirm (the default) a return without errors is filed at once; otherwise it waits in the Hub for a person to confirm.
 */
export async function POST(req: Request) {
  const auth = await apiAuth(req);
  if (auth instanceof Response) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "Body must be JSON." }, { status: 400 }); }
  const b = body as { dataset?: unknown; rows?: unknown; confirm?: unknown };
  if (!isDataset(b.dataset) || DATASETS[b.dataset].filer !== "licensee") return Response.json({ error: "dataset must be one of FEEDER, COMMERCIAL, METERING, COMPLAINTS, GENERATION." }, { status: 400 });
  if (!Array.isArray(b.rows) || !b.rows.length) return Response.json({ error: "rows must be a non-empty array." }, { status: 400 });
  if (b.rows.length > MAX_ROWS) return Response.json({ error: `At most ${MAX_ROWS} rows per request.` }, { status: 413 });
  const lic = await db.query.licensees.findFirst({ where: eq(schema.licensees.id, auth.licenseeId) });
  if (!lic?.active) return Response.json({ error: "Licensee is not active." }, { status: 403 });

  const keys = new Set(DATASETS[b.dataset].columns.map((c) => c.key));
  const rows = (b.rows as Record<string, unknown>[]).map((r) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => keys.has(k))));
  const id = await stage({ dataset: b.dataset, licenseeId: lic.id, format: "API", channel: "api", rows, parseIssues: [], userId: null, userName: `API: ${auth.keyLabel}`, periodsAllowed: recentPeriods(new Date(), 36) });
  const s = (await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) }))!;
  let status = s.status as string;
  if (b.confirm !== false && !hasErrors(s.issues)) { await commit(id); status = "received"; }
  return Response.json({ id, status, periods: s.periods, rows: s.rowCount, errors: s.issues.filter((i) => i.level === "error"), warnings: s.issues.filter((i) => i.level === "warning") }, { status: hasErrors(s.issues) ? 422 : 201 });
}
