import Link from "next/link";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { defaultPeriod, isPeriod, recentPeriods } from "@/lib/periods";
import { db, schema } from "@/db";
import { logout } from "../login/actions";
import PeriodSelectClient from "./PeriodSelectClient";
import SideMenu from "./SideMenu";
import Tabs, { type NavGroup } from "./Tabs";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const lic = user.lic ? await db.query.licensees.findFirst({ where: eq(schema.licensees.id, user.lic) }) : null;
  const periods = recentPeriods();
  const c = (await cookies()).get("ogserc_period")?.value;
  const period = isPeriod(c) && periods.includes(c) ? c : defaultPeriod();
  // Until a temporary password is replaced, only the account page is reachable, so keep the tabs out of the way.
  const groups: NavGroup[] = user.mcp ? [] : [
    { label: "Workspace", items: [
      { href: "/", label: user.isCommission ? "Market overview" : "Overview", icon: "grid" },
      { href: "/submit", label: "Submit data", icon: "upload" },
      { href: "/submissions", label: "Submissions", icon: "inbox" },
      { href: "/feeders", label: "Feeder register", icon: "list" },
      { href: "/data", label: "Data", icon: "table" },
      { href: "/standards", label: "Data standards", icon: "book" },
    ] },
    ...(user.isCommission ? [{ label: "Commission", items: [
      { href: "/report", label: "Market report", icon: "file" },
      { href: "/sbt", label: "SBT monitor", icon: "activity" },
      { href: "/generation", label: "Generation", icon: "zap" },
      { href: "/forecast", label: "Load forecast", icon: "trend" },
      { href: "/commission", label: "Commission activity", icon: "clock" },
    ] } satisfies NavGroup] : []),
    ...(user.isAdmin ? [{ label: "Admin", items: [{ href: "/admin", label: "Admin", icon: "settings" }] } satisfies NavGroup] : []),
  ];
  const role = user.isCommission ? (user.isAdmin ? "Commission · Administrator" : "Commission · Reviewer") : lic?.name ?? "Licensee";
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Lagos" }).replace(/ /g, "-");
  return (
    <div className="shell">
      <SideMenu brand={
        <Link href="/" className="side-brand plain">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/ogserc-logo.png" alt="OGSERC" />
          <span><b>Data Hub</b><small>Regulatory returns</small></span>
        </Link>
      }>
        {groups.length > 0 && <Suspense><Tabs groups={groups} /></Suspense>}
        <div className="side-user">
          <div className="side-who">
            <span className="avatar" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase()}</span>
            <span className="min0"><b>{user.name}</b><small>{role}</small></span>
          </div>
          <div className="side-links">
            <Link className="linkbtn" href="/account">Account</Link>
            <form action={logout}><button className="linkbtn" type="submit">Sign out</button></form>
          </div>
        </div>
      </SideMenu>
      <div className="main-col">
        <header className="topbar">
          <Suspense><PeriodSelectClient periods={periods} fallback={period} /></Suspense>
          <span className="today">{today} · Africa/Lagos</span>
        </header>
        <main>{children}</main>
        <footer>OGSERC Data Hub · Returns are made under the Ogun State Power Law, 2024.</footer>
      </div>
    </div>
  );
}
