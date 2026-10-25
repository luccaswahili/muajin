import Link from "next/link";
import { can, canSeeAgents, requireMember } from "@/lib/auth";
import { BottomNav, SideNav } from "@/components/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireMember();
  const bottom = [
    { href: "/", label: "Home", icon: "home", show: true },
    { href: "/sales", label: "Sales", icon: "sales", show: can(me, "sales") },
    { href: "/map", label: "Map", icon: "map", show: can(me, "sales") || can(me, "customers") },
    { href: "/production", label: "Production", icon: "production", show: can(me, "production") },
    { href: "/money", label: "Bank", icon: "money", show: can(me, "bank") },
  ].filter((i) => i.show).slice(0, 4);
  bottom.push({ href: "/more", label: "More", icon: "more", show: true });

  const side = [
    { href: "/", label: "Home", icon: "home", show: true },
    { href: "/sales", label: "Sales", icon: "", show: can(me, "sales") },
    { href: "/map", label: "Shop map", icon: "", show: can(me, "sales") || can(me, "customers") },
    { href: "/customers", label: "Customers", icon: "", show: can(me, "sales") || can(me, "customers") },
    { href: "/production", label: "Production", icon: "", show: can(me, "production") },
    { href: "/expenses", label: "Expenses", icon: "", show: can(me, "expenses") },
    { href: "/money", label: "Bank & cash", icon: "", show: can(me, "bank") },
    { href: "/stock", label: "Stock", icon: "", show: !me.is_agent },
    { href: "/agents", label: "Sales agents", icon: "", show: canSeeAgents(me) },
    { href: "/reports", label: "Reports", icon: "", show: can(me, "reports") },
    { href: "/activity", label: "Activity log", icon: "", show: can(me, "activity") },
    { href: "/admin", label: "Admin", icon: "", show: me.is_admin },
    { href: "/more", label: "Account", icon: "", show: true },
  ].filter((i) => i.show);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-brand-700 text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-wide">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-accent">M</span>
            MUWA GIN
          </Link>
          <Link href="/more" className="rounded-full bg-white/10 px-3 py-1 text-sm">
            {me.full_name || me.email.split("@")[0]}
          </Link>
        </div>
      </header>
      <div className="mx-auto flex max-w-5xl gap-6 px-4 pb-28 pt-4 md:pb-10">
        <SideNav items={side} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <BottomNav items={bottom} />
    </div>
  );
}
