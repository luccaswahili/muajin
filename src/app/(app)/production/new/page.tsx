import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { ProductionForm } from "@/components/production-form";
import { today } from "@/lib/format";

export const metadata = { title: "New production" };

export default async function NewProduction() {
  await requirePerm("production");
  const supabase = await createClient();
  const [{ data: products }, { data: materials }, { data: settings }] = await Promise.all([
    supabase.from("products").select("id, name, bottles_per_carton, bottle_ml").eq("is_active", true).order("sort"),
    supabase.from("materials").select("id, name").eq("is_active", true).ilike("name", "%flavo%").order("sort"),
    supabase.from("settings").select("key, value"),
  ]);
  const s = Object.fromEntries((settings ?? []).map((r) => [r.key, r.value]));
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New production batch" />
      <ProductionForm
        products={products ?? []}
        flavors={materials ?? []}
        date={today()}
        expectedPerDrum={Number(s.expected_cartons_per_drum ?? 105)}
        drumLitres={Number(s.drum_litres ?? 250)}
        ethanolPct={Number(s.ethanol_pct ?? 38)}
        flavorPct={Number(s.flavor_pct ?? 0.5)}
      />
    </div>
  );
}
