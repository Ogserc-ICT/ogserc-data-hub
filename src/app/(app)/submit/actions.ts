"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { DATASETS } from "@/lib/datasets";
import { parseWorkbook } from "@/lib/ingest/parsers";
import { commit, resolveLicensee, stage } from "@/lib/ingest/commit";
import { recentPeriods } from "@/lib/periods";

export type UploadState = { error?: string };

// Vercel rejects request bodies over 4.5 MB before they reach the app, so stay under that.
const MAX_UPLOAD_MB = 4;
const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export async function uploadWorkbook(_: UploadState, form: FormData): Promise<UploadState> {
  const user = await requireUser();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an Excel file to upload." };
  if (file.size > MAX_BYTES) return { error: `The file is larger than ${MAX_UPLOAD_MB} MB. Split it by month or remove unused sheets, then upload each part.` };
  const chosenId = user.isCommission ? String(form.get("licensee") ?? "") : user.lic ?? "";
  const yearHint = Number(form.get("year")) || new Date().getFullYear();
  const lics = await db.select().from(schema.licensees);
  const chosen = lics.find((l) => l.id === chosenId) ?? null;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = await parseWorkbook(buf, { yearHint });
  if ("error" in parsed) return { error: parsed.error };

  const ids: string[] = [];
  const uploadId = randomUUID();
  // Registers first, so returns in the same workbook can refer to feeders they introduce.
  const order = (d: string) => (d === "REGISTER" || d === "GENREG" ? 0 : 1);
  const batches = [...parsed.batches].sort((a, b) => order(a.dataset) - order(b.dataset));
  const pendingRegister = batches.filter((b) => b.dataset === "REGISTER").flatMap((b) => b.rows);
  for (const b of batches) {
    const def = DATASETS[b.dataset];
    if (def.filer === "commission" && !user.isCommission) return { error: `${def.label} is Commission data; only Commission staff upload it.` };
    // Licensee-level datasets: split rows by the licensee code they carry (Commission workbooks hold several licensees).
    const perLicensee = new Map<string, typeof b.rows>();
    if (["GENREG", "PLANEVAL", "FORECAST", "REFERRALS"].includes(b.dataset)) perLicensee.set("", b.rows);
    else for (const r of b.rows) {
      const l = r.licenseeCode ? resolveLicensee(r.licenseeCode, lics) : chosen;
      if (!l) return { error: `Licensee "${r.licenseeCode ?? ""}" in sheet ${b.sheet ?? def.sheet} is not set up in the Hub. Add it under Admin, or choose the licensee before uploading.` };
      if (!user.isCommission && l.id !== user.lic) return { error: "This workbook holds data for another licensee. Upload only your own organisation's returns." };
      perLicensee.set(l.id, [...(perLicensee.get(l.id) ?? []), r]);
    }
    for (const [licId, rows] of perLicensee) {
      ids.push(await stage({
        dataset: b.dataset, licenseeId: licId || (b.dataset === "REFERRALS" ? chosen?.id ?? null : null), format: parsed.format, channel: "upload",
        rows, parseIssues: b.issues, fileName: file.name, uploadId, file: buf, userId: user.uid, userName: user.name,
        periodsAllowed: recentPeriods(new Date(), 36), partial: b.partial, reference: b.reference,
        pendingRegister: pendingRegister.filter((r) => !r.licenseeCode || resolveLicensee(r.licenseeCode, lics)?.id === licId),
      }));
    }
  }
  if (!ids.length) return { error: "No data was found in the workbook." };
  redirect(`/submit/review?ids=${ids.join(",")}`);
}

async function ownStaged(id: string) {
  const user = await requireUser();
  const s = await db.query.submissions.findFirst({ where: eq(schema.submissions.id, id) });
  if (!s || s.status !== "staged") return null;
  if (!user.isCommission && (s.licenseeId !== user.lic || s.submittedById !== user.uid)) return null;
  return s;
}

export type ConfirmState = { error?: string; done?: string };

export async function confirmSubmission(_: ConfirmState, form: FormData): Promise<ConfirmState> {
  const id = String(form.get("id") ?? "");
  const s = await ownStaged(id);
  if (!s) return { error: "This submission is no longer waiting for confirmation." };
  try {
    if (s.dataset !== "REGISTER" && s.dataset !== "GENREG") {
      // File the registers staged from the same workbook first, so the return's new feeders and plants exist.
      const sameUpload = s.uploadId
        ? await db.select().from(schema.submissions).where(and(eq(schema.submissions.status, "staged"), eq(schema.submissions.uploadId, s.uploadId)))
        : [];
      for (const reg of sameUpload.filter((x) => (x.dataset === "REGISTER" && x.licenseeId === s.licenseeId) || x.dataset === "GENREG"))
        if (!reg.issues.some((i) => i.level === "error")) await commit(reg.id);
    }
    const r = await commit(id);
    revalidatePath("/", "layout");
    return { done: `Filed ${r.rows.toLocaleString("en-GB")} rows for ${r.periods.length} month${r.periods.length > 1 ? "s" : ""}.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The submission could not be filed." };
  }
}

export async function discardSubmission(form: FormData) {
  const id = String(form.get("id") ?? "");
  const s = await ownStaged(id);
  if (s) await db.update(schema.submissions).set({ status: "discarded", file: null }).where(eq(schema.submissions.id, id));
  revalidatePath("/submit");
}
