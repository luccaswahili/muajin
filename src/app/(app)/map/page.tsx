import { redirect } from "next/navigation";
import { can, requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ShopMap, type Shop } from "@/components/shop-map";

export const metadata = { title: "Map" };

export default async function MapPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const me = await requireMember();
  if (!can(me, "sales") && !can(me, "customers")) redirect("/");
  const { shop } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_customer_balances")
    .select("id, name, phone, contact_name, shop_type, status, region, area, lat, lng, balance, cartons_bought, last_purchase")
    .not("lat", "is", null)
    .not("lng", "is", null);
  return <ShopMap shops={(data ?? []) as Shop[]} canAdd={can(me, "sales") || can(me, "customers")} focusId={shop} />;
}
