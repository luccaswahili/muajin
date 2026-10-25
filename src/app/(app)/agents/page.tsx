import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeAgents, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { fmtDate, monthStart, num, today, tzs } from "@/lib/format";

export const metadata = { title: "Sales agents" };

type AgentRow = {
  profile_id: string; full_name: string; email: string; is_active: boolean;
  sales_count: number; cartons: number; bottles: number; sales_total: number;
  credit_given: number; collected: number; owed_now: number; cash_in_hand: number;
  customers_added: number; customers_total: number; customers_on_map: number; last_sale: string | null;
};

export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await requireMember();
  if (!canSeeAgents(me)) redirect("/");
  const sp = await searchParams;
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("agent_stats", { p_from: from, p_to: to });
  const agents = (data ?? []) as AgentRow[];
  const total = (k: keyof AgentRow) => agents.reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const best = Math.max(1, ...agents.map((a) => Number(a.cartons)));

  return (
    <div className="space-y-4">
      <PageHeader title="Sales agents" subtitle="How each agent is doing. Agents only see their own sales." />
      <form className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <label className="text-xs">From<input type="date" name="from" defaultValue={from} className="input mt-1 !py-1.5" /></label>
        <label className="text-xs">To<input type="date" name="to" defaultValue={to} className="input mt-1 !py-1.5" /></label>
        <button className="btn-secondary !py-1.5">Show</button>
      </form>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="brand" label="Agents' sales" value={tzs(total("sales_total"))} hint={`${num(total("cartons"))} cartons · ${num(total("sales_count"))} sales`} />
        <Stat label="Collected" value={tzs(total("collected"))} hint="Payments they received" />
        <Stat label="Customers owe agents" value={tzs(total("owed_now"))} hint="All time, still unpaid" tone={total("owed_now") > 0 ? "warn" : "default"} />
        <Stat label="Cash agents hold" value={tzs(total("cash_in_hand"))} hint="Not yet handed over" tone={total("cash_in_hand") > 0 ? "warn" : "default"} href="/money" />
      </div>

      {agents.length === 0 ? (
        <Card><Empty>No sales agents yet. In Admin, give someone the “Sales agent” role.</Empty></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {agents.map((a, i) => (
            <Card key={a.profile_id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">{i + 1}</span>
                    <span className="truncate text-lg font-semibold">{a.full_name || a.email}</span>
                    {!a.is_active && <Badge tone="gray">off</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{a.last_sale ? `Last sale ${fmtDate(a.last_sale)}` : "No sales yet"}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums">{tzs(a.sales_total)}</div>
                  <div className="text-xs text-gray-500">{num(a.cartons)} ctn{Number(a.bottles) ? ` + ${num(a.bottles)} btl` : ""} · {num(a.sales_count)} sales</div>
                </div>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${(Number(a.cartons) / best) * 100}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-gray-500">Collected</dt><dd className="tabular-nums">{tzs(a.collected)}</dd></div>
                <div><dt className="text-xs text-gray-500">Customers owe</dt><dd className={`tabular-nums ${Number(a.owed_now) > 0 ? "text-amber-700" : ""}`}>{tzs(a.owed_now)}</dd></div>
                <div><dt className="text-xs text-gray-500">Cash holding</dt><dd className={`tabular-nums ${Number(a.cash_in_hand) > 0 ? "font-semibold text-amber-700" : ""}`}>{tzs(a.cash_in_hand)}</dd></div>
                <div><dt className="text-xs text-gray-500">New customers</dt><dd className="tabular-nums">{num(a.customers_added)}</dd></div>
                <div><dt className="text-xs text-gray-500">All customers</dt><dd className="tabular-nums">{num(a.customers_total)}</dd></div>
                <div><dt className="text-xs text-gray-500">On the map</dt><dd className="tabular-nums">{num(a.customers_on_map)} / {num(a.customers_total)}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <Link href={`/sales?seller=${a.profile_id}&from=${from}&to=${to}`} className="btn-secondary !py-1.5">See sales</Link>
                <Link href={`/sales?seller=${a.profile_id}&from=2020-01-01&to=${today()}&unpaid=1`} className="btn-secondary !py-1.5">Unpaid sales</Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500">
        “Collected” counts payments the agent received in this period. Cash an agent collects stays with them until an owner records it as handed over in Bank &amp; cash.
      </p>
    </div>
  );
}
