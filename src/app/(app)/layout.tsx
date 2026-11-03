import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { defaultPeriod, isPeriod, recentPeriods } from "@/lib/periods";
import { db, schema } from "@/db";
import { logout } from "../login/actions";
import PeriodSelectClient from "./PeriodSelectClient";
import Tabs from "./Tabs";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const lic = user.lic ? await db.query.licensees.findFirst({ where: eq(schema.licensees.id, user.lic) }) : null;
  const periods = recentPeriods();
  const c = (await cookies()).get("ogserc_period")?.value;
  const period = isPeriod(c) && periods.includes(c) ? c : defaultPeriod();
  // Until a temporary password is replaced, only the account page is reachable, so keep the tabs out of the way.
  const tabs = user.mcp ? [] : [
    { href: "/", label: user.isCommission ? "Market overview" : "Overview" },
    { href: "/submit", label: "Submit data" },
    { href: "/submissions", label: "Submissions" },
    ...(user.isCommission ? [{ href: "/report", label: "Market report" }] : []),
    { href: "/feeders", label: "Feeder register" },
    ...(user.isCommission ? [{ href: "/sbt", label: "SBT monitor" }, { href: "/generation", label: "Generation" }, { href: "/forecast", label: "Load forecast" }] : []),
    { href: "/data", label: "Data" },
    ...(user.isCommission ? [{ href: "/commission", label: "Commission activity" }] : []),
    { href: "/standards", label: "Data standards" },
    ...(user.isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  return (
    <>
      <header className="mast">
        <div className="wrap">
          <div className="mast-row">
            <div className="brand">
              <span className="eyebrow">Ogun State Electricity Regulatory Commission</span>
              <h1>OGSERC Data Hub</h1>
            </div>
            <Suspense><PeriodSelectClient periods={periods} fallback={period} /></Suspense>
            <div className="who">
              <b>{user.name}</b><br />
              {user.isCommission ? (user.isAdmin ? "Commission · Administrator" : "Commission · Reviewer") : lic?.name ?? "Licensee"}
              {" · "}
              <Link className="linkbtn" href="/account">Account</Link>
              {" · "}
              <form action={logout} style={{ display: "inline" }}><button className="linkbtn" type="submit">Sign out</button></form>
            </div>
          </div>
          {tabs.length > 0 && <Suspense><Tabs items={tabs} /></Suspense>}
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="wrap">OGSERC Data Hub · Returns are made under the Ogun State Power Law, 2024.</footer>
    </>
  );
}
