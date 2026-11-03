"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export default function Tabs({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const period = params.get("period");
  return (
    <nav className="tabs" aria-label="Views">
      {items.map((t) => {
        const active = t.href === "/" ? path === "/" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={period ? `${t.href}?period=${period}` : t.href} aria-current={active ? "page" : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
