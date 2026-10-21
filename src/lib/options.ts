import { createClient } from "@/lib/supabase/server";
import { fmtDate } from "@/lib/format";

export async function expenseFormOptions() {
  const supabase = await createClient();
  const [{ data: categories }, { data: materials }, { data: productions }] = await Promise.all([
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("sort").order("name"),
    supabase.from("materials").select("id, name, unit").eq("is_active", true).order("sort"),
    supabase.from("v_production_costs").select("id, date, product_name, cartons_produced").order("date", { ascending: false }).limit(20),
  ]);
  return {
    categories: categories ?? [],
    materials: materials ?? [],
    productions: (productions ?? []).map((p) => ({ id: p.id, label: `${fmtDate(p.date)} · ${p.product_name} · ${p.cartons_produced} ctn` })),
  };
}
