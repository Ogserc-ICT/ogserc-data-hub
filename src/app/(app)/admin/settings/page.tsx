import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings-db";
import SettingsForm from "./Form";

export default async function SettingsPage() {
  await requireAdmin();
  const s = await getSettings();
  return (
    <section className="view">
      <div><h2>Settings</h2><p className="sub">Band floors, thresholds, targets and assumptions used across the Hub. Defaults come from the Commission&apos;s EMPR, SBT, generation and forecast workbooks.</p></div>
      <SettingsForm s={s} />
    </section>
  );
}
