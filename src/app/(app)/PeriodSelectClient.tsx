"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { isPeriod } from "@/lib/periods";
import PeriodSelect from "./PeriodSelect";

export default function PeriodSelectClient({ periods, fallback }: { periods: string[]; fallback: string }) {
  const q = useSearchParams().get("period");
  // These views have their own monthly / quarterly / annual picker.
  const path = usePathname();
  if (["/report", "/sbt", "/generation", "/forecast"].some((p) => path.startsWith(p))) return null;
  const value = isPeriod(q) && periods.includes(q) ? q : fallback;
  return <PeriodSelect periods={periods} value={value} />;
}
