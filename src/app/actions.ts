"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PERMS } from "@/lib/auth";
import { displayLogin, loginToEmail } from "@/lib/format";

export type ActionState = { ok?: boolean; error?: string; message?: string } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optStr = (fd: FormData, k: string) => str(fd, k) || null;
const numOr = (fd: FormData, k: string, fallback: number | null = null) => {
  const raw = str(fd, k).replace(/,/g, "");
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

function done(message: string): ActionState {
  revalidatePath("/", "layout");
  return { ok: true, message };
}

function fail(error: { message: string } | null | undefined): ActionState {
  const msg = error?.message ?? "Something went wrong";
  if (msg.includes("row-level security") || msg.includes("permission")) {
    return { error: "You do not have permission to do this." };
  }
  return { error: msg };
}

async function rpc(name: string, args: Record<string, unknown>) {
  const supabase = await createClient();
  return supabase.rpc(name, args);
}

// ---------------------------------------------------------------- auth
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function updateMyName(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("update_my_name", { p_name: str(fd, "full_name") });
  return error ? fail(error) : done("Name updated");
}

// ---------------------------------------------------------------- sales
export async function createSale(_: ActionState, fd: FormData): Promise<ActionState> {
  const customer = str(fd, "customer_id");
  const { error } = await rpc("record_sale", {
    p_product_id: str(fd, "product_id"),
    p_cartons: numOr(fd, "cartons", 0),
    p_bottles: numOr(fd, "bottles", 0),
    p_price_carton: numOr(fd, "price_carton"),
    p_price_bottle: numOr(fd, "price_bottle"),
    p_customer_id: customer && customer !== "new" ? customer : null,
    p_new_customer_name: customer === "new" ? str(fd, "new_customer_name") : null,
    p_new_customer_phone: customer === "new" ? str(fd, "new_customer_phone") : null,
    p_amount_paid: numOr(fd, "amount_paid", 0),
    p_method: str(fd, "method") || "cash",
    p_discount: numOr(fd, "discount", 0),
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
  });
  return error ? fail(error) : done("Sale saved");
}

export async function recordCustomerPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("record_customer_payment", {
    p_customer_id: str(fd, "customer_id"),
    p_amount: numOr(fd, "amount"),
    p_method: str(fd, "method") || "cash",
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
  });
  return error ? fail(error) : done("Payment recorded");
}

export async function saveCustomer(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row: Record<string, unknown> = {
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    location: str(fd, "location"),
    notes: str(fd, "notes"),
  };
  if (!row.name) return { error: "Name is required" };
  // Shop fields are only sent by forms that show them
  for (const k of ["shop_type", "status", "contact_name", "region", "area"]) {
    if (fd.has(k)) row[k] = str(fd, k);
  }
  if (fd.has("lat")) {
    const lat = numOr(fd, "lat");
    const lng = numOr(fd, "lng");
    if ((lat === null) !== (lng === null)) return { error: "Location is incomplete" };
    row.lat = lat;
    row.lng = lng;
  }
  const { error } = id
    ? await supabase.from("customers").update(row).eq("id", id)
    : await supabase.from("customers").insert(row);
  return error ? fail(error) : done(id ? "Saved" : `${row.name} registered`);
}

// ---------------------------------------------------------------- production
export async function createProduction(_: ActionState, fd: FormData): Promise<ActionState> {
  let damaged: unknown = [];
  try {
    damaged = JSON.parse(str(fd, "damaged") || "[]");
  } catch {
    return { error: "Could not read the damaged items" };
  }
  const { data, error } = await rpc("record_production", {
    p_product_id: str(fd, "product_id"),
    p_drums: numOr(fd, "drums", 0),
    p_cartons: numOr(fd, "cartons", 0),
    p_loose_bottles: numOr(fd, "loose_bottles", 0),
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
    p_damaged: damaged,
  });
  if (error) return fail(error);
  revalidatePath("/", "layout");
  redirect(`/production/${data}`);
}

// ---------------------------------------------------------------- expenses
export async function createExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  const material = optStr(fd, "material_id");
  const { error } = await rpc("record_expense", {
    p_category_id: str(fd, "category_id"),
    p_amount: numOr(fd, "amount"),
    p_description: str(fd, "description"),
    p_paid_from: str(fd, "paid_from") || "cash",
    p_date: str(fd, "date"),
    p_production_id: optStr(fd, "production_id"),
    p_material_id: material,
    p_material_qty: material ? numOr(fd, "material_qty") : null,
    p_update_unit_cost: bool(fd, "update_unit_cost"),
  });
  return error ? fail(error) : done("Expense saved");
}

// ---------------------------------------------------------------- bank & cash
export async function createDeposit(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("record_deposit", {
    p_amount: numOr(fd, "amount"),
    p_reference: str(fd, "reference"),
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
  });
  return error ? fail(error) : done("Deposit recorded. Someone else needs to confirm it.");
}

export async function reviewDeposit(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("review_deposit", { p_id: str(fd, "id"), p_approve: str(fd, "approve") === "true" });
  return error ? fail(error) : done("Deposit updated");
}

export async function createTransfer(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("record_cash_transfer", {
    p_from: optStr(fd, "from"),
    p_to: str(fd, "to"),
    p_amount: numOr(fd, "amount"),
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
  });
  return error ? fail(error) : done("Cash handover recorded");
}

export async function recordCashAdjustment(_: ActionState, fd: FormData): Promise<ActionState> {
  const sign = str(fd, "direction") === "subtract" ? -1 : 1;
  const amount = numOr(fd, "amount", 0) ?? 0;
  if (amount <= 0) return { error: "Enter an amount" };
  const { error } = await rpc("record_cash_adjustment", {
    p_profile_id: str(fd, "profile_id"),
    p_amount: sign * amount,
    p_notes: str(fd, "notes"),
    p_date: str(fd, "date"),
  });
  return error ? fail(error) : done(sign > 0 ? "Cash added" : "Cash subtracted");
}

// ---------------------------------------------------------------- stock
export async function adjustProductStock(_: ActionState, fd: FormData): Promise<ActionState> {
  const ctn = numOr(fd, "cartons", 0) ?? 0;
  const btl = numOr(fd, "bottles", 0) ?? 0;
  const supabase = await createClient();
  const { data: prod } = await supabase.from("products").select("bottles_per_carton").eq("id", str(fd, "product_id")).maybeSingle();
  const per = prod?.bottles_per_carton ?? 30;
  const sign = str(fd, "direction") === "out" ? -1 : 1;
  const total = sign * (ctn * per + btl);
  if (!total) return { error: "Enter cartons or bottles" };
  const { error } = await rpc("adjust_product_stock", {
    p_product_id: str(fd, "product_id"),
    p_bottles: total,
    p_reason: str(fd, "reason"),
    p_notes: str(fd, "notes"),
    p_date: str(fd, "date"),
  });
  return error ? fail(error) : done("Stock updated");
}

export async function adjustMaterialStock(_: ActionState, fd: FormData): Promise<ActionState> {
  const sign = str(fd, "direction") === "out" ? -1 : 1;
  const q = numOr(fd, "qty", 0) ?? 0;
  if (!q) return { error: "Enter a quantity" };
  const { error } = await rpc("adjust_material_stock", {
    p_material_id: str(fd, "material_id"),
    p_qty: sign * q,
    p_reason: str(fd, "reason"),
    p_notes: str(fd, "notes"),
    p_date: str(fd, "date"),
  });
  return error ? fail(error) : done("Stock updated");
}

// ---------------------------------------------------------------- delete (logged in the activity log)
const DELETABLE = new Set([
  "sales", "payments", "productions", "expenses", "deposits", "cash_transfers", "owner_withdrawals",
  "customers", "product_movements", "material_movements", "invites", "cash_adjustments",
]);

export async function deleteRecord(_: ActionState, fd: FormData): Promise<ActionState> {
  const table = str(fd, "table");
  const id = str(fd, "id");
  if (!DELETABLE.has(table)) return { error: "Not allowed" };
  const supabase = await createClient();
  const key = table === "invites" ? "email" : "id";
  const { data, error } = await supabase.from(table).delete().eq(key, id).select(key);
  if (error) return fail(error);
  if (!data?.length) return { error: "Could not delete (no permission, or it is locked)." };
  const back = str(fd, "redirect");
  revalidatePath("/", "layout");
  if (back) redirect(back);
  return { ok: true, message: "Deleted" };
}

// ---------------------------------------------------------------- admin
export async function saveProduct(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = {
    name: str(fd, "name"),
    description: str(fd, "description"),
    bottle_ml: numOr(fd, "bottle_ml", 200),
    bottles_per_carton: numOr(fd, "bottles_per_carton", 30),
    price_carton: numOr(fd, "price_carton", 0),
    price_bottle: numOr(fd, "price_bottle", 0),
    low_stock_cartons: numOr(fd, "low_stock_cartons", 10),
    is_active: bool(fd, "is_active"),
  };
  if (!row.name) return { error: "Name is required" };
  const { error } = id ? await supabase.from("products").update(row).eq("id", id) : await supabase.from("products").insert(row);
  return error ? fail(error) : done(id ? "Product saved" : "Product added");
}

export async function saveMaterial(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = {
    name: str(fd, "name"),
    unit: str(fd, "unit") || "pcs",
    unit_cost: bool(fd, "is_free") ? 0 : numOr(fd, "unit_cost", 0),
    is_free: bool(fd, "is_free"),
    low_stock_level: numOr(fd, "low_stock_level", 0),
    usage: str(fd, "usage") || "none",
    usage_qty: numOr(fd, "usage_qty", 0),
    product_id: optStr(fd, "product_id"),
    is_active: bool(fd, "is_active"),
  };
  if (!row.name) return { error: "Name is required" };
  const { error } = id ? await supabase.from("materials").update(row).eq("id", id) : await supabase.from("materials").insert(row);
  return error ? fail(error) : done(id ? "Item saved" : "Item added");
}

export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = { name: str(fd, "name"), is_active: id ? bool(fd, "is_active") : true };
  if (!row.name) return { error: "Name is required" };
  const { error } = id
    ? await supabase.from("expense_categories").update(row).eq("id", id)
    : await supabase.from("expense_categories").insert(row);
  return error ? fail(error) : done(id ? "Category saved" : "Category added");
}

export async function saveSettings(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("s_")) continue;
    const key = k.slice(2);
    const raw = String(v).trim();
    const value = raw !== "" && !Number.isNaN(Number(raw)) && key !== "ethanol_material_id" ? Number(raw) : raw;
    const { error } = await supabase.from("settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    if (error) return fail(error);
  }
  return done("Settings saved");
}

export async function saveRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const permissions = Object.fromEntries(PERMS.map((p) => [p.key, bool(fd, `perm_${p.key}`)]));
  const row = { name: str(fd, "name"), permissions };
  if (!row.name) return { error: "Name is required" };
  const { error } = id ? await supabase.from("roles").update(row).eq("id", id) : await supabase.from("roles").insert(row);
  return error ? fail(error) : done(id ? "Role saved" : "Role added");
}

export async function updateMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: str(fd, "full_name"), role_id: optStr(fd, "role_id"), is_active: bool(fd, "is_active") })
    .eq("id", str(fd, "id"));
  return error ? fail(error) : done("Member saved");
}

export async function createInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  if (!str(fd, "email")) return { error: "Enter an email or a username" };
  const email = loginToEmail(str(fd, "email"));
  const role_id = str(fd, "role_id");
  // If the person already signed up, activate them directly.
  const { data: existing } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("profiles")
      .update({ role_id, is_active: true, full_name: str(fd, "full_name") || undefined })
      .eq("id", existing.id);
    return error ? fail(error) : done(`${displayLogin(email)} already had an account and is now active`);
  }
  const { error } = await supabase
    .from("invites")
    .upsert({ email, full_name: str(fd, "full_name"), role_id, accepted_at: null });
  return error ? fail(error) : done(`Invited ${displayLogin(email)}. They can now tap "Create account" and sign up with it.`);
}

export async function saveOwner(_: ActionState, fd: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const id = str(fd, "id");
  const row = { name: str(fd, "name"), share_pct: numOr(fd, "share_pct", 0), profile_id: optStr(fd, "profile_id") };
  if (!row.name) return { error: "Name is required" };
  const { error } = id ? await supabase.from("owners").update(row).eq("id", id) : await supabase.from("owners").insert(row);
  return error ? fail(error) : done(id ? "Owner saved" : "Owner added");
}

export async function recordWithdrawal(_: ActionState, fd: FormData): Promise<ActionState> {
  const { error } = await rpc("record_withdrawal", {
    p_owner_id: str(fd, "owner_id"),
    p_amount: numOr(fd, "amount"),
    p_paid_from: str(fd, "paid_from") || "bank",
    p_date: str(fd, "date"),
    p_notes: str(fd, "notes"),
  });
  return error ? fail(error) : done("Withdrawal recorded");
}
