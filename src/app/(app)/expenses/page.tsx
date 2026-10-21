import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, List, PageHeader, Row, Stat } from "@/components/ui";
import { InlineAction } from "@/components/forms";
import { deleteRecord } from "@/app/actions";
import { fmtDate, monthStart, num, today, tzs } from "@/lib/format";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; cat?: string }> }) {
  const me = await requirePerm("expenses");
  const sp = await searchParams;
  const from = sp.from || monthStart();
  const to = sp.to || today();
  const supabase = await createClient();
  let q = supabase.from("v_expenses").select("*").gte("date", from).lte("date", to).order("date", { ascending: false }).order("created_at", { ascending: false });
  if (sp.cat) q = q.eq("category_id", sp.cat);
  const [{ data }, { data: cats }] = await Promise.all([q, supabase.from("expense_categories").select("id, name").order("sort")]);
  const rows = data ?? [];
  const total = rows.reduce((a, e) => a + Number(e.amount), 0);
  const byCat = new Map<string, number>();
  rows.forEach((e) => byCat.set(e.category_name, (byCat.get(e.category_name) ?? 0) + Number(e.amount)));

  return (
    <div className="space-y-4">
      <PageHeader title="Expenses" action={<Link href="/expenses/new" className="btn-primary">+ Add</Link>} />
      <form className="flex flex-wrap items-end gap-2 rounded-2xl bg-white p-3 shadow-sm">
        <label className="text-xs">From<input type="date" name="from" defaultValue={from} className="input mt-1 !py-1.5" /></label>
        <label className="text-xs">To<input type="date" name="to" defaultValue={to} className="input mt-1 !py-1.5" /></label>
        <label className="text-xs">Category
          <select name="cat" defaultValue={sp.cat ?? ""} className="input mt-1 !py-1.5">
            <option value="">All</option>
            {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button className="btn-secondary !py-1.5">Show</button>
      </form>
      <Stat label="Total spent" value={tzs(total)} hint={`${rows.length} expenses`} />
      {byCat.size > 1 && (
        <Card title="By category">
          <div className="space-y-2">
            {[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
              <div key={name}>
                <div className="flex justify-between text-sm"><span>{name}</span><span className="tabular-nums">{tzs(amt)}</span></div>
                <div className="h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(amt / total) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        {rows.length ? (
          <List>
            {rows.map((e) => (
              <Row key={e.id}>
                <div className="min-w-0">
                  <div className="truncate font-medium">{e.description || e.category_name}</div>
                  <div className="text-xs text-gray-500">
                    {e.category_name} · {fmtDate(e.date)} · {e.paid_by_name} · {e.paid_from === "bank" ? "from bank" : "cash"}
                    {e.material_name && ` · +${num(e.material_qty, 2)} ${e.material_unit} ${e.material_name}`}
                    {e.production_id && <> · <Link className="text-brand-600" href={`/production/${e.production_id}`}>batch</Link></>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{tzs(e.amount)}</span>
                  {(!e.material_id || me.is_admin) && <InlineAction action={deleteRecord} fields={{ table: "expenses", id: e.id }} label="Delete" className="text-xs text-red-600" confirm="Delete this expense? It is recorded in the activity log." />}
                </div>
              </Row>
            ))}
          </List>
        ) : (
          <Empty>No expenses in this period.</Empty>
        )}
      </Card>
      {rows.some((e) => e.paid_from === "bank") && <p className="text-center text-xs text-gray-500"><Badge>from bank</Badge> expenses reduce the bank balance; cash expenses reduce the cash the person holds.</p>}
    </div>
  );
}
