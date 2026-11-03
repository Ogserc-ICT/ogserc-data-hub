"use client";
import { useSearchParams } from "next/navigation";
import { isPeriod } from "@/lib/periods";
import PeriodSelect from "./PeriodSelect";

export default function PeriodSelectClient({ periods, fallback }: { periods: string[]; fallback: string }) {
  const q = useSearchParams().get("period");
  const value = isPeriod(q) && periods.includes(q) ? q : fallback;
  return <PeriodSelect periods={periods} value={value} />;
}
