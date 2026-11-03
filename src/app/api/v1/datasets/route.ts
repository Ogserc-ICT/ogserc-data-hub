import { DATASETS } from "@/lib/datasets";

/** Public description of every dataset and column, for licensee system integrators. */
export function GET() {
  const out = Object.values(DATASETS).filter((d) => d.filer === "licensee").map((d) => ({
    code: d.code, label: d.label, grain: d.grain,
    columns: d.columns.map((c) => ({ key: c.key, label: c.header, type: c.type, required: !!c.required, unit: c.unit ?? null, min: c.min ?? null, max: c.max ?? null, notes: c.help ?? null })),
  }));
  return Response.json({ datasets: out });
}
