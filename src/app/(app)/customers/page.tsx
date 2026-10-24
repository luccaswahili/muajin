import { redirect } from "next/navigation";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, Field, List, PageHeader, Row, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { saveCustomer } from "@/app/actions";
import { fmtDate, tzs } from "@/lib/format";
import { SHOP_TYPES } from "@/lib/shops";
import Link from "next/link";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; nomap?: string }> }) {
  const me = await requireMember();
  if (!can(me, "sales") && !can(me, "customers")) redirect("/");
  const { q, nomap } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from("v_customer_balances").select("*").order("balance", { ascending: false }).order("name");
  if (q) query = query.or(`name.ilike.%${q.replace(/[%,()]/g, "")}%,phone.ilike.%${q.replace(/[%,()]/g, "")}%`);
  if (nomap) query = query.is("lat", null);
  const { data } = await query;
  const rows = data ?? [];
  const owed = rows.reduce((a, c) => a + Math.max(0, Number(c.balance)), 0);
  const debtors = rows.filter((c) => Number(c.balance) > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" action={<Link href="/map" className="btn-primary">Open map</Link>} />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total owed to Muwa Gin" value={tzs(owed)} tone={owed > 0 ? "warn" : "default"} />
        <Stat label="Customers with debt" value={debtors} hint={`${rows.length} customers`} />
      </div>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name or phone" className="input" />
        {nomap && <input type="hidden" name="nomap" value="1" />}
        <button className="btn-secondary">Search</button>
      </form>
      <div className="flex gap-2 text-sm">
        <Link href={q ? `/customers?q=${encodeURIComponent(q)}` : "/customers"} className={`rounded-full px-3 py-1 ${!nomap ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"}`}>All</Link>
        <Link href={`/customers?nomap=1${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full px-3 py-1 ${nomap ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-700"}`}>Not on map</Link>
      </div>
      <Card>
        {rows.length ? (
          <List>
            {rows.map((c) => (
              <Row key={c.id} href={`/customers/${c.id}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{c.name}</span>
                    {c.lat == null && <Badge tone="gray">not on map</Badge>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {[SHOP_TYPES[c.shop_type], c.area, c.phone].filter(Boolean).join(" · ")}
                    {c.last_purchase && ` · last ${fmtDate(c.last_purchase)}`}
                  </div>
                </div>
                <div className="text-right text-sm">
                  {Number(c.balance) > 0 ? <Badge tone="amber">owes {tzs(c.balance)}</Badge> : <span className="text-gray-500">{tzs(c.total_bought)}</span>}
                </div>
              </Row>
            ))}
          </List>
        ) : (
          <Empty>{nomap ? "Every customer is on the map." : "No customers yet. They are added when you record a sale or on the map."}</Empty>
        )}
      </Card>
      <Card title="Add customer">
        <ActionForm action={saveCustomer}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name"><input name="name" className="input" required /></Field>
            <Field label="Phone"><input name="phone" className="input" inputMode="tel" /></Field>
          </div>
          <Field label="Location"><input name="location" className="input" placeholder="Shop / area" /></Field>
          <SubmitButton>Add customer</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
