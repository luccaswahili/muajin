"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  sales: "M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L21 8H6M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  production: "M9 3h6M10 3v5L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-10V3M7.5 14h9",
  expenses: "M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6",
  money: "M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18",
  more: "M4 6h16M4 12h16M4 18h16",
};

export function Icon({ name, className = "h-6 w-6" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function BottomNav({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-lg">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${active ? "text-brand-600" : "text-gray-500"}`}>
              <Icon name={it.icon} />
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function SideNav({ items }: { items: { href: string; label: string; icon: string }[] }) {
  const path = usePathname();
  return (
    <nav className="hidden w-56 shrink-0 md:block">
      <div className="sticky top-20 space-y-1">
        {items.map((it) => {
          const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${active ? "bg-brand-600 text-white" : "text-gray-700 hover:bg-white"}`}>
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
