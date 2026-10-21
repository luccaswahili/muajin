import Link from "next/link";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, List, Row, Stat } from "@/components/ui";
import { fmtDate, monthStart, qty, today, tzs } from "@/lib/format";

export default async function Dashboard() {
  const me = await requireMember();
  const supabase = await createClient();
  const t = today();
  const m = monthStart();

  const [fin, stock, materials, todaySales, monthSales, monthExp, pending, recent, holders] = await Promise.all([
    supabase.from("v_finance_summary").select("*").single(),
    supabase.from("v_product_stock").select("*").eq("is_active", true).order("sort"),
    supabase.from("v_material_stock").select("*").eq("is_active", true),
    supabase.from("sales").select("total, cartons, bottles").eq("date", t),
    supabase.from("sales").select("total, cartons").gte("date", m),
    supabase.from("expenses").select("amount").gte("date", m),
    supabase.from("v_deposits").select("*").eq("status", "pending").order("date"),
    supabase.from("v_sales").select("*").order("created_at", { ascending: false }).limit(5),
    supabase.from("v_cash_holders").select("*").neq("cash_in_hand", 0),
  ]);

  const f = fin.data ?? { bank_balance: 0, cash_in_hand: 0, pending_deposits: 0, pending_deposit_count: 0, receivables: 0 };
  const sum = (rows: { [k: string]: unknown }[] | null, k: string) => (rows ?? []).reduce((a, r) => a + Number(r[k] ?? 0), 0);
  const todayTotal = sum(todaySales.data, "total");
  const todayCtn = sum(todaySales.data, "cartons");
  const monthTotal = sum(monthSales.data, "total");
  const monthCtn = sum(monthSales.data, "cartons");
  const monthExpenses = sum(monthExp.data, "amount");
  const totalCartons = (stock.data ?? []).reduce((a, s) => a + s.cartons, 0);
  const lowMaterials = (materials.data ?? []).filter((x) => Number(x.qty) <= Number(x.low_stock_level));
  const lowProducts = (stock.data ?? []).filter((x) => x.cartons <= x.low_stock_cartons);
  const needsMyReview = (pending.data ?? []).filter((d) => d.deposited_by !== me.id || me.is_admin);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{fmtDate(t)}</p>
          <h1 className="text-2xl font-bold text-brand-900">Hello {me.full_name.split(" ")[0] || "there"}</h1>
        </div>
        {can(me, "sales") && (
          <Link href="/sales/new" className="btn-primary">+ New sale</Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="brand" label="Bank balance" value={tzs(f.bank_balance)} hint="Confirmed in the official account" href="/money" />
        <Stat label="Cash not banked" value={tzs(f.cash_in_hand)} hint={`${tzs(f.pending_deposits)} waiting confirmation`} href="/money" tone={Number(f.cash_in_hand) > 0 ? "warn" : "default"} />
        <Stat label="Cartons in stock" value={totalCartons} hint={(stock.data ?? []).map((s) => `${s.name.replace(/^Muwa\s+/, "")}: ${s.cartons}`).join(" · ")} href="/stock" />
        <Stat label="Customers owe" value={tzs(f.receivables)} href="/customers" tone={Number(f.receivables) > 0 ? "warn" : "default"} />
        <Stat label="Sales today" value={tzs(todayTotal)} hint={`${todayCtn} cartons`} href="/sales" />
        <Stat label="Sales this month" value={tzs(monthTotal)} hint={`${monthCtn} cartons`} href="/reports" />
        <Stat label="Expenses this month" value={tzs(monthExpenses)} href="/expenses" />
        <Stat label="Profit this month" value={tzs(monthTotal - monthExpenses)} hint="Sales minus expenses" href="/reports" tone={monthTotal - monthExpenses < 0 ? "danger" : "default"} />
      </div>

      {can(me, "bank") && needsMyReview.length > 0 && (
        <Card title="Deposits waiting for confirmation" action={<Link href="/money" className="text-sm text-brand-600">Open</Link>}>
          <List>
            {needsMyReview.map((d) => (
              <Row key={d.id} href="/money">
                <div>
                  <div className="font-medium">{tzs(d.amount)}</div>
                  <div className="text-xs text-gray-500">{d.deposited_by_name} · {fmtDate(d.date)}</div>
                </div>
                <Badge tone="amber">Confirm</Badge>
              </Row>
            ))}
          </List>
        </Card>
      )}

      {(lowMaterials.length > 0 || lowProducts.length > 0) && (
        <Card title="Running low">
          <div className="flex flex-wrap gap-2">
            {lowProducts.map((p) => (
              <Badge key={p.product_id} tone="red">{p.name}: {p.cartons} ctn</Badge>
            ))}
            {lowMaterials.map((x) => (
              <Badge key={x.material_id} tone="amber">{x.name}: {Number(x.qty)} {x.unit}</Badge>
            ))}
          </div>
          <Link href="/stock" className="mt-2 inline-block text-sm text-brand-600">Update stock</Link>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Latest sales" action={<Link href="/sales" className="text-sm text-brand-600">All</Link>}>
          {recent.data?.length ? (
            <List>
              {recent.data.map((s) => (
                <Row key={s.id} href={`/sales/${s.id}`}>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.customer_name ?? "Walk-in"} · {qty(s.cartons, s.bottles)}</div>
                    <div className="text-xs text-gray-500">{s.product_name} · {fmtDate(s.date)} · {s.created_by_name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{tzs(s.total)}</div>
                    {Number(s.balance) > 0 && <Badge tone="amber">owes {tzs(s.balance)}</Badge>}
                  </div>
                </Row>
              ))}
            </List>
          ) : (
            <Empty>No sales yet.</Empty>
          )}
        </Card>
        <Card title="Who is holding cash" action={<Link href="/money" className="text-sm text-brand-600">Bank & cash</Link>}>
          {holders.data?.length ? (
            <List>
              {holders.data.map((h) => (
                <Row key={h.profile_id}>
                  <span>{h.full_name || h.email}</span>
                  <span className="font-semibold tabular-nums">{tzs(h.cash_in_hand)}</span>
                </Row>
              ))}
            </List>
          ) : (
            <Empty>All cash is in the bank.</Empty>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {can(me, "sales") && <Link href="/sales/new" className="btn-secondary">Record sale</Link>}
        {can(me, "production") && <Link href="/production/new" className="btn-secondary">Record production</Link>}
        {can(me, "expenses") && <Link href="/expenses/new" className="btn-secondary">Add expense</Link>}
        {can(me, "bank") && <Link href="/money#deposit" className="btn-secondary">Bank deposit</Link>}
      </div>
    </div>
  );
}
