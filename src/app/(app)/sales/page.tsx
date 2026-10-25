import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, List, PageHeader, Row, Stat } from "@/components/ui";
import { fmtDate, monthStart, qty, today, tzs } from "@/lib/format";

export const metadata = { title: "Sales" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; unpaid?: string; seller?: string }> }) {
  await requirePerm("sales");
  const sp = await searchParams;
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const supabase = await createClient();
  let q = supabase.from("v_sales").select("*").gte("date", from).lte("date", to).order("date", { ascending: false }).order("created_at", { ascending: false });
  if (sp.unpaid) q = q.gt("balance", 0);
  if (sp.seller) q = q.eq("created_by", sp.seller);
  const { data: sales } = await q;
  const rows = sales ?? [];
  const total = rows.reduce((a, s) => a + Number(s.total), 0);
  const ctn = rows.reduce((a, s) => a + s.cartons, 0);
  const btl = rows.reduce((a, s) => a + s.bottles, 0);
  const owed = rows.reduce((a, s) => a + Number(s.balance), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Sales" action={<Link href="/sales/new" className="btn-primary">+ New sale</Link>} />
      <form className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <label className="text-xs">From<input type="date" name="from" defaultValue={from} className="input mt-1 !py-1.5" /></label>
        <label className="text-xs">To<input type="date" name="to" defaultValue={to} className="input mt-1 !py-1.5" /></label>
        <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="unpaid" defaultChecked={!!sp.unpaid} /> Unpaid only</label>
        {sp.seller && <input type="hidden" name="seller" value={sp.seller} />}
        <button className="btn-secondary !py-1.5">Show</button>
      </form>
      {sp.seller && (
        <p className="text-sm text-gray-600">
          Showing sales by <b>{rows[0]?.created_by_name ?? "this person"}</b> ·{" "}
          <Link href={`/sales?from=${from}&to=${to}`} className="text-brand-600">show everyone</Link>
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total" value={tzs(total)} />
        <Stat label="Sold" value={qty(ctn, btl)} />
        <Stat label="Unpaid" value={tzs(owed)} tone={owed > 0 ? "warn" : "default"} />
      </div>
      <Card>
        {rows.length ? (
          <List>
            {rows.map((s) => (
              <Row key={s.id} href={`/sales/${s.id}`}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.customer_name ?? "Walk-in"} · {qty(s.cartons, s.bottles)}</div>
                  <div className="text-xs text-gray-500">{s.product_name} · {fmtDate(s.date)} · by {s.created_by_name}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-semibold tabular-nums">{tzs(s.total)}</div>
                  {Number(s.balance) > 0 ? <Badge tone="amber">owes {tzs(s.balance)}</Badge> : <Badge tone="green">paid</Badge>}
                </div>
              </Row>
            ))}
          </List>
        ) : (
          <Empty>No sales in this period.</Empty>
        )}
      </Card>
    </div>
  );
}
