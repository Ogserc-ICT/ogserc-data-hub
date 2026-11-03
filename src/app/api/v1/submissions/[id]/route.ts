import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { apiAuth } from "@/lib/apikey";

/** Status of a filing, including any Commission query. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || s.licenseeId !== auth.licenseeId) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ id: s.id, dataset: s.dataset, periods: s.periods, status: s.status, rows: s.rowCount, query: s.reviewNote || null, issues: s.issues });
}
