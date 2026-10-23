import { requirePerm } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "@/components/sale-form";
import { today } from "@/lib/format";

export const metadata = { title: "New sale" };

export default async function NewSale({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  await requirePerm("sales");
  const { customer } = await searchParams;
  const supabase = await createClient();
  const [{ data: products }, { data: customers }] = await Promise.all([
    supabase.from("v_product_stock").select("*").eq("is_active", true).order("sort"),
    supabase.from("v_customer_balances").select("id, name, phone, balance").order("name"),
  ]);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="New sale" />
      <SaleForm products={products ?? []} customers={customers ?? []} date={today()} customerId={customer} />
    </div>
  );
}
