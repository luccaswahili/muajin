import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { fmtDate, num, today, tzs } from "@/lib/format";
import { WholesalerCard } from "@/components/wholesaler-card";
import { withRef } from "@/lib/shops";
import { byUrgency, HEALTH_LABEL, wholesalerMetrics, type Purchase, type WholesalerMetrics } from "@/lib/wholesalers";

export const metadata = { title: "Wholesalers" };

const ctn = (n: number | null | undefined, digits = 0) => `${num(n ?? 0, digits)} ctn`;
const ago = (days: number | null) => (days === null ? "" : days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

export default async function WholesalersPage() {
  const me = await requireMember();
  const supabase = await createClient();
  const { data: list } = await supabase
    .from("v_customer_balances")
    .select("id, name, phone, contact_name, region, area, lat, lng, balance, total_bought")
    .eq("shop_type", "wholesaler")
    .order("name");
  const people = list ?? [];
  const ids = people.map((w) => w.id);
  const { data: sales } = ids.length
    ? await supabase.from("v_sales").select("customer_id, date, cartons, bottles, bottles_per_carton, total").in("customer_id", ids)
    : { data: [] as Purchase[] };

  const t = today();
  const byCustomer = new Map<string, Purchase[]>();
  for (const s of (sales ?? []) as Purchase[]) {
    const arr = byCustomer.get(s.customer_id) ?? [];
    arr.push(s);
    byCustomer.set(s.customer_id, arr);
  }
  const rows = people.map((w) => wholesalerMetrics(w, byCustomer.get(w.id) ?? [], t)).sort(byUrgency);

  const sum = (f: (r: WholesalerMetrics) => number) => rows.reduce((a, r) => a + f(r), 0);
  const active = rows.filter((r) => r.daysSinceLast !== null && r.daysSinceLast <= 30).length;
  const month = sum((r) => r.cartonsMonth);
  const prev = sum((r) => r.cartonsPrevMonth);
  const shelf = sum((r) => r.estStock ?? 0);
  const owed = sum((r) => Math.max(0, Number(r.balance)));
  const attention = rows.filter((r) => r.health === "overdue" || r.health === "low");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Wholesalers"
        subtitle={me.is_agent ? "Numbers from your own sales" : "All customers saved as wholesalers"}
        action={<Link href="/map" className="btn-primary">+ Add on map</Link>}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="brand" label="Wholesalers" value={rows.length} hint={`${active} bought in the last 30 days`} />
        <Stat label="Cartons this month" value={ctn(month)} hint={`Last month: ${ctn(prev)}`} />
        <Stat label="Est. on their shelves" value={ctn(shelf)} hint="Estimate from how fast they sell" />
        <Stat label="Wholesalers owe" value={tzs(owed)} tone={owed > 0 ? "warn" : "default"} />
      </div>

      {attention.length > 0 && (
        <Card title={`Visit soon (${attention.length})`}>
          <div className="divide-y divide-gray-100">
            {attention.map((r) => (
              <Link key={r.id} href={`#w-${r.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate font-medium">{withRef(r.name, r.contact_name)}</div>
                  <div className="text-xs text-gray-500">
                    Last order {ago(r.daysSinceLast)}
                    {r.nextOrderDate && ` · expected ${fmtDate(r.nextOrderDate)}`}
                  </div>
                </div>
                <Badge tone={HEALTH_LABEL[r.health].tone}>{HEALTH_LABEL[r.health].label}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <Empty>
            No wholesalers yet. Add a shop on the map or edit a customer and set its type to Wholesaler.
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <WholesalerCard key={r.id} r={r} />
          ))}
        </div>
      )}

      <p className="text-xs text-gray-500">
        Stock on their shelves and the next order date are estimates: the app looks at how fast each wholesaler used up
        earlier orders and assumes they keep selling at that speed. They need at least 2 orders.
      </p>
    </div>
  );
}
