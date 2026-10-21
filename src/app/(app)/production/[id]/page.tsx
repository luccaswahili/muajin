import { notFound } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, List, PageHeader, Row, Stat } from "@/components/ui";
import { InlineAction } from "@/components/forms";
import { ExpenseForm } from "@/components/expense-form";
import { deleteRecord } from "@/app/actions";
import { expenseFormOptions } from "@/lib/options";
import { fmtDate, fmtDateTime, num, today, tzs } from "@/lib/format";

export default async function ProductionDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePerm("production");
  const { id } = await params;
  const supabase = await createClient();
  const { data: p } = await supabase.from("v_production_costs").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();
  const [{ data: mats }, { data: exps }, opts] = await Promise.all([
    supabase.from("material_movements").select("qty, unit_cost, reason, notes, material:materials(name, unit)").eq("production_id", id).order("reason", { ascending: false }),
    supabase.from("v_expenses").select("*").eq("production_id", id).order("date"),
    expenseFormOptions(),
  ]);
  const cartonsEq = p.cartons_produced + p.loose_bottles / p.bottles_per_carton;
  const revenue = cartonsEq * Number(p.price_carton);
  const profit = revenue - Number(p.total_cost);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title={`Batch #${p.batch_no} · ${p.cartons_produced} cartons${p.loose_bottles ? ` + ${p.loose_bottles} btl` : ""}`}
        subtitle={`${p.product_name} · ${fmtDate(p.date)} · by ${p.created_by_name}`}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drums used" value={num(p.drums_used, 2)} hint={`${num(p.ethanol_litres)} L ethanol`} />
        <Stat label="Cartons per drum" value={p.cartons_per_drum ? num(p.cartons_per_drum, 1) : "–"} />
        <Stat label="Cost per carton" value={p.cost_per_carton ? tzs(p.cost_per_carton) : "–"} hint={`Total ${tzs(p.total_cost)}`} />
        <Stat label="Expected profit" value={tzs(profit)} hint={`If all sold at ${tzs(p.price_carton)}`} tone={profit < 0 ? "danger" : "brand"} />
      </div>
      <Card title="Materials used">
        <List>
          {(mats ?? []).map((m, i) => {
            const mat = Array.isArray(m.material) ? m.material[0] : m.material;
            return (
              <Row key={i}>
                <span className="text-sm">
                  {mat?.name} · {num(-m.qty, 2)} {mat?.unit}
                  {m.reason === "damage" && <span className="ml-1 rounded bg-red-100 px-1.5 text-xs text-red-700">damaged</span>}
                  <span className="block text-xs text-gray-500">{m.notes}</span>
                </span>
                <span className="text-sm tabular-nums">{Number(m.unit_cost) ? tzs(-m.qty * m.unit_cost) : <span className="text-gray-400">no cost set</span>}</span>
              </Row>
            );
          })}
        </List>
        {!mats?.length && <p className="text-sm text-gray-500">Materials were not taken from stock for this batch.</p>}
      </Card>
      <Card title="Other costs for this batch">
        <List>
          {(exps ?? []).map((e) => (
            <Row key={e.id}>
              <span className="text-sm">{e.description || e.category_name} · {e.category_name}</span>
              <span className="text-sm tabular-nums">{tzs(e.amount)}</span>
            </Row>
          ))}
        </List>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-600">+ Add a cost (transport, workers, etc.)</summary>
          <div className="mt-3"><ExpenseForm {...opts} date={today()} productionId={p.id} /></div>
        </details>
      </Card>
      {p.notes && <Card title="Note"><p className="text-sm">{p.notes}</p></Card>}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>Recorded {fmtDateTime(p.created_at)}</span>
        <InlineAction
          action={deleteRecord}
          fields={{ table: "productions", id: p.id, redirect: "/production" }}
          label="Delete batch"
          className="btn-danger"
          confirm="Delete this batch? The cartons, used and damaged materials are all put back. Linked expenses are kept."
        />
      </div>
    </div>
  );
}
