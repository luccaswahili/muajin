import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyAccessToken } from "@/lib/supabase/verify";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * The signed-in user's id. With SUPABASE_JWT_SECRET set (self-hosted), the token is checked here,
 * which saves a round trip to the auth service on every page. Without it, ask Supabase.
 */
async function currentUserId(supabase: Client): Promise<string | null> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    const { data } = await supabase.auth.getSession();
    return verifyAccessToken(data.session?.access_token, secret);
  }
  const { data } = await supabase.auth.getClaims();
  return data?.claims?.sub ?? null;
}

export type Perm = "sales" | "production" | "expenses" | "bank" | "customers" | "stock" | "reports" | "activity";
export const PERMS: { key: Perm; label: string }[] = [
  { key: "sales", label: "Sales" },
  { key: "production", label: "Production" },
  { key: "expenses", label: "Expenses" },
  { key: "bank", label: "Bank & cash" },
  { key: "customers", label: "Customers" },
  { key: "stock", label: "Stock" },
  { key: "reports", label: "Reports" },
  { key: "activity", label: "Activity log" },
];

export type Me = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
  /** Sales agent: sees only their own sales and no company finances */
  is_agent: boolean;
  role_name: string | null;
  perms: Record<string, boolean>;
};

export const getMe = cache(async (): Promise<Me | null> => {
  const supabase = await createClient();
  const uid = await currentUserId(supabase);
  if (!uid) return null;
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, is_active, role:roles(name, is_admin, is_agent, permissions)")
    .eq("id", uid)
    .maybeSingle();
  if (!data) return null;
  const role = (Array.isArray(data.role) ? data.role[0] : data.role) as
    | { name: string; is_admin: boolean; is_agent: boolean; permissions: Record<string, boolean> }
    | null;
  return {
    id: data.id,
    email: data.email,
    full_name: data.full_name,
    is_active: data.is_active && !!role,
    is_admin: !!role?.is_admin,
    is_agent: !!role?.is_agent && !role?.is_admin,
    role_name: role?.name ?? null,
    perms: role?.permissions ?? {},
  };
});

export function can(me: Me, perm: Perm) {
  return me.is_admin || !!me.perms[perm];
}

export async function requireMember() {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.is_active) redirect("/pending");
  return me;
}

export async function requirePerm(perm: Perm) {
  const me = await requireMember();
  if (!can(me, perm)) redirect("/");
  return me;
}

export async function requireAdmin() {
  const me = await requireMember();
  if (!me.is_admin) redirect("/");
  return me;
}

/** Owners and admin who can see how the sales agents are doing. */
export function canSeeAgents(me: Me) {
  return !me.is_agent && can(me, "reports");
}
