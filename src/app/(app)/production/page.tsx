import Link from "next/link";
import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, List, PageHeader, Row, Stat } from "@/components/ui";
import { fmtDate, num, tzs } from "@/lib/format";

export const metadata = { title: "Production" };

export default async function ProductionPage() {
  await requirePerm("production");
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from("v_production_costs").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    supabase.from("settings").select("key, value").eq("key", "expected_cartons_per_drum").maybeSingle(),
  ]);
  const rows = data ?? [];
  const totalCartons = rows.reduce((a, r) => a + r.cartons_produced, 0);
  const totalDrums = rows.reduce((a, r) => a + Number(r.drums_used), 0);
  const expected = Number(settings?.value ?? 105);

  return (
    <div className="space-y-4">
      <PageHeader title="Production" action={<Link href="/production/new" className="btn-primary">+ New batch</Link>} />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Batches" value={rows.length} />
        <Stat label="Cartons made" value={num(totalCartons)} />
        <Stat label="Avg per drum" value={totalDrums ? num(totalCartons / totalDrums, 1) : "–"} hint={`Expected ${expected}`} />
      </div>
      <Card>
        {rows.length ? (
          <List>
            {rows.map((p) => (
              <Row key={p.id} href={`/production/${p.id}`}>
                <div>
                  <div className="font-medium">{p.cartons_produced} cartons{p.loose_bottles ? ` + ${p.loose_bottles} btl` : ""} · {p.product_name}</div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(p.date)} · {num(p.drums_used, 2)} drum{Number(p.drums_used) === 1 ? "" : "s"}
                    {p.cartons_per_drum && ` · ${num(p.cartons_per_drum, 1)} per drum`}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{tzs(p.total_cost)}</div>
                  {p.cost_per_carton && <div className="text-xs text-gray-500">{tzs(p.cost_per_carton)}/ctn</div>}
                </div>
              </Row>
            ))}
          </List>
        ) : (
          <Empty>No production recorded yet.</Empty>
        )}
      </Card>
    </div>
  );
}
