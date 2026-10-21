import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime, tzs } from "@/lib/format";

export const metadata = { title: "Activity log" };

const TABLE_LABEL: Record<string, string> = {
  sales: "sale", payments: "payment", productions: "production", expenses: "expense", deposits: "bank deposit",
  customers: "customer", products: "product", materials: "material", expense_categories: "expense category",
  settings: "setting", roles: "role", profiles: "member", invites: "invite", owners: "owner",
  owner_withdrawals: "owner withdrawal", cash_transfers: "cash handover", cash_adjustments: "cash adjustment",
};

function describe(a: { table_name: string; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null }) {
  const d = (a.new_data ?? a.old_data ?? {}) as Record<string, unknown>;
  const bits: string[] = [];
  if (d.name) bits.push(String(d.name));
  if (d.full_name) bits.push(String(d.full_name));
  if (d.email && a.table_name !== "profiles") bits.push(String(d.email));
  if (d.key) bits.push(String(d.key));
  if (d.total) bits.push(tzs(d.total as number));
  else if (d.amount) bits.push(tzs(d.amount as number));
  if (d.cartons !== undefined) bits.push(`${d.cartons} ctn${d.bottles ? ` + ${d.bottles} btl` : ""}`);
  if (d.cartons_produced !== undefined) bits.push(`${d.cartons_produced} ctn produced`);
  if (d.description) bits.push(String(d.description));
  if (a.action === "update" && a.old_data && a.new_data) {
    const changed = Object.keys(a.new_data).filter(
      (k) => k !== "updated_at" && JSON.stringify(a.new_data![k]) !== JSON.stringify(a.old_data![k]),
    );
    if (changed.length) {
      bits.push(
        "changed " +
          changed
            .slice(0, 4)
            .map((k) => `${k.replace(/_/g, " ")}: ${JSON.stringify(a.old_data![k])} → ${JSON.stringify(a.new_data![k])}`)
            .join(", "),
      );
    }
  }
  return bits.join(" · ");
}

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePerm("activity");
  const page = Math.max(0, Number((await searchParams).page ?? 0));
  const supabase = await createClient();
  const { data } = await supabase.from("v_audit").select("*").order("at", { ascending: false }).range(page * 50, page * 50 + 49);

  return (
    <div className="space-y-4">
      <PageHeader title="Activity log" subtitle="Every change anyone makes is recorded here" />
      <Card>
        {data?.length ? (
          <ul className="divide-y divide-gray-100">
            {data.map((a) => (
              <li key={a.id} className="py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <b>{a.user_name || "System"}</b>
                  <Badge tone={a.action === "delete" ? "red" : a.action === "update" ? "blue" : "green"}>
                    {a.action === "insert" ? "added" : a.action === "update" ? "changed" : "deleted"}
                  </Badge>
                  <span>{TABLE_LABEL[a.table_name] ?? a.table_name}</span>
                </div>
                <div className="mt-0.5 break-words text-xs text-gray-600">{describe(a)}</div>
                <div className="text-xs text-gray-400">{fmtDateTime(a.at)}</div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No activity yet.</Empty>
        )}
        <div className="mt-3 flex justify-between text-sm">
          {page > 0 ? <a className="text-brand-600" href={`?page=${page - 1}`}>Newer</a> : <span />}
          {data?.length === 50 && <a className="text-brand-600" href={`?page=${page + 1}`}>Older</a>}
        </div>
      </Card>
    </div>
  );
}
