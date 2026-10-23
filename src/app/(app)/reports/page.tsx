import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Field, List, PageHeader, Row, Stat } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { recordWithdrawal } from "@/app/actions";
import { fmtDate, fmtMonth, num, today, tzs } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const me = await requirePerm("reports");
  const supabase = await createClient();
  const [{ data: months }, { data: owners }, { data: withdrawals }, { data: batches }, { data: topCustomers }, { data: byProduct }, { data: shopRows }] = await Promise.all([
    supabase.from("v_monthly").select("*").order("month", { ascending: false }).limit(24),
    supabase.from("owners").select("*").order("created_at"),
    supabase.from("owner_withdrawals").select("*, owner:owners(name)").order("date", { ascending: false }),
    supabase.from("v_production_costs").select("*").order("date", { ascending: false }).limit(12),
    supabase.from("v_customer_balances").select("id, name, total_bought, balance").gt("total_bought", 0).order("total_bought", { ascending: false }).limit(10),
    supabase.from("v_sales").select("product_name, customer_id, cartons, bottles, total"),
    supabase.from("customers").select("id, region, area, status"),
  ]);
  const rows = months ?? [];
  const allSales = rows.reduce((a, r) => a + Number(r.sales_total), 0);
  const allExpenses = rows.reduce((a, r) => a + Number(r.expenses_total), 0);
  const allProfit = allSales - allExpenses;
  const withdrawnBy = new Map<string, number>();
  (withdrawals ?? []).forEach((w) => withdrawnBy.set(w.owner_id, (withdrawnBy.get(w.owner_id) ?? 0) + Number(w.amount)));
  const products = new Map<string, { ctn: number; btl: number; total: number }>();
  (byProduct ?? []).forEach((s) => {
    const p = products.get(s.product_name) ?? { ctn: 0, btl: 0, total: 0 };
    p.ctn += s.cartons; p.btl += s.bottles; p.total += Number(s.total);
    products.set(s.product_name, p);
  });
  const shopById = new Map((shopRows ?? []).map((c) => [c.id, c]));
  const regions = new Map<string, { ctn: number; total: number; areas: Map<string, number> }>();
  (byProduct ?? []).forEach((sale) => {
    const c = sale.customer_id ? shopById.get(sale.customer_id) : null;
    const key = c?.region || "Walk-in / no region";
    const r = regions.get(key) ?? { ctn: 0, total: 0, areas: new Map() };
    r.ctn += sale.cartons;
    r.total += Number(sale.total);
    if (c?.area) r.areas.set(c.area, (r.areas.get(c.area) ?? 0) + sale.cartons);
    regions.set(key, r);
  });
  const shopCounts = new Map<string, { all: number; active: number }>();
  (shopRows ?? []).forEach((c) => {
    const k = c.region || "No region";
    const v = shopCounts.get(k) ?? { all: 0, active: 0 };
    v.all += 1;
    if (c.status === "active") v.active += 1;
    shopCounts.set(k, v);
  });
  const maxMonth = Math.max(1, ...rows.map((r) => Math.max(Number(r.sales_total), Number(r.expenses_total))));

  return (
    <div className="space-y-4">
      <PageHeader title="Reports" subtitle="Profit = sales minus all expenses (including materials bought)" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="All-time sales" value={tzs(allSales)} />
        <Stat label="All-time expenses" value={tzs(allExpenses)} />
        <Stat label="All-time profit" value={tzs(allProfit)} tone={allProfit < 0 ? "danger" : "brand"} />
      </div>

      <Card title="Month by month">
        {rows.length ? (
          <div className="space-y-4">
            {rows.map((r) => (
              <div key={r.month}>
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{fmtMonth(r.month)}</span>
                  <span className={`font-semibold tabular-nums ${Number(r.profit) < 0 ? "text-red-600" : "text-emerald-700"}`}>{tzs(r.profit)}</span>
                </div>
                <div className="mt-1 space-y-1">
                  <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(Number(r.sales_total) / maxMonth) * 100}%` }} /></div>
                  <div className="h-2 rounded-full bg-gray-100"><div className="h-2 rounded-full bg-amber-500" style={{ width: `${(Number(r.expenses_total) / maxMonth) * 100}%` }} /></div>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  Sales {tzs(r.sales_total)} ({r.cartons_sold} ctn{r.bottles_sold ? ` + ${r.bottles_sold} btl` : ""}) · Expenses {tzs(r.expenses_total)} · Collected {tzs(r.cash_collected)} · Produced {r.cartons_produced} ctn from {num(r.drums_used, 2)} drums
                </div>
              </div>
            ))}
            <div className="flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-brand-500" /> Sales</span>
              <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-amber-500" /> Expenses</span>
            </div>
          </div>
        ) : (
          <Empty>No data yet.</Empty>
        )}
      </Card>

      <Card title="Owners' share of profit">
        <List>
          {(owners ?? []).map((o) => {
            const share = (allProfit * Number(o.share_pct)) / 100;
            const taken = withdrawnBy.get(o.id) ?? 0;
            return (
              <Row key={o.id}>
                <div>
                  <div className="font-medium">{o.name} · {num(o.share_pct, 2)}%</div>
                  <div className="text-xs text-gray-500">Share {tzs(share)} · taken {tzs(taken)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-500">Still due</div>
                  <div className="font-semibold tabular-nums">{tzs(share - taken)}</div>
                </div>
              </Row>
            );
          })}
        </List>
        <p className="mt-2 text-xs text-gray-500">Before sharing profit, remember to keep enough money in the bank for the next ethanol drum and other costs.</p>
        {me.is_admin && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-600">+ Record an owner withdrawal</summary>
            <ActionForm action={recordWithdrawal} className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Owner">
                  <select name="owner_id" className="input">{(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                </Field>
                <Field label="Amount"><input name="amount" inputMode="numeric" className="input" required /></Field>
                <Field label="Paid from"><select name="paid_from" className="input"><option value="bank">Bank</option><option value="cash">Cash I hold</option></select></Field>
                <Field label="Date"><input type="date" name="date" defaultValue={today()} className="input" /></Field>
              </div>
              <SubmitButton>Save withdrawal</SubmitButton>
            </ActionForm>
          </details>
        )}
        {!!withdrawals?.length && (
          <div className="mt-3 border-t pt-2">
            {withdrawals.slice(0, 10).map((w) => (
              <div key={w.id} className="flex justify-between py-1 text-xs text-gray-600">
                <span>{fmtDate(w.date)} · {(Array.isArray(w.owner) ? w.owner[0] : w.owner)?.name} · from {w.paid_from}</span>
                <span>{tzs(w.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Sales by region">
        <List>
          {[...regions.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, r]) => (
            <Row key={name}>
              <div className="min-w-0">
                <div className="font-medium">{name}</div>
                <div className="truncate text-xs text-gray-500">
                  {[...r.areas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a, n]) => `${a} ${n} ctn`).join(" · ")}
                  {shopCounts.get(name) && ` · ${shopCounts.get(name)!.active}/${shopCounts.get(name)!.all} shops buying`}
                </div>
              </div>
              <span className="shrink-0 text-right text-sm"><b>{tzs(r.total)}</b><br /><span className="text-xs text-gray-500">{r.ctn} ctn</span></span>
            </Row>
          ))}
        </List>
        {!regions.size && <Empty>No sales yet.</Empty>}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Sales by product">
          <List>
            {[...products.entries()].map(([name, p]) => (
              <Row key={name}>
                <span>{name}</span>
                <span className="text-right text-sm"><b>{tzs(p.total)}</b><br /><span className="text-xs text-gray-500">{p.ctn} ctn + {p.btl} btl</span></span>
              </Row>
            ))}
          </List>
          {!products.size && <Empty>No sales yet.</Empty>}
        </Card>
        <Card title="Top customers">
          <List>
            {(topCustomers ?? []).map((c) => (
              <Row key={c.id} href={`/customers/${c.id}`}>
                <span>{c.name}</span>
                <span className="text-sm tabular-nums">{tzs(c.total_bought)}</span>
              </Row>
            ))}
          </List>
          {!topCustomers?.length && <Empty>No customers yet.</Empty>}
        </Card>
      </div>

      <Card title="Recent production batches">
        <List>
          {(batches ?? []).map((b) => (
            <Row key={b.id} href={`/production/${b.id}`}>
              <div>
                <div className="text-sm font-medium">{fmtDate(b.date)} · {b.product_name}</div>
                <div className="text-xs text-gray-500">{b.cartons_produced} ctn · {b.cartons_per_drum ? `${num(b.cartons_per_drum, 1)}/drum` : "no drums"}</div>
              </div>
              <div className="text-right text-sm">
                <div>{b.cost_per_carton ? `${tzs(b.cost_per_carton)}/ctn` : "–"}</div>
                <div className="text-xs text-gray-500">margin {b.cost_per_carton ? tzs(Number(b.price_carton) - Number(b.cost_per_carton)) : "–"}/ctn</div>
              </div>
            </Row>
          ))}
        </List>
        {!batches?.length && <Empty>No production yet.</Empty>}
      </Card>
    </div>
  );
}
