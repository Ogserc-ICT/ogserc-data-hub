import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || !s.file || (!user.isCommission && s.licenseeId !== user.lic)) return new Response("Not found", { status: 404 });
  const name = (s.fileName ?? "submission.xlsx").replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(s.file), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
