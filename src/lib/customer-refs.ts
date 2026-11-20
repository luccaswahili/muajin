import { createClient } from "@/lib/supabase/server";
import { withRef } from "@/lib/shops";

type Client = Awaited<ReturnType<typeof createClient>>;

/** Adds each customer's reference to rows that only carry customer_name (sales lists). */
export async function withCustomerRefs<T extends { customer_id: string | null; customer_name: string | null }>(supabase: Client, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.customer_id).filter((x): x is string => !!x))];
  if (!ids.length) return rows;
  const { data } = await supabase.from("customers").select("id, contact_name").in("id", ids).not("contact_name", "is", null);
  const refs = new Map((data ?? []).map((c) => [c.id, c.contact_name as string]));
  return rows.map((r) => (r.customer_id && refs.get(r.customer_id) ? { ...r, customer_name: withRef(r.customer_name, refs.get(r.customer_id)) } : r));
}
