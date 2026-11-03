import ExcelJS from "exceljs";
import { currentUser } from "@/lib/auth";
import { defaultPeriod, isPeriod } from "@/lib/periods";
import { buildSheets } from "@/lib/workbook";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in to download the workbook.", { status: 401 });
  const q = new URL(req.url).searchParams.get("period");
  const period = isPeriod(q) ? q : defaultPeriod();
  const sheets = await buildSheets(user, period);
  const wb = new ExcelJS.Workbook();
  wb.creator = "OGSERC Data Hub";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: "frozen", ySplit: s.headerRow + 1 }] });
    s.rows.forEach((r) => ws.addRow(r));
    s.widths.forEach((w, c) => { ws.getColumn(c + 1).width = w; });
    const head = ws.getRow(s.headerRow + 1);
    head.font = { bold: true };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F4" } };
    head.alignment = { wrapText: true, vertical: "top" };
    for (const c of s.pctCols) for (let r = s.headerRow + 2; r <= ws.rowCount; r++) ws.getCell(r, c + 1).numFmt = "0.0%";
    if (s.headerRow > 0) ws.getCell("A1").font = { bold: true, size: 13 };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="OGSERC-data-${period}.xlsx"`, "Cache-Control": "no-store" } });
}
