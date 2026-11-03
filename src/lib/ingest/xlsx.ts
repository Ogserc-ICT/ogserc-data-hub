import ExcelJS from "exceljs";

export type Grid = unknown[][];
export type Book = { sheets: { name: string; grid: Grid }[] };

/** Reads every sheet into a plain grid of cell values (formula results, plain text, dates). */
export async function readBook(buf: ArrayBuffer | Buffer): Promise<Book> {
  const wb = new ExcelJS.Workbook();
  // exceljs types expect a Node Buffer
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: Book["sheets"] = [];
  wb.eachSheet((ws) => {
    const grid: Grid = [];
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const out: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => { out[c - 1] = plain(cell.value); });
      grid[r - 1] = out;
    });
    for (let i = 0; i < grid.length; i++) if (!grid[i]) grid[i] = [];
    sheets.push({ name: ws.name, grid });
  });
  return { sheets };
}

function plain(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v || "formula" in v || "sharedFormula" in v) {
      const res = (v as { result?: unknown }).result;
      return res == null || (typeof res === "object" && !(res instanceof Date)) ? null : plain(res as ExcelJS.CellValue);
    }
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as ExcelJS.CellHyperlinkValue).text;
    if ("error" in v) return null;
  }
  return v;
}

export const cellText = (v: unknown) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
export const lc = (v: unknown) => cellText(v).toLowerCase();

export function findSheet(book: Book, test: (name: string) => boolean) {
  return book.sheets.find((s) => test(s.name.trim().toLowerCase()));
}

/** First row (within the first `scan` rows) where `test` matches a cell; returns its index. */
export function findRow(grid: Grid, test: (cells: string[]) => boolean, scan = 15): number {
  for (let i = 0; i < Math.min(scan, grid.length); i++) if (test((grid[i] ?? []).map(lc))) return i;
  return -1;
}

/** Finds the first 4-digit year mentioned in the first rows of any sheet. */
export function yearInBook(book: Book): number | null {
  for (const s of book.sheets)
    for (const row of s.grid.slice(0, 6))
      for (const c of row) {
        const m = cellText(c).match(/\b(20\d\d)\b/);
        if (m) return Number(m[1]);
      }
  return null;
}
