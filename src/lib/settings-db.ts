import "server-only";
import { db, schema } from "@/db";
import { DEFAULT_SETTINGS, type Settings } from "./settings";

/** Settings with any values the Commission has saved layered over the workbook defaults. */
export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(schema.settings);
  const out = structuredClone(DEFAULT_SETTINGS) as Settings & Record<string, unknown>;
  for (const r of rows) if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value;
  return out;
}

export async function saveSetting(key: keyof Settings, value: unknown, userId: string | null) {
  await db.insert(schema.settings).values({ key, value, updatedById: userId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedById: userId, updatedAt: new Date() } });
}
