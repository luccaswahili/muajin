import Link from "next/link";
import { PERMS, requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { ActionForm, InlineAction, SubmitButton } from "@/components/forms";
import {
  createInvite, deleteRecord, saveCategory, saveMaterial, saveOwner, saveProduct, saveRole, saveSettings, updateMember,
} from "@/app/actions";
import { displayLogin, fmtDate } from "@/lib/format";

export const metadata = { title: "Admin" };

const TABS = [
  { key: "members", label: "Members" },
  { key: "roles", label: "Roles" },
  { key: "products", label: "Products & prices" },
  { key: "materials", label: "Materials" },
  { key: "categories", label: "Expense types" },
  { key: "owners", label: "Owners" },
  { key: "settings", label: "Settings" },
];

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requireAdmin();
  const tab = (await searchParams).tab ?? "members";
  const supabase = await createClient();
  const { data: roles } = await supabase.from("roles").select("*").order("created_at");

  return (
    <div className="space-y-4">
      <PageHeader title="Admin" subtitle="Only you can see this" />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin?tab=${t.key}`} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${tab === t.key ? "bg-brand-600 text-white" : "bg-white text-gray-700"}`}>
            {t.label}
          </Link>
        ))}
      </div>
      {tab === "members" && <Members roles={roles ?? []} meId={me.id} />}
      {tab === "roles" && <Roles roles={roles ?? []} />}
      {tab === "products" && <Products />}
      {tab === "materials" && <Materials />}
      {tab === "categories" && <Categories />}
      {tab === "owners" && <Owners />}
      {tab === "settings" && <Settings />}
    </div>
  );
}

type Role = { id: string; name: string; is_admin: boolean; permissions: Record<string, boolean> };

async function Members({ roles, meId }: { roles: Role[]; meId: string }) {
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase.from("invites").select("*, role:roles(name)").is("accepted_at", null).order("created_at"),
  ]);
  return (
    <>
      <Card title="Invite a new member">
        <ActionForm action={createInvite}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Email or username"><input name="email" className="input" autoCapitalize="none" required /></Field>
            <Field label="Name"><input name="full_name" className="input" placeholder="e.g. Sergio" /></Field>
            <Field label="Role">
              <select name="role_id" className="input" defaultValue={roles.find((r) => r.name === "Owner")?.id}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          </div>
          <SubmitButton>Invite</SubmitButton>
          <p className="text-xs text-gray-500">Then send them the app link. They tap &quot;Create account&quot; and use this same email or username.</p>
        </ActionForm>
      </Card>
      {!!invites?.length && (
        <Card title="Invited, not signed up yet">
          {invites.map((i) => (
            <div key={i.email} className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
              <div className="text-sm">{i.full_name || i.email}<div className="text-xs text-gray-500">{displayLogin(i.email)} · {(Array.isArray(i.role) ? i.role[0] : i.role)?.name}</div></div>
              <InlineAction action={deleteRecord} fields={{ table: "invites", id: i.email }} label="Cancel" className="text-xs text-red-600" />
            </div>
          ))}
        </Card>
      )}
      <Card title="Members">
        <div className="space-y-3">
          {(members ?? []).map((m) => (
            <ActionForm key={m.id} action={updateMember} reset={false} className="space-y-2 rounded-xl border border-gray-200 p-3">
              <input type="hidden" name="id" value={m.id} />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{displayLogin(m.email)} · joined {fmtDate(m.created_at)}</span>
                {!m.is_active && <Badge tone="amber">no access</Badge>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input name="full_name" defaultValue={m.full_name} className="input" placeholder="Name" />
                <select name="role_id" defaultValue={m.role_id ?? ""} className="input" disabled={m.id === meId}>
                  <option value="">No role</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              {m.id === meId && <input type="hidden" name="role_id" value={m.role_id ?? ""} />}
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_active" defaultChecked={m.is_active} disabled={m.id === meId} /> Can use the app
                </label>
                {m.id === meId && <input type="hidden" name="is_active" value="true" />}
                <SubmitButton className="btn-secondary !py-1.5">Save</SubmitButton>
              </div>
            </ActionForm>
          ))}
        </div>
      </Card>
    </>
  );
}

function Roles({ roles }: { roles: Role[] }) {
  return (
    <Card title="Roles and what they can do">
      <div className="space-y-3">
        {roles.map((r) => <RoleForm key={r.id} r={r} />)}
        <p className="pt-2 text-sm font-medium">New role</p>
        <RoleForm />
      </div>
    </Card>
  );
}

async function Products() {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("*").order("sort");
  return (
    <Card title="Products and prices">
      <div className="space-y-3">
        {(data ?? []).map((p) => <ProductForm key={p.id} p={p} />)}
        <p className="pt-2 text-sm font-medium">New product / flavor</p>
        <ProductForm />
      </div>
    </Card>
  );
}

async function Materials() {
  const supabase = await createClient();
  const [{ data }, { data: products }] = await Promise.all([
    supabase.from("materials").select("*").order("sort"),
    supabase.from("products").select("id, name").order("sort"),
  ]);
  return (
    <Card title="Materials (raw items)">
      <p className="mb-3 text-xs text-gray-500">Every production batch takes these items out of stock automatically, using &quot;Used in production&quot;. Example: bottles, caps, labels and TRA stamps: 1 per bottle. Boxes: 1 per carton. Ethanol: 1 per drum (if the unit is drum). Flavor: 0.1 litre per drum, only for its product.</p>
      <div className="space-y-3">
        {(data ?? []).map((m) => <MatForm key={m.id} m={m} products={products ?? []} />)}
        <p className="pt-2 text-sm font-medium">New item</p>
        <MatForm products={products ?? []} />
      </div>
    </Card>
  );
}

async function Categories() {
  const supabase = await createClient();
  const { data } = await supabase.from("expense_categories").select("*").order("sort").order("name");
  return (
    <Card title="Expense types">
      <div className="space-y-2">
        {(data ?? []).map((c) => (
          <ActionForm key={c.id} action={saveCategory} reset={false} className="flex items-center gap-2">
            <input type="hidden" name="id" value={c.id} />
            <input name="name" defaultValue={c.name} className="input" />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={c.is_active} /> on</label>
            <SubmitButton className="btn-secondary !px-3 !py-1.5">Save</SubmitButton>
          </ActionForm>
        ))}
        <ActionForm action={saveCategory} className="flex items-center gap-2 pt-3">
          <input name="name" className="input" placeholder="New expense type" required />
          <SubmitButton className="btn-primary !px-3 !py-1.5">Add</SubmitButton>
        </ActionForm>
      </div>
    </Card>
  );
}

async function Owners() {
  const supabase = await createClient();
  const [{ data }, { data: members }] = await Promise.all([
    supabase.from("owners").select("*").order("created_at"),
    supabase.from("profiles").select("id, full_name, email").order("full_name"),
  ]);
  const total = (data ?? []).reduce((a, o) => a + Number(o.share_pct), 0);
  return (
    <Card title="Owners and profit shares">
      <p className={`mb-3 text-sm ${Math.abs(total - 100) > 0.01 ? "text-red-600" : "text-gray-500"}`}>Shares add up to {total.toFixed(3)}% (should be 100%).</p>
      <div className="space-y-2">
        {(data ?? []).map((o) => (
          <ActionForm key={o.id} action={saveOwner} reset={false} className="grid grid-cols-[1fr_5rem_1fr_auto] items-center gap-2">
            <input type="hidden" name="id" value={o.id} />
            <input name="name" defaultValue={o.name} className="input" />
            <input name="share_pct" defaultValue={Number(o.share_pct)} inputMode="decimal" className="input" />
            <select name="profile_id" defaultValue={o.profile_id ?? ""} className="input">
              <option value="">Login: none</option>
              {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
            </select>
            <SubmitButton className="btn-secondary !px-3 !py-1.5">Save</SubmitButton>
          </ActionForm>
        ))}
        <ActionForm action={saveOwner} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2 pt-3">
          <input name="name" className="input" placeholder="New owner" required />
          <input name="share_pct" inputMode="decimal" className="input" placeholder="%" />
          <SubmitButton className="btn-primary !px-3 !py-1.5">Add</SubmitButton>
        </ActionForm>
      </div>
    </Card>
  );
}

async function Settings() {
  const supabase = await createClient();
  const [{ data }, { data: materials }] = await Promise.all([
    supabase.from("settings").select("*").order("key"),
    supabase.from("materials").select("id, name").order("sort"),
  ]);
  return (
    <Card title="Business settings">
      <ActionForm action={saveSettings} reset={false}>
        {(data ?? []).filter((s) => s.key !== "currency" && s.label !== "Not used anymore").map((s) => (
          <Field key={s.key} label={s.label || s.key}>
            {s.key === "ethanol_material_id" ? (
              <select name={`s_${s.key}`} defaultValue={String(s.value)} className="input">
                {(materials ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : (
              <input name={`s_${s.key}`} defaultValue={String(s.value)} className="input" />
            )}
          </Field>
        ))}
        <SubmitButton>Save settings</SubmitButton>
      </ActionForm>
    </Card>
  );
}

function RoleForm({ r }: { r?: Role }) {
  return (
  <ActionForm action={saveRole} reset={!r} className="space-y-2 rounded-xl border border-gray-200 p-3">
    {r && <input type="hidden" name="id" value={r.id} />}
    <div className="flex items-center gap-2">
      <input name="name" defaultValue={r?.name} className="input" placeholder="Role name, e.g. Shop seller" required />
      {r?.is_admin && <Badge tone="green">admin</Badge>}
    </div>
    {r?.is_admin ? (
      <p className="text-xs text-gray-500">Admin can do everything, including this admin area.</p>
    ) : (
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {PERMS.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name={`perm_${p.key}`} defaultChecked={!!r?.permissions?.[p.key]} /> {p.label}
          </label>
        ))}
      </div>
    )}
    <SubmitButton className="btn-secondary w-full !py-1.5">{r ? "Save role" : "Add role"}</SubmitButton>
  </ActionForm>
  );
}

function ProductForm({ p }: { p?: { [k: string]: unknown } }) {
  return (
  <ActionForm action={saveProduct} reset={!p} className="space-y-2 rounded-xl border border-gray-200 p-3">
    {p && <input type="hidden" name="id" value={String(p.id)} />}
    <div className="grid grid-cols-2 gap-2">
      <Field label="Name"><input name="name" defaultValue={p?.name as string} className="input" required /></Field>
      <Field label="Description"><input name="description" defaultValue={p?.description as string} className="input" /></Field>
      <Field label="Price per carton (TZS)"><input name="price_carton" inputMode="numeric" defaultValue={p ? Number(p.price_carton) : 45000} className="input" /></Field>
      <Field label="Price per bottle (TZS)"><input name="price_bottle" inputMode="numeric" defaultValue={p ? Number(p.price_bottle) : 1500} className="input" /></Field>
      <Field label="Bottles per carton"><input name="bottles_per_carton" inputMode="numeric" defaultValue={(p?.bottles_per_carton as number) ?? 30} className="input" /></Field>
      <Field label="Bottle size (ml)"><input name="bottle_ml" inputMode="numeric" defaultValue={(p?.bottle_ml as number) ?? 200} className="input" /></Field>
      <Field label="Warn when cartons below"><input name="low_stock_cartons" inputMode="numeric" defaultValue={(p?.low_stock_cartons as number) ?? 10} className="input" /></Field>
      <label className="flex items-end gap-2 pb-3 text-sm"><input type="checkbox" name="is_active" defaultChecked={p ? !!p.is_active : true} /> Active (shown for sale)</label>
    </div>
    <SubmitButton className="btn-secondary w-full !py-1.5">{p ? "Save" : "Add product"}</SubmitButton>
  </ActionForm>
  );
}

function MatForm({ m, products }: { m?: { [k: string]: unknown }; products: { id: string; name: string }[] }) {
  return (
  <ActionForm action={saveMaterial} reset={!m} className="space-y-2 rounded-xl border border-gray-200 p-3">
    {m && <input type="hidden" name="id" value={String(m.id)} />}
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <Field label="Name"><input name="name" defaultValue={m?.name as string} className="input" required /></Field>
      <Field label="Unit"><input name="unit" defaultValue={(m?.unit as string) ?? "pcs"} className="input" placeholder="pcs, litre, kg" /></Field>
      <Field label="Cost per unit (TZS)"><input name="unit_cost" inputMode="decimal" defaultValue={m ? Number(m.unit_cost) : 0} className="input" /></Field>
      <Field label="Warn when below"><input name="low_stock_level" inputMode="decimal" defaultValue={m ? Number(m.low_stock_level) : 0} className="input" /></Field>
    </div>
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-2 sm:grid-cols-3">
      <Field label="Used in production">
        <select name="usage" defaultValue={(m?.usage as string) ?? "none"} className="input">
          <option value="none">Not automatically</option>
          <option value="per_bottle">Per bottle made</option>
          <option value="per_carton">Per carton made</option>
          <option value="per_drum">Per ethanol drum used</option>
        </select>
      </Field>
      <Field label={`Amount used (${(m?.unit as string) ?? "unit"})`} hint="e.g. 1 cap per bottle, 0.1 litre flavor per drum">
        <input name="usage_qty" inputMode="decimal" defaultValue={m ? Number(m.usage_qty) : 0} className="input" />
      </Field>
      <Field label="Only for product">
        <select name="product_id" defaultValue={(m?.product_id as string) ?? ""} className="input">
          <option value="">All products</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Field>
    </div>
    <div className="flex items-center justify-between">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={m ? !!m.is_active : true} /> Active</label>
      <SubmitButton className="btn-secondary !py-1.5">{m ? "Save" : "Add item"}</SubmitButton>
    </div>
  </ActionForm>
  );
}
