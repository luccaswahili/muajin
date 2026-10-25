import { redirect } from "next/navigation";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Field, List, PageHeader, Row } from "@/components/ui";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import { adjustMaterialStock, adjustProductStock, deleteRecord } from "@/app/actions";
import { fmtDate, num, today, tzs } from "@/lib/format";

export const metadata = { title: "Stock" };

const PRODUCT_REASON: Record<string, string> = {
  production: "Production", sale: "Sale", opening: "Opening stock", adjustment: "Count correction",
  sample: "Free sample", breakage: "Broken / lost", return: "Customer return",
};

const MATERIAL_REASON: Record<string, string> = {
  purchase: "Bought (expense)", production: "Used in production", opening: "Opening stock", adjustment: "Count correction", damage: "Damaged",
};

export default async function StockPage() {
  const me = await requireMember();
  if (me.is_agent) redirect("/");
  const supabase = await createClient();
  const [{ data: products }, { data: materials }, { data: moves }, { data: matMoves }] = await Promise.all([
    supabase.from("v_product_stock").select("*").eq("is_active", true).order("sort"),
    supabase.from("v_material_stock").select("*").eq("is_active", true).order("sort"),
    supabase.from("product_movements").select("*, product:products(name, bottles_per_carton)").not("reason", "in", "(sale,production)").order("created_at", { ascending: false }).limit(15),
    supabase.from("material_movements").select("id, date, qty, reason, notes, production_id, material:materials(name, unit)").order("created_at", { ascending: false }).limit(40),
  ]);
  const editable = can(me, "stock");
  const stockValue = (materials ?? []).reduce((a, m) => a + Math.max(0, Number(m.qty)) * Number(m.unit_cost), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Stock" />
      <div className="grid gap-3 sm:grid-cols-2">
        {(products ?? []).map((p) => (
          <div key={p.product_id} className={`rounded-2xl border p-4 shadow-sm ${p.cartons <= p.low_stock_cartons ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
            <div className="text-sm text-gray-500">{p.name}</div>
            <div className="text-3xl font-bold">{p.cartons} <span className="text-base font-medium text-gray-500">cartons</span></div>
            <div className="text-sm text-gray-600">+ {p.loose_bottles} loose bottles · {num(p.bottles)} bottles total</div>
            <div className="text-xs text-gray-500">Worth {tzs((p.bottles / p.bottles_per_carton) * Number(p.price_carton))} at {tzs(p.price_carton)}/ctn</div>
          </div>
        ))}
      </div>

      <Card title="Materials">
        <List>
          {(materials ?? []).map((m) => {
            const low = Number(m.qty) <= Number(m.low_stock_level);
            return (
              <Row key={m.material_id}>
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-gray-500">{Number(m.unit_cost) ? `${tzs(m.unit_cost)} per ${m.unit}` : m.is_free ? "Free (comes with another item)" : "No cost price set"}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold tabular-nums ${Number(m.qty) < 0 ? "text-red-600" : ""}`}>{num(m.qty, 2)} {m.unit}</div>
                  {low && <Badge tone={Number(m.qty) < 0 ? "red" : "amber"}>{Number(m.qty) < 0 ? "count needed" : "low"}</Badge>}
                </div>
              </Row>
            );
          })}
        </List>
        <p className="mt-2 text-xs text-gray-500">Materials value ≈ {tzs(stockValue)}. Buying materials through Expenses adds to stock automatically; production takes them out. A negative number means opening stock was never entered.</p>
      </Card>

      {editable && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Correct gin stock">
            <ActionForm action={adjustProductStock}>
              <Field label="Product">
                <select name="product_id" className="input">
                  {(products ?? []).map((p) => <option key={p.product_id} value={p.product_id}>{p.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Reason">
                  <select name="reason" className="input">
                    <option value="opening">Opening stock (+)</option>
                    <option value="adjustment">Count correction</option>
                    {me.is_admin && <option value="sample">Free sample (−)</option>}
                    {me.is_admin && <option value="breakage">Broken / lost (−)</option>}
                    <option value="return">Customer return (+)</option>
                  </select>
                </Field>
                <Field label="Add or remove">
                  <select name="direction" className="input"><option value="in">Add</option>{me.is_admin && <option value="out">Remove</option>}</select>
                </Field>
                <Field label="Cartons"><input name="cartons" inputMode="numeric" className="input" placeholder="0" /></Field>
                <Field label="Bottles"><input name="bottles" inputMode="numeric" className="input" placeholder="0" /></Field>
              </div>
              <Field label="Note"><input name="notes" className="input" /></Field>
              <input type="hidden" name="date" value={today()} />
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Correct materials stock">
            <ActionForm action={adjustMaterialStock}>
              <Field label="Item">
                <select name="material_id" className="input">
                  {(materials ?? []).map((m) => <option key={m.material_id} value={m.material_id}>{m.name} ({m.unit})</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Reason">
                  <select name="reason" className="input">
                    <option value="opening">Opening</option>
                    <option value="adjustment">Correction</option>
                    {me.is_admin && <option value="damage">Damaged (−)</option>}
                  </select>
                </Field>
                <Field label="Add/remove">
                  <select name="direction" className="input"><option value="in">Add</option>{me.is_admin && <option value="out">Remove</option>}</select>
                </Field>
                <Field label="Quantity"><input name="qty" inputMode="decimal" className="input" required /></Field>
              </div>
              <Field label="Note"><input name="notes" className="input" /></Field>
              <input type="hidden" name="date" value={today()} />
              <SubmitButton>Save</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      {!!matMoves?.length && (
        <Card title="Materials history">
          <List>
            {matMoves.map((m) => {
              const mat = Array.isArray(m.material) ? m.material[0] : m.material;
              return (
                <Row key={m.id} href={m.production_id ? `/production/${m.production_id}` : undefined}>
                  <div className="min-w-0">
                    <div className="text-sm">{mat?.name}</div>
                    <div className="text-xs text-gray-500">{fmtDate(m.date)} · {m.notes || MATERIAL_REASON[m.reason]}</div>
                  </div>
                  <span className={`shrink-0 tabular-nums ${Number(m.qty) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {Number(m.qty) > 0 ? "+" : "−"}{num(Math.abs(Number(m.qty)), 2)} {mat?.unit}
                  </span>
                </Row>
              );
            })}
          </List>
        </Card>
      )}

      {!!moves?.length && (
        <Card title="Recent gin stock corrections">
          <List>
            {moves.map((m) => {
              const p = Array.isArray(m.product) ? m.product[0] : m.product;
              const per = p?.bottles_per_carton ?? 30;
              const abs = Math.abs(m.bottles);
              return (
                <Row key={m.id}>
                  <div>
                    <div className="text-sm">{PRODUCT_REASON[m.reason]} · {p?.name}</div>
                    <div className="text-xs text-gray-500">{fmtDate(m.date)}{m.notes ? ` · ${m.notes}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`tabular-nums ${m.bottles < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {m.bottles < 0 ? "−" : "+"}{Math.floor(abs / per) ? `${Math.floor(abs / per)} ctn ` : ""}{abs % per ? `${abs % per} btl` : ""}
                    </span>
                    {me.is_admin && <InlineAction action={deleteRecord} fields={{ table: "product_movements", id: m.id }} label="×" className="text-red-600" confirm="Undo this correction?" />}
                  </div>
                </Row>
              );
            })}
          </List>
        </Card>
      )}
    </div>
  );
}
