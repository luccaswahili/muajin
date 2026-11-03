import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader } from "@/components/ui";
import { SaleForm, type StockSource } from "@/components/sale-form";
import { AgentStockForm, ReleaseTabs } from "@/components/release-form";
import { today } from "@/lib/format";
import { salesAgents } from "@/lib/options";

export const metadata = { title: "New release" };

export default async function NewRelease({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const me = await requirePerm("sales");
  const { customer } = await searchParams;
  const supabase = await createClient();
  const [{ data: products }, { data: holds }, agents, { data: customers }] = await Promise.all([
    supabase.from("v_product_stock").select("*").eq("is_active", true).order("sort"),
    supabase.from("v_agent_hold").select("*").gt("bottles", 0),
    me.is_agent ? Promise.resolve([]) : salesAgents(),
    customer
      ? supabase.from("v_customer_balances").select("id, name, phone, balance").eq("id", customer)
      : Promise.resolve({ data: [] }),
  ]);
  const prods = products ?? [];
  const holdOf = (agentId: string): Record<string, number> =>
    Object.fromEntries((holds ?? []).filter((h) => h.agent_id === agentId).map((h) => [h.product_id, Number(h.bottles)]));

  // Agents sell only what they hold
  if (me.is_agent) {
    const mine = holdOf(me.id);
    const hasStock = Object.values(mine).some((b) => b > 0);
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="New sale" subtitle="Sold from the gin you are holding" />
        {hasStock ? (
          <SaleForm products={prods} customers={customers ?? []} date={today()} customerId={customer} sources={[{ id: me.id, label: "My stock", bottles: mine }]} />
        ) : (
          <Card><p className="text-sm text-gray-600">You are not holding any gin right now. Ask an owner to release some to you, then record your sales here.</p></Card>
        )}
      </div>
    );
  }

  const sources: StockSource[] = [
    { id: "", label: "Warehouse", bottles: Object.fromEntries(prods.map((p) => [p.product_id, Number(p.bottles)])) },
  ];
  // Only the admin may sell from an agent's hold on their behalf
  if (me.is_admin) {
    for (const a of agents) {
      const b = holdOf(a.id);
      const ctn = (holds ?? []).filter((h) => h.agent_id === a.id).reduce((t, h) => t + Number(h.cartons), 0);
      if (Object.values(b).some((x) => x > 0)) sources.push({ id: a.id, label: `${a.name}'s stock (${ctn} ctn)`, bottles: b });
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New release" subtitle="Gin leaving the warehouse" />
      <ReleaseTabs
        sale={<SaleForm products={prods} customers={customers ?? []} date={today()} customerId={customer} sources={sources} />}
        agentTake={<Card><AgentStockForm agents={agents} products={prods} date={today()} /></Card>}
      />
    </div>
  );
}
