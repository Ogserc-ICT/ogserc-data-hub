"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { periodLabel } from "@/lib/periods";

export default function PeriodSelect({ periods, value }: { periods: string[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="ctl" htmlFor="period">
      Reporting period
      <select
        id="period"
        value={value}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          p.set("period", e.target.value);
          document.cookie = `ogserc_period=${e.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.push(`${path}?${p.toString()}`);
        }}
      >
        {periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
      </select>
    </label>
  );
}
