"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Sidebar on wide screens; on phones, a top bar whose menu button slides the panel in from the left. */
export default function SideMenu({ brand, children }: { brand: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <aside className="side" data-open={open || undefined}>
      <div className="side-top">
        {brand}
        <button className="menu-btn" type="button" aria-label="Open menu" aria-expanded={open} aria-controls="side-panel" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      </div>
      <div className="side-panel" id="side-panel">
        <div className="panel-head">
          {brand}
          <button className="menu-btn" type="button" aria-label="Close menu" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </aside>
  );
}
