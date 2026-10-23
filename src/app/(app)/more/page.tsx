import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { Card, Field } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { signOut, updateMyName } from "@/app/actions";
import { displayLogin } from "@/lib/format";
import { PasswordForm } from "@/components/password-form";

export const metadata = { title: "More" };

export default async function MorePage() {
  const me = await requireMember();
  const links = [
    { href: "/sales", label: "Sales", show: can(me, "sales") },
    { href: "/map", label: "Shop map", show: can(me, "sales") || can(me, "customers") },
    { href: "/customers", label: "Customers & debts", show: can(me, "sales") || can(me, "customers") },
    { href: "/production", label: "Production", show: can(me, "production") },
    { href: "/expenses", label: "Expenses", show: can(me, "expenses") },
    { href: "/money", label: "Bank & cash", show: can(me, "bank") },
    { href: "/stock", label: "Stock", show: true },
    { href: "/reports", label: "Reports & owner shares", show: can(me, "reports") },
    { href: "/activity", label: "Activity log", show: can(me, "activity") },
    { href: "/admin", label: "Admin settings", show: me.is_admin },
  ].filter((l) => l.show);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={`rounded-xl border p-4 text-sm font-semibold ${l.href === "/admin" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-gray-200 bg-white"}`}>
              {l.label}
            </Link>
          ))}
        </div>
      </Card>
      <Card title="My account">
        <p className="mb-3 text-sm text-gray-600">{displayLogin(me.email)} · {me.role_name}</p>
        <ActionForm action={updateMyName} reset={false}>
          <Field label="My name"><input name="full_name" defaultValue={me.full_name} className="input" /></Field>
          <SubmitButton className="btn-secondary w-full">Save name</SubmitButton>
        </ActionForm>
        <div className="mt-3"><PasswordForm /></div>
        <form action={signOut} className="mt-3">
          <button className="btn-danger w-full">Sign out</button>
        </form>
      </Card>
      <p className="text-center text-xs text-gray-400">Tip: on your phone, use &quot;Add to Home Screen&quot; to open Muwa Gin like an app.</p>
    </div>
  );
}
