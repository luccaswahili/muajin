-- Muajin management system: core schema
-- All money values are TZS. Finished-goods stock is tracked in bottles (1 carton = products.bottles_per_carton).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Members, roles, invites
-- ---------------------------------------------------------------------------
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_admin boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role_id uuid references public.roles(id),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.invites (
  email text primary key check (email = lower(email)),
  full_name text not null default '',
  role_id uuid not null references public.roles(id),
  invited_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Permission helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.is_active and p.role_id is not null);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin from profiles p join roles r on r.id = p.role_id
    where p.id = auth.uid() and p.is_active), false);
$$;

create or replace function public.has_perm(perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_admin or coalesce((r.permissions ->> perm)::boolean, false)
    from profiles p join roles r on r.id = p.role_id
    where p.id = auth.uid() and p.is_active), false);
$$;

create or replace function public.require_perm(perm text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(perm) then
    raise exception 'You do not have permission for %', perm using errcode = '42501';
  end if;
end $$;

-- New sign-ups: only invited emails become active members.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv invites%rowtype;
begin
  select * into inv from invites where email = lower(new.email);
  if found then
    insert into profiles (id, email, full_name, role_id, is_active)
    values (new.id, lower(new.email), coalesce(nullif(inv.full_name, ''), new.raw_user_meta_data ->> 'full_name', ''), inv.role_id, true);
    update invites set accepted_at = now() where email = inv.email;
  else
    insert into profiles (id, email, full_name, is_active)
    values (new.id, lower(new.email), coalesce(new.raw_user_meta_data ->> 'full_name', ''), false);
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catalogue and settings (admin managed)
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  label text not null default '',
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  bottle_ml int not null default 200,
  bottles_per_carton int not null default 30 check (bottles_per_carton > 0),
  price_carton numeric(14,2) not null default 0 check (price_carton >= 0),
  price_bottle numeric(14,2) not null default 0 check (price_bottle >= 0),
  low_stock_cartons int not null default 10,
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'pcs',
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  low_stock_level numeric(14,2) not null default 0,
  per_bottle numeric(14,4) not null default 0, -- auto-used per bottle produced (e.g. 1 cap, 1 label)
  per_carton numeric(14,4) not null default 0, -- auto-used per carton produced (e.g. 1 box)
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  sort int not null default 0
);

create table public.owners (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  profile_id uuid references public.profiles(id) on delete set null,
  share_pct numeric(6,3) not null check (share_pct >= 0 and share_pct <= 100),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  location text not null default '',
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.productions (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  product_id uuid not null references public.products(id),
  drums_used numeric(8,2) not null default 0 check (drums_used >= 0),
  ethanol_litres numeric(10,2) not null default 0 check (ethanol_litres >= 0),
  cartons_produced int not null default 0 check (cartons_produced >= 0),
  loose_bottles int not null default 0 check (loose_bottles >= 0),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid not null references public.products(id),
  cartons int not null default 0 check (cartons >= 0),
  bottles int not null default 0 check (bottles >= 0),
  price_carton numeric(14,2) not null default 0,
  price_bottle numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0 check (discount >= 0),
  total numeric(14,2) not null check (total >= 0),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (cartons > 0 or bottles > 0)
);

create table public.deposits (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  deposited_by uuid not null references public.profiles(id) default auth.uid(),
  reference text not null default '',
  notes text not null default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- Money received. method = cash / mobile_money stays "in hand" of received_by until deposited; bank goes straight to the bank.
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  sale_id uuid references public.sales(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  method text not null default 'cash' check (method in ('cash', 'mobile_money', 'bank')),
  received_by uuid not null references public.profiles(id) default auth.uid(),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  category_id uuid not null references public.expense_categories(id),
  amount numeric(14,2) not null check (amount > 0),
  description text not null default '',
  paid_from text not null default 'cash' check (paid_from in ('cash', 'bank')),
  paid_by uuid not null references public.profiles(id) default auth.uid(),
  production_id uuid references public.productions(id) on delete set null,
  material_id uuid references public.materials(id),
  material_qty numeric(14,2),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.owner_withdrawals (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  owner_id uuid not null references public.owners(id),
  amount numeric(14,2) not null check (amount > 0),
  paid_from text not null default 'bank' check (paid_from in ('cash', 'bank')),
  paid_by uuid not null references public.profiles(id) default auth.uid(),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Hand cash from one member to another (e.g. Sergio gives Hans money to deposit).
create table public.cash_transfers (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  from_profile uuid not null references public.profiles(id),
  to_profile uuid not null references public.profiles(id),
  amount numeric(14,2) not null check (amount > 0),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_profile <> to_profile)
);

-- Finished goods movements, in bottles (+ in, - out)
create table public.product_movements (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  product_id uuid not null references public.products(id),
  bottles int not null check (bottles <> 0),
  reason text not null check (reason in ('production', 'sale', 'opening', 'adjustment', 'sample', 'breakage', 'return')),
  production_id uuid references public.productions(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete cascade,
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Raw material movements (+ in, - out), valued at unit_cost at the time
create table public.material_movements (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  material_id uuid not null references public.materials(id),
  qty numeric(14,2) not null check (qty <> 0),
  unit_cost numeric(14,2) not null default 0,
  reason text not null check (reason in ('purchase', 'production', 'opening', 'adjustment', 'damage')),
  production_id uuid references public.productions(id) on delete cascade,
  expense_id uuid references public.expenses(id) on delete cascade,
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index on public.sales (date);
create index on public.sales (customer_id);
create index on public.payments (sale_id);
create index on public.payments (customer_id);
create index on public.payments (received_by);
create index on public.expenses (date);
create index on public.expenses (production_id);
create index on public.product_movements (product_id);
create index on public.material_movements (material_id);
create index on public.deposits (deposited_by);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  action text not null,
  row_id text,
  old_data jsonb,
  new_data jsonb
);
create index on public.audit_log (at desc);

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (user_id, table_name, action, row_id, old_data, new_data)
  values (
    auth.uid(), tg_table_name, lower(tg_op),
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'key',
             (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'email'),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['roles','profiles','invites','settings','products','materials','expense_categories','owners',
    'customers','productions','sales','deposits','payments','expenses','owner_withdrawals','cash_transfers']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['roles','profiles','invites','settings','products','materials','expense_categories','owners',
    'customers','productions','sales','deposits','payments','expenses','owner_withdrawals','cash_transfers',
    'product_movements','material_movements','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Everyone who is an active member can read business data.
do $$
declare t text;
begin
  foreach t in array array['roles','settings','products','materials','expense_categories','owners',
    'customers','productions','sales','deposits','payments','expenses','owner_withdrawals','cash_transfers',
    'product_movements','material_movements']
  loop
    execute format('create policy "members read" on public.%I for select to authenticated using (public.is_member())', t);
  end loop;
end $$;

-- Admin-managed tables
do $$
declare t text;
begin
  foreach t in array array['roles','invites','settings','products','materials','expense_categories','owners']
  loop
    execute format('create policy "admin write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

create policy "admin read invites" on public.invites for select to authenticated using (public.is_admin());

create policy "read profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_member());
create policy "admin manage profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "read audit" on public.audit_log for select to authenticated using (public.has_perm('activity'));

-- Customers can be managed by anyone who sells
create policy "sellers write customers" on public.customers for insert to authenticated with check (public.has_perm('sales') or public.has_perm('customers'));
create policy "sellers update customers" on public.customers for update to authenticated using (public.has_perm('sales') or public.has_perm('customers'));
create policy "delete customers" on public.customers for delete to authenticated using (public.has_perm('customers'));

-- Transactional tables: inserts go through functions below; deletes allowed with the module permission (logged).
create policy "delete sales" on public.sales for delete to authenticated using (public.has_perm('sales'));
create policy "update sales notes" on public.sales for update to authenticated using (public.has_perm('sales')) with check (public.has_perm('sales'));
create policy "delete payments" on public.payments for delete to authenticated using (public.has_perm('sales'));
create policy "delete productions" on public.productions for delete to authenticated using (public.has_perm('production'));
create policy "update productions" on public.productions for update to authenticated using (public.has_perm('production')) with check (public.has_perm('production'));
create policy "delete expenses" on public.expenses for delete to authenticated using (public.has_perm('expenses'));
create policy "update expenses" on public.expenses for update to authenticated using (public.has_perm('expenses')) with check (public.has_perm('expenses'));
create policy "delete deposits" on public.deposits for delete to authenticated using (public.has_perm('bank') and status = 'pending');
create policy "delete withdrawals" on public.owner_withdrawals for delete to authenticated using (public.is_admin());
create policy "delete transfers" on public.cash_transfers for delete to authenticated using (public.has_perm('bank'));
create policy "delete product movements" on public.product_movements for delete to authenticated using (public.has_perm('stock') and reason not in ('sale', 'production'));
create policy "delete material movements" on public.material_movements for delete to authenticated using (public.has_perm('stock') and reason not in ('production', 'purchase'));

-- ---------------------------------------------------------------------------
-- Stock & money views (security invoker, so RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_product_stock with (security_invoker = true) as
select p.id as product_id, p.name, p.bottles_per_carton, p.price_carton, p.price_bottle, p.low_stock_cartons, p.is_active, p.sort,
  coalesce(sum(m.bottles), 0)::int as bottles,
  (coalesce(sum(m.bottles), 0) / p.bottles_per_carton)::int as cartons,
  (coalesce(sum(m.bottles), 0) % p.bottles_per_carton)::int as loose_bottles
from products p left join product_movements m on m.product_id = p.id
group by p.id;

create view public.v_material_stock with (security_invoker = true) as
select mt.id as material_id, mt.name, mt.unit, mt.unit_cost, mt.low_stock_level, mt.is_active, mt.sort, mt.per_bottle, mt.per_carton,
  coalesce(sum(m.qty), 0) as qty
from materials mt left join material_movements m on m.material_id = mt.id
group by mt.id;

create view public.v_sales with (security_invoker = true) as
select s.*, p.name as product_name, p.bottles_per_carton, c.name as customer_name, c.phone as customer_phone,
  pr.full_name as created_by_name,
  coalesce((select sum(amount) from payments py where py.sale_id = s.id), 0) as paid,
  s.total - coalesce((select sum(amount) from payments py where py.sale_id = s.id), 0) as balance
from sales s
join products p on p.id = s.product_id
left join customers c on c.id = s.customer_id
left join profiles pr on pr.id = s.created_by;

create view public.v_customer_balances with (security_invoker = true) as
select c.*,
  coalesce((select sum(total) from sales s where s.customer_id = c.id), 0) as total_bought,
  coalesce((select sum(amount) from payments p where p.customer_id = c.id), 0) as total_paid,
  coalesce((select sum(total) from sales s where s.customer_id = c.id), 0)
    - coalesce((select sum(amount) from payments p where p.customer_id = c.id), 0) as balance,
  (select max(date) from sales s where s.customer_id = c.id) as last_purchase
from customers c;

-- Money currently held by each member (cash + mobile money not yet deposited)
create view public.v_cash_holders with (security_invoker = true) as
select pr.id as profile_id, pr.full_name, pr.email,
  coalesce((select sum(amount) from payments p where p.received_by = pr.id and p.method <> 'bank'), 0)
  + coalesce((select sum(amount) from cash_transfers t where t.to_profile = pr.id), 0)
  - coalesce((select sum(amount) from cash_transfers t where t.from_profile = pr.id), 0)
  - coalesce((select sum(amount) from deposits d where d.deposited_by = pr.id and d.status <> 'rejected'), 0)
  - coalesce((select sum(amount) from expenses e where e.paid_by = pr.id and e.paid_from = 'cash'), 0)
  - coalesce((select sum(amount) from owner_withdrawals w where w.paid_by = pr.id and w.paid_from = 'cash'), 0)
  as cash_in_hand
from profiles pr
where pr.role_id is not null;

create view public.v_finance_summary with (security_invoker = true) as
select
  coalesce((select sum(amount) from deposits where status = 'confirmed'), 0)
  + coalesce((select sum(amount) from payments where method = 'bank'), 0)
  - coalesce((select sum(amount) from expenses where paid_from = 'bank'), 0)
  - coalesce((select sum(amount) from owner_withdrawals where paid_from = 'bank'), 0)
  + coalesce((select (value #>> '{}')::numeric from settings where key = 'bank_opening_balance'), 0)
  as bank_balance,
  coalesce((select sum(cash_in_hand) from v_cash_holders), 0) as cash_in_hand,
  coalesce((select sum(amount) from deposits where status = 'pending'), 0) as pending_deposits,
  coalesce((select count(*) from deposits where status = 'pending'), 0) as pending_deposit_count,
  coalesce((select sum(balance) from v_sales where balance > 0), 0) as receivables;

-- Cost of each production batch: materials consumed + expenses linked to it
create view public.v_production_costs with (security_invoker = true) as
select pd.*, p.name as product_name, p.bottles_per_carton, p.price_carton, pr.full_name as created_by_name,
  coalesce((select sum(-m.qty * m.unit_cost) from material_movements m where m.production_id = pd.id), 0) as material_cost,
  coalesce((select sum(e.amount) from expenses e where e.production_id = pd.id), 0) as other_cost,
  coalesce((select sum(-m.qty * m.unit_cost) from material_movements m where m.production_id = pd.id), 0)
    + coalesce((select sum(e.amount) from expenses e where e.production_id = pd.id), 0) as total_cost,
  case when pd.cartons_produced + pd.loose_bottles::numeric / p.bottles_per_carton > 0 then
    (coalesce((select sum(-m.qty * m.unit_cost) from material_movements m where m.production_id = pd.id), 0)
      + coalesce((select sum(e.amount) from expenses e where e.production_id = pd.id), 0))
    / (pd.cartons_produced + pd.loose_bottles::numeric / p.bottles_per_carton)
  end as cost_per_carton,
  case when pd.drums_used > 0 then (pd.cartons_produced + pd.loose_bottles::numeric / p.bottles_per_carton) / pd.drums_used end as cartons_per_drum
from productions pd
join products p on p.id = pd.product_id
left join profiles pr on pr.id = pd.created_by;

create view public.v_expenses with (security_invoker = true) as
select e.*, c.name as category_name, pb.full_name as paid_by_name, m.name as material_name, m.unit as material_unit
from expenses e
join expense_categories c on c.id = e.category_id
left join profiles pb on pb.id = e.paid_by
left join materials m on m.id = e.material_id;

create view public.v_deposits with (security_invoker = true) as
select d.*, a.full_name as deposited_by_name, b.full_name as confirmed_by_name
from deposits d
left join profiles a on a.id = d.deposited_by
left join profiles b on b.id = d.confirmed_by;

-- Monthly profit & loss (cash basis on expenses)
create view public.v_monthly with (security_invoker = true) as
with months as (
  select date_trunc('month', date)::date as month from sales
  union select date_trunc('month', date)::date from expenses
  union select date_trunc('month', date)::date from productions
)
select m.month,
  coalesce((select sum(total) from sales s where date_trunc('month', s.date) = m.month), 0) as sales_total,
  coalesce((select sum(cartons) from sales s where date_trunc('month', s.date) = m.month), 0) as cartons_sold,
  coalesce((select sum(bottles) from sales s where date_trunc('month', s.date) = m.month), 0) as bottles_sold,
  coalesce((select sum(amount) from payments p where date_trunc('month', p.date) = m.month), 0) as cash_collected,
  coalesce((select sum(amount) from expenses e where date_trunc('month', e.date) = m.month), 0) as expenses_total,
  coalesce((select sum(cartons_produced) from productions pd where date_trunc('month', pd.date) = m.month), 0) as cartons_produced,
  coalesce((select sum(drums_used) from productions pd where date_trunc('month', pd.date) = m.month), 0) as drums_used,
  coalesce((select sum(total) from sales s where date_trunc('month', s.date) = m.month), 0)
    - coalesce((select sum(amount) from expenses e where date_trunc('month', e.date) = m.month), 0) as profit
from months m;

create view public.v_audit with (security_invoker = true) as
select a.*, p.full_name as user_name from audit_log a left join profiles p on p.id = a.user_id;

-- ---------------------------------------------------------------------------
-- Business functions (atomic, permission-checked)
-- ---------------------------------------------------------------------------
create or replace function public.record_sale(
  p_product_id uuid, p_cartons int, p_bottles int,
  p_price_carton numeric default null, p_price_bottle numeric default null,
  p_customer_id uuid default null, p_new_customer_name text default null, p_new_customer_phone text default null,
  p_amount_paid numeric default 0, p_method text default 'cash', p_discount numeric default 0,
  p_date date default current_date, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  v_customer uuid := p_customer_id;
  v_sale uuid;
  v_total numeric;
  v_need int;
  v_have int;
begin
  perform require_perm('sales');
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  p_cartons := coalesce(p_cartons, 0); p_bottles := coalesce(p_bottles, 0);
  if p_cartons < 0 or p_bottles < 0 or (p_cartons = 0 and p_bottles = 0) then
    raise exception 'Enter cartons or bottles to sell';
  end if;

  v_need := p_cartons * prod.bottles_per_carton + p_bottles;
  select coalesce(sum(bottles), 0) into v_have from product_movements where product_id = p_product_id;
  if v_need > v_have then
    raise exception 'Not enough stock: only % cartons and % bottles of % left',
      v_have / prod.bottles_per_carton, v_have % prod.bottles_per_carton, prod.name;
  end if;

  if v_customer is null and coalesce(trim(p_new_customer_name), '') <> '' then
    insert into customers (name, phone) values (trim(p_new_customer_name), coalesce(trim(p_new_customer_phone), ''))
    returning id into v_customer;
  end if;

  v_total := p_cartons * coalesce(p_price_carton, prod.price_carton)
           + p_bottles * coalesce(p_price_bottle, prod.price_bottle)
           - coalesce(p_discount, 0);
  if v_total < 0 then raise exception 'Discount is larger than the sale'; end if;
  if coalesce(p_amount_paid, 0) > v_total then raise exception 'Amount paid is more than the sale total'; end if;
  if coalesce(p_amount_paid, 0) < v_total and v_customer is null then
    raise exception 'Choose or add a customer for a sale that is not fully paid';
  end if;

  insert into sales (date, customer_id, product_id, cartons, bottles, price_carton, price_bottle, discount, total, notes)
  values (p_date, v_customer, p_product_id, p_cartons, p_bottles,
          coalesce(p_price_carton, prod.price_carton), coalesce(p_price_bottle, prod.price_bottle),
          coalesce(p_discount, 0), v_total, coalesce(p_notes, ''))
  returning id into v_sale;

  insert into product_movements (date, product_id, bottles, reason, sale_id)
  values (p_date, p_product_id, -v_need, 'sale', v_sale);

  if coalesce(p_amount_paid, 0) > 0 then
    insert into payments (date, sale_id, customer_id, amount, method)
    values (p_date, v_sale, v_customer, p_amount_paid, coalesce(p_method, 'cash'));
  end if;
  return v_sale;
end $$;

-- Payment toward a customer's debt. Applied to their oldest unpaid sales first.
create or replace function public.record_customer_payment(
  p_customer_id uuid, p_amount numeric, p_method text default 'cash', p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_left numeric := p_amount;
  v_part numeric;
begin
  perform require_perm('sales');
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than 0'; end if;
  if p_amount > (select balance from v_customer_balances where id = p_customer_id) then
    raise exception 'Amount is more than what the customer owes';
  end if;
  for r in select id, balance from v_sales where customer_id = p_customer_id and balance > 0 order by date, created_at loop
    exit when v_left <= 0;
    v_part := least(v_left, r.balance);
    insert into payments (date, sale_id, customer_id, amount, method, notes)
    values (p_date, r.id, p_customer_id, v_part, coalesce(p_method, 'cash'), coalesce(p_notes, ''));
    v_left := v_left - v_part;
  end loop;
end $$;

create or replace function public.record_production(
  p_product_id uuid, p_drums numeric, p_cartons int, p_loose_bottles int default 0,
  p_date date default current_date, p_notes text default '',
  p_use_materials boolean default true, p_flavor_material_id uuid default null,
  p_labour_cost numeric default 0, p_labour_paid_from text default 'cash'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  v_id uuid;
  v_litres numeric;
  v_bottles int;
  v_flavor_l numeric;
  v_ethanol uuid;
  m record;
  v_cat uuid;
begin
  perform require_perm('production');
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if coalesce(p_cartons, 0) <= 0 and coalesce(p_loose_bottles, 0) <= 0 then
    raise exception 'Enter how many cartons were produced';
  end if;
  v_litres := coalesce(p_drums, 0) * coalesce((select (value #>> '{}')::numeric from settings where key = 'drum_litres'), 250);
  v_bottles := coalesce(p_cartons, 0) * prod.bottles_per_carton + coalesce(p_loose_bottles, 0);

  insert into productions (date, product_id, drums_used, ethanol_litres, cartons_produced, loose_bottles, notes)
  values (p_date, p_product_id, coalesce(p_drums, 0), v_litres, coalesce(p_cartons, 0), coalesce(p_loose_bottles, 0), coalesce(p_notes, ''))
  returning id into v_id;

  insert into product_movements (date, product_id, bottles, reason, production_id)
  values (p_date, p_product_id, v_bottles, 'production', v_id);

  if p_use_materials then
    select (value #>> '{}')::uuid into v_ethanol from settings where key = 'ethanol_material_id';
    if v_ethanol is not null and v_litres > 0 then
      insert into material_movements (date, material_id, qty, unit_cost, reason, production_id)
      select p_date, id, -v_litres, unit_cost, 'production', v_id from materials where id = v_ethanol;
    end if;
    if p_flavor_material_id is not null then
      -- flavor % of total liquid (bottles * ml)
      v_flavor_l := round(v_bottles * prod.bottle_ml / 1000.0
        * coalesce((select (value #>> '{}')::numeric from settings where key = 'flavor_pct'), 0.5) / 100, 2);
      if v_flavor_l > 0 then
        insert into material_movements (date, material_id, qty, unit_cost, reason, production_id)
        select p_date, id, -v_flavor_l, unit_cost, 'production', v_id from materials where id = p_flavor_material_id;
      end if;
    end if;
    for m in select * from materials where is_active and (per_bottle > 0 or per_carton > 0) loop
      insert into material_movements (date, material_id, qty, unit_cost, reason, production_id)
      values (p_date, m.id, -(v_bottles * m.per_bottle + coalesce(p_cartons, 0) * m.per_carton), m.unit_cost, 'production', v_id);
    end loop;
  end if;

  if coalesce(p_labour_cost, 0) > 0 then
    select id into v_cat from expense_categories where name = 'Temporary workers';
    if v_cat is null then
      insert into expense_categories (name) values ('Temporary workers') returning id into v_cat;
    end if;
    insert into expenses (date, category_id, amount, description, paid_from, production_id)
    values (p_date, v_cat, p_labour_cost, 'Production workers', coalesce(p_labour_paid_from, 'cash'), v_id);
  end if;
  return v_id;
end $$;

create or replace function public.record_expense(
  p_category_id uuid, p_amount numeric, p_description text default '', p_paid_from text default 'cash',
  p_date date default current_date, p_production_id uuid default null,
  p_material_id uuid default null, p_material_qty numeric default null, p_update_unit_cost boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_perm('expenses');
  insert into expenses (date, category_id, amount, description, paid_from, production_id, material_id, material_qty)
  values (p_date, p_category_id, p_amount, coalesce(p_description, ''), coalesce(p_paid_from, 'cash'), p_production_id,
          p_material_id, case when p_material_id is not null then p_material_qty end)
  returning id into v_id;
  if p_material_id is not null and coalesce(p_material_qty, 0) > 0 then
    insert into material_movements (date, material_id, qty, unit_cost, reason, expense_id)
    values (p_date, p_material_id, p_material_qty, round(p_amount / p_material_qty, 2), 'purchase', v_id);
    if p_update_unit_cost then
      update materials set unit_cost = round(p_amount / p_material_qty, 2) where id = p_material_id;
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.record_deposit(
  p_amount numeric, p_reference text default '', p_date date default current_date, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform require_perm('bank');
  insert into deposits (date, amount, reference, notes) values (p_date, p_amount, coalesce(p_reference, ''), coalesce(p_notes, ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_deposit(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare d deposits%rowtype;
begin
  perform require_perm('bank');
  select * into d from deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status <> 'pending' then raise exception 'This deposit was already %', d.status; end if;
  if d.deposited_by = auth.uid() and not is_admin() then
    raise exception 'Someone else must confirm your own deposit';
  end if;
  update deposits set status = case when p_approve then 'confirmed' else 'rejected' end,
    confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_id;
end $$;

create or replace function public.record_cash_transfer(
  p_to uuid, p_amount numeric, p_from uuid default null, p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('bank');
  insert into cash_transfers (date, from_profile, to_profile, amount, notes)
  values (p_date, coalesce(p_from, auth.uid()), p_to, p_amount, coalesce(p_notes, ''));
end $$;

create or replace function public.adjust_product_stock(
  p_product_id uuid, p_bottles int, p_reason text, p_notes text default '', p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('stock');
  if p_reason not in ('opening', 'adjustment', 'sample', 'breakage', 'return') then raise exception 'Invalid reason'; end if;
  insert into product_movements (date, product_id, bottles, reason, notes)
  values (p_date, p_product_id, case when p_reason in ('sample', 'breakage') then -abs(p_bottles) else p_bottles end, p_reason, coalesce(p_notes, ''));
end $$;

create or replace function public.adjust_material_stock(
  p_material_id uuid, p_qty numeric, p_reason text, p_notes text default '', p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform require_perm('stock');
  if p_reason not in ('opening', 'adjustment', 'damage') then raise exception 'Invalid reason'; end if;
  insert into material_movements (date, material_id, qty, unit_cost, reason, notes)
  select p_date, id, case when p_reason = 'damage' then -abs(p_qty) else p_qty end, unit_cost, p_reason, coalesce(p_notes, '')
  from materials where id = p_material_id;
end $$;

create or replace function public.record_withdrawal(
  p_owner_id uuid, p_amount numeric, p_paid_from text default 'bank', p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the admin can record owner withdrawals' using errcode = '42501'; end if;
  insert into owner_withdrawals (date, owner_id, amount, paid_from, notes)
  values (p_date, p_owner_id, p_amount, coalesce(p_paid_from, 'bank'), coalesce(p_notes, ''));
end $$;

create or replace function public.update_my_name(p_name text) returns void
language sql security definer set search_path = public as $$
  update profiles set full_name = trim(p_name) where id = auth.uid();
$$;

-- Lock down: only signed-in users may call functions
do $$
declare f text;
begin
  foreach f in array array['record_sale(uuid,int,int,numeric,numeric,uuid,text,text,numeric,text,numeric,date,text)',
    'record_customer_payment(uuid,numeric,text,date,text)',
    'record_production(uuid,numeric,int,int,date,text,boolean,uuid,numeric,text)',
    'record_expense(uuid,numeric,text,text,date,uuid,uuid,numeric,boolean)',
    'record_deposit(numeric,text,date,text)', 'review_deposit(uuid,boolean)',
    'record_cash_transfer(uuid,numeric,uuid,date,text)',
    'adjust_product_stock(uuid,int,text,text,date)', 'adjust_material_stock(uuid,numeric,text,text,date)',
    'record_withdrawal(uuid,numeric,text,date,text)', 'update_my_name(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.audit_trigger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------
insert into public.roles (name, is_admin, permissions) values
  ('Admin', true, '{"sales":true,"production":true,"expenses":true,"bank":true,"customers":true,"stock":true,"reports":true,"activity":true}'),
  ('Owner', false, '{"sales":true,"production":true,"expenses":true,"bank":true,"customers":true,"stock":true,"reports":true,"activity":true}'),
  ('Sales staff', false, '{"sales":true,"customers":true}');

insert into public.invites (email, full_name, role_id)
select 'rocatz21@gmail.com', 'Luca', id from public.roles where name = 'Admin';

insert into public.products (name, description, price_carton, price_bottle, sort) values
  ('Muajin Dry Gin', '200ml plastic bottle, 30 per carton', 45000, 1500, 1),
  ('Muajin Coffee', 'Coffee flavoured gin, 200ml, 30 per carton', 45000, 1500, 2);

insert into public.materials (name, unit, unit_cost, low_stock_level, per_bottle, per_carton, sort) values
  ('Ethanol', 'litre', 10400, 250, 0, 0, 1),
  ('Dry gin flavor', 'litre', 0, 1, 0, 0, 2),
  ('Coffee flavor', 'litre', 0, 1, 0, 0, 3),
  ('Empty bottles 200ml', 'pcs', 0, 3000, 1, 0, 4),
  ('Bottle caps', 'pcs', 0, 3000, 1, 0, 5),
  ('Labels', 'pcs', 0, 3000, 1, 0, 6),
  ('Carton boxes', 'pcs', 0, 100, 0, 1, 7);

insert into public.expense_categories (name, sort) values
  ('Ethanol', 1), ('Flavor', 2), ('Bottles & caps', 3), ('Labels', 4), ('Carton boxes', 5),
  ('Transport', 6), ('Temporary workers', 7), ('Rent', 8), ('Electricity & water', 9),
  ('Licenses & tax', 10), ('Marketing', 11), ('Other', 99);

insert into public.owners (name, share_pct) values ('Luca', 33.334), ('Sergio', 33.333), ('Hans Kanner', 33.333);

insert into public.settings (key, value, label) values
  ('company_name', '"Muajin"', 'Company name'),
  ('currency', '"TZS"', 'Currency'),
  ('drum_litres', '250', 'Litres of ethanol per drum'),
  ('drum_price', '2600000', 'Price of one ethanol drum (TZS)'),
  ('expected_cartons_per_drum', '105', 'Expected cartons from one drum'),
  ('ethanol_pct', '38', 'Ethanol % in the mix'),
  ('flavor_pct', '0.5', 'Flavor % in the mix'),
  ('bank_name', '"Muajin official account"', 'Bank account name'),
  ('bank_opening_balance', '0', 'Bank opening balance (TZS)');

insert into public.settings (key, value, label)
select 'ethanol_material_id', to_jsonb(id::text), 'Material used as ethanol' from public.materials where name = 'Ethanol';
