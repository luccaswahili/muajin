import { redirect } from "next/navigation";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/format";
import { LocateMap, type LocateCustomer } from "@/components/locate-map";

export const metadata = { title: "Locate" };

export default async function LocatePage() {
  const me = await requireMember();
  if (!can(me, "sales") && !can(me, "customers")) redirect("/");
  const supabase = await createClient();
  const [{ data: located }, { data: unpaid }, { data: paid }, { data: unlocated }] = await Promise.all([
    supabase
      .from("v_customer_balances")
      .select("id, name, contact_name, phone, area, lat, lng, balance, last_purchase")
      .not("lat", "is", null)
      .not("lng", "is", null),
    supabase.from("v_sales").select("customer_id, date").gt("balance", 0).not("customer_id", "is", null),
    supabase.from("payments").select("date, customer_id, sale:sales(customer_id)").order("date", { ascending: false }).limit(5000),
    supabase.from("v_customer_balances").select("balance").is("lat", null).gt("balance", 0),
  ]);

  const owingSince = new Map<string, string>();
  for (const s of unpaid ?? []) {
    const prev = owingSince.get(s.customer_id);
    if (!prev || s.date < prev) owingSince.set(s.customer_id, s.date);
  }
  const lastPayment = new Map<string, string>();
  for (const p of paid ?? []) {
    const sale = (Array.isArray(p.sale) ? p.sale[0] : p.sale) as { customer_id: string | null } | null;
    const cid = p.customer_id ?? sale?.customer_id;
    if (cid && !lastPayment.has(cid)) lastPayment.set(cid, p.date);
  }

  const customers: LocateCustomer[] = (located ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    contact_name: c.contact_name,
    phone: c.phone,
    area: c.area,
    lat: Number(c.lat),
    lng: Number(c.lng),
    balance: Number(c.balance),
    last_purchase: c.last_purchase,
    owing_since: owingSince.get(c.id) ?? null,
    last_payment: lastPayment.get(c.id) ?? null,
  }));
  const unlocatedDebtors = {
    count: (unlocated ?? []).length,
    total: (unlocated ?? []).reduce((a, c) => a + Number(c.balance), 0),
  };

  return <LocateMap customers={customers} isAgent={me.is_agent} today={today()} unlocatedDebtors={unlocatedDebtors} />;
}
