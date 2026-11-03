"use client";
import { useActionState } from "react";
import type { Settings } from "@/lib/settings";
import { saveSettings, type SetState } from "./actions";

const N = ({ name, label, value, step = "any", hint }: { name: string; label: string; value: number; step?: string; hint?: string }) => (
  <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} className="n" type="number" step={step} defaultValue={value} />{hint && <span className="hint">{hint}</span>}</div>
);

export default function SettingsForm({ s }: { s: Settings }) {
  const [state, action, pending] = useActionState<SetState, FormData>(saveSettings, {});
  return (
    <form action={action} className="view">
      <div className="card"><h3>Service bands and compliance</h3>
        <div className="fields">
          {Object.entries(s.bandHours).map(([b, h]) => <N key={b} name={`band_${b}`} label={`Band ${b}: committed hours/day`} value={h} />)}
          <N name="bandThreshold" label="Band met when hours ≥ this share of the commitment" value={s.bandThreshold} hint="EMPR workbook: 0.98" />
          <N name="sbtTolerance" label="SBT breach tolerance below the floor" value={s.sbtTolerance} hint="0 means any shortfall is a breach" />
          <N name="sbtConsecutive" label="Consecutive breach months before referral" value={s.sbtConsecutive} step="1" />
          <N name="deliveryRatioMin" label="Flag energy delivered below this share of nomination" value={s.deliveryRatioMin} />
          <N name="deliveryRatioMax" label="Flag energy delivered above this share of nomination" value={s.deliveryRatioMax} />
          <N name="hoursMismatchTolerance" label="Hours vs interruptions mismatch tolerance (h/day)" value={s.hoursMismatchTolerance} />
        </div>
      </div>
      <div className="card"><h3>Watch and critical flags</h3>
        <div className="fields">
          <N name="flag_critComp" label="Critical: band compliance below" value={s.flags.critComp} /><N name="flag_watchComp" label="Watch: band compliance below" value={s.flags.watchComp} />
          <N name="flag_critFul" label="Critical: fulfilment below (with band missed)" value={s.flags.critFul} />
          <N name="flag_critAtc" label="Critical: ATC&C loss above" value={s.flags.critAtc} /><N name="flag_watchAtc" label="Watch: ATC&C loss above" value={s.flags.watchAtc} />
        </div>
      </div>
      <div className="card"><h3>Market targets</h3><p className="sub small">Placeholders until OGSERC adopts targets in a performance-standards instrument. Shares as decimals (0.9 = 90%).</p>
        <div className="fields">{s.marketTargets.map((t) => <N key={t.key} name={`mt_${t.key}`} label={`${t.label} ${t.dir === "min" ? "≥" : "≤"}`} value={t.value} />)}</div>
      </div>
      <div className="card"><h3>Generation targets</h3>
        <div className="fields">{s.genTargets.map((t) => <N key={t.key} name={`gt_${t.key}`} label={`${t.label} ${t.dir === "min" ? "≥" : "≤"}`} value={t.value} />)}</div>
      </div>
      <div className="card"><h3>Load forecast assumptions</h3>
        <div className="fields">
          <N name="fc_low" label="Low growth a year" value={s.forecast.low} /><N name="fc_base" label="Base growth a year" value={s.forecast.base} /><N name="fc_high" label="High growth a year" value={s.forecast.high} />
          <N name="fc_startYear" label="Forecast start year" value={s.forecast.startYear} step="1" /><N name="fc_endYear" label="Forecast end year" value={s.forecast.endYear} step="1" />
          <div className="field"><label><input type="checkbox" name="fc_removeDoubleCount" defaultChecked={s.forecast.removeDoubleCount} /> Remove 33/11 kV double counting</label></div>
        </div>
      </div>
      <div className="card"><h3>GenCo plan evaluation</h3>
        <div className="fields">
          <N name="pe_approve" label="Approve: weighted score at least" value={s.planEval.approve} /><N name="pe_approveWithConditions" label="Approve with conditions: at least" value={s.planEval.approveWithConditions} />
          <N name="pe_returnForRevision" label="Return for revision: at least" value={s.planEval.returnForRevision} />
          <N name="pe_deadlineDays" label="Evaluation deadline after receipt (days)" value={s.planEval.deadlineDays} step="1" /><N name="pe_cycleDays" label="Plan submission cycle (days)" value={s.planEval.cycleDays} step="1" />
        </div>
        <p className="legend">Gate requirements and criterion weights follow the Generation Register and Plan Evaluation workbook.</p>
      </div>
      <div className="actions" style={{ alignItems: "center" }}><button className="primary" type="submit" disabled={pending}>Save settings</button>{state.ok && <span className="legend">{state.ok}</span>}{state.error && <span className="legend" style={{ color: "var(--bad)" }}>{state.error}</span>}</div>
    </form>
  );
}
