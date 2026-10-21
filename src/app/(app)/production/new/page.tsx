import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ProductionForm } from "@/components/production-form";
import { today } from "@/lib/format";

export const metadata = { title: "New production" };

export default async function NewProduction() {
  await requirePerm("production");
  const supabase = await createClient();
  const [{ data: products }, { data: materials }, { data: settings }, { data: last }] = await Promise.all([
    supabase.from("products").select("id, name, bottles_per_carton, bottle_ml").eq("is_active", true).order("sort"),
    supabase.from("v_material_stock").select("material_id, name, unit, qty, usage, usage_qty, product_id").eq("is_active", true).order("sort"),
    supabase.from("settings").select("key, value"),
    supabase.from("productions").select("batch_no").order("batch_no", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const s = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New production batch" />
      <ProductionForm
        products={products ?? []}
        materials={(materials ?? []).map((m) => ({ ...m, qty: Number(m.qty), usage_qty: Number(m.usage_qty) }))}
        date={today()}
        expectedPerDrum={Number(s.expected_cartons_per_drum ?? 105)}
        drumLitres={Number(s.drum_litres ?? 250)}
        nextBatch={(last?.batch_no ?? 0) + 1}
      />
    </div>
  );
}
