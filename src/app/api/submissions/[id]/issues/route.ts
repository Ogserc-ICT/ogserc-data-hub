import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentUser } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || (!user.isCommission && s.licenseeId !== user.lic)) return new Response("Not found", { status: 404 });
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["level,period,item,message", ...s.issues.map((i) => [i.level, i.period, i.ref, i.message].map(q).join(","))].join("\n");
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="issues-${id.slice(0, 8)}.csv"` } });
}
