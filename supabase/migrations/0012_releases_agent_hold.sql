-- Releases: gin leaving the warehouse is either a sale or an "agent take".
-- Goods an agent takes sit in their "agent hold" until they sell or return them.

alter table public.sales add column if not exists agent_id uuid references public.profiles(id);
alter table public.product_movements add column if not exists agent_id uuid references public.profiles(id);

-- Agent hold ledger, in bottles (+ taken from the warehouse, - sold or returned)
create table if not exists public.agent_stock (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  agent_id uuid not null references public.profiles(id),
  product_id uuid not null references public.products(id),
  bottles int not null check (bottles <> 0),
  reason text not null check (reason in ('take', 'sale', 'return')),
  sale_id uuid references public.sales(id) on delete cascade,
  movement_id uuid references public.product_movements(id) on delete cascade,
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists agent_stock_agent_idx on public.agent_stock (agent_id, product_id);
alter table public.agent_stock enable row level security;
create policy "members read" on public.agent_stock for select to authenticated
  using (public.is_member() and (not public.is_agent() or agent_id = auth.uid()));
create trigger audit_agent_stock after insert or update or delete on public.agent_stock
  for each row execute function public.audit_trigger();

create or replace view public.v_agent_hold with (security_invoker = true) as
select a.agent_id, pr.full_name as agent_name, a.product_id, p.name as product_name, p.bottles_per_carton, p.sort,
  sum(a.bottles)::int as bottles,
  (sum(a.bottles) / p.bottles_per_carton)::int as cartons,
  (sum(a.bottles) % p.bottles_per_carton)::int as loose_bottles
from agent_stock a join products p on p.id = a.product_id join profiles pr on pr.id = a.agent_id
group by a.agent_id, pr.full_name, a.product_id, p.name, p.bottles_per_carton, p.sort
having sum(a.bottles) <> 0;

-- Agents see sales sold from their hold too (also when the admin recorded it for them)
alter policy "members read" on public.sales using (
  public.is_member() and (not public.is_agent() or created_by = auth.uid() or agent_id = auth.uid()));
alter policy "members read" on public.payments using (
  public.is_member() and (not public.is_agent()
    or exists (select 1 from public.sales s where s.id = payments.sale_id and (s.created_by = auth.uid() or s.agent_id = auth.uid()))));
-- Agent take/return movements are undone only by deleting through the hold, never on their own
alter policy "delete product movements" on public.product_movements using (
  public.is_admin() and reason <> all (array['sale', 'production']) and agent_id is null);

-- Sales list: who sold it (the agent for hold sales, otherwise who recorded it)
create or replace view public.v_sales with (security_invoker = true) as
select s.id, s.date, s.customer_id, s.product_id, s.cartons, s.bottles, s.price_carton, s.price_bottle, s.discount, s.total,
  s.notes, s.created_by, s.created_at, p.name as product_name, p.bottles_per_carton, c.name as customer_name,
  c.phone as customer_phone, pr.full_name as created_by_name,
  coalesce((select sum(py.amount) from payments py where py.sale_id = s.id), 0::numeric) as paid,
  s.total - coalesce((select sum(py.amount) from payments py where py.sale_id = s.id), 0::numeric) as balance,
  s.agent_id, coalesce(s.agent_id, s.created_by) as seller_id, coalesce(ag.full_name, pr.full_name) as seller_name
from sales s
  join products p on p.id = s.product_id
  left join customers c on c.id = s.customer_id
  left join profiles pr on pr.id = s.created_by
  left join profiles ag on ag.id = s.agent_id;

-- Release goods to an agent (owners)
create or replace function public.release_to_agent(
  p_agent uuid, p_product_id uuid, p_cartons int, p_bottles int, p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  v_name text;
  v_need int;
  v_have int;
  v_mov uuid;
begin
  perform require_perm('sales');
  if is_agent() then raise exception 'Only the owners can release stock to an agent'; end if;
  select pr.full_name into v_name from profiles pr join roles r on r.id = pr.role_id
  where pr.id = p_agent and pr.is_active and r.is_agent;
  if v_name is null then raise exception 'Choose a sales agent'; end if;
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  v_need := coalesce(p_cartons, 0) * prod.bottles_per_carton + coalesce(p_bottles, 0);
  if coalesce(p_cartons, 0) < 0 or coalesce(p_bottles, 0) < 0 or v_need = 0 then raise exception 'Enter cartons or bottles to release'; end if;
  select coalesce(sum(bottles), 0) into v_have from product_movements where product_id = p_product_id;
  if v_need > v_have then
    raise exception 'Not enough stock: only % cartons and % bottles of % left', v_have / prod.bottles_per_carton, v_have % prod.bottles_per_carton, prod.name;
  end if;
  insert into product_movements (date, product_id, bottles, reason, agent_id, notes)
  values (coalesce(p_date, current_date), p_product_id, -v_need, 'adjustment', p_agent,
          trim(format('Released to %s. %s', v_name, coalesce(p_notes, ''))))
  returning id into v_mov;
  insert into agent_stock (date, agent_id, product_id, bottles, reason, movement_id, notes)
  values (coalesce(p_date, current_date), p_agent, p_product_id, v_need, 'take', v_mov, coalesce(p_notes, ''));
end $$;
revoke execute on function public.release_to_agent(uuid, uuid, int, int, date, text) from public, anon;
grant execute on function public.release_to_agent(uuid, uuid, int, int, date, text) to authenticated;

-- Agent brings unsold goods back to the warehouse (owners)
create or replace function public.return_from_agent(
  p_agent uuid, p_product_id uuid, p_cartons int, p_bottles int, p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  v_name text;
  v_qty int;
  v_hold int;
  v_mov uuid;
begin
  perform require_perm('sales');
  if is_agent() then raise exception 'Only the owners can record a return'; end if;
  select full_name into v_name from profiles where id = p_agent;
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  v_qty := coalesce(p_cartons, 0) * prod.bottles_per_carton + coalesce(p_bottles, 0);
  if coalesce(p_cartons, 0) < 0 or coalesce(p_bottles, 0) < 0 or v_qty = 0 then raise exception 'Enter cartons or bottles returned'; end if;
  select coalesce(sum(bottles), 0) into v_hold from agent_stock where agent_id = p_agent and product_id = p_product_id;
  if v_qty > v_hold then
    raise exception '% only holds % cartons and % bottles of %', v_name, v_hold / prod.bottles_per_carton, v_hold % prod.bottles_per_carton, prod.name;
  end if;
  insert into product_movements (date, product_id, bottles, reason, agent_id, notes)
  values (coalesce(p_date, current_date), p_product_id, v_qty, 'return', p_agent,
          trim(format('Returned by %s. %s', v_name, coalesce(p_notes, ''))))
  returning id into v_mov;
  insert into agent_stock (date, agent_id, product_id, bottles, reason, movement_id, notes)
  values (coalesce(p_date, current_date), p_agent, p_product_id, -v_qty, 'return', v_mov, coalesce(p_notes, ''));
end $$;
revoke execute on function public.return_from_agent(uuid, uuid, int, int, date, text) from public, anon;
grant execute on function public.return_from_agent(uuid, uuid, int, int, date, text) to authenticated;

-- Sales: from the warehouse, or from an agent's hold (only that agent or the admin)
create or replace function public.record_sale(
  p_product_id uuid, p_cartons int, p_bottles int, p_price_carton numeric, p_price_bottle numeric,
  p_customer_id uuid, p_new_customer_name text, p_new_customer_phone text, p_amount_paid numeric,
  p_method text, p_discount numeric, p_date date, p_notes text, p_from_agent uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  prod products%rowtype;
  v_customer uuid := p_customer_id;
  v_agent uuid := p_from_agent;
  v_sale uuid;
  v_total numeric;
  v_need int;
  v_have int;
begin
  perform require_perm('sales');
  if is_agent() then
    v_agent := coalesce(v_agent, auth.uid());
    if v_agent <> auth.uid() then raise exception 'You can only sell from your own stock'; end if;
  end if;
  if v_agent is not null and v_agent <> auth.uid() and not is_admin() then
    raise exception 'Only that agent or the admin can sell from an agent''s stock';
  end if;
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  p_cartons := coalesce(p_cartons, 0); p_bottles := coalesce(p_bottles, 0);
  if p_cartons < 0 or p_bottles < 0 or (p_cartons = 0 and p_bottles = 0) then
    raise exception 'Enter cartons or bottles to sell';
  end if;

  v_need := p_cartons * prod.bottles_per_carton + p_bottles;
  if v_agent is null then
    select coalesce(sum(bottles), 0) into v_have from product_movements where product_id = p_product_id;
  else
    select coalesce(sum(bottles), 0) into v_have from agent_stock where agent_id = v_agent and product_id = p_product_id;
  end if;
  if v_need > v_have then
    raise exception 'Not enough stock%: only % cartons and % bottles of % left',
      case when v_agent is null then '' when v_agent = auth.uid() then ' with you' else ' with this agent' end,
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

  insert into sales (date, customer_id, product_id, cartons, bottles, price_carton, price_bottle, discount, total, notes, agent_id)
  values (p_date, v_customer, p_product_id, p_cartons, p_bottles,
          coalesce(p_price_carton, prod.price_carton), coalesce(p_price_bottle, prod.price_bottle),
          coalesce(p_discount, 0), v_total, coalesce(p_notes, ''), v_agent)
  returning id into v_sale;

  if v_agent is null then
    insert into product_movements (date, product_id, bottles, reason, sale_id)
    values (p_date, p_product_id, -v_need, 'sale', v_sale);
  else
    insert into agent_stock (date, agent_id, product_id, bottles, reason, sale_id)
    values (p_date, v_agent, p_product_id, -v_need, 'sale', v_sale);
  end if;

  -- Money from a hold sale is with the agent
  if coalesce(p_amount_paid, 0) > 0 then
    insert into payments (date, sale_id, customer_id, amount, method, received_by)
    values (p_date, v_sale, v_customer, p_amount_paid, coalesce(p_method, 'cash'), coalesce(v_agent, auth.uid()));
  end if;
  return v_sale;
end $$;
revoke execute on function public.record_sale(uuid, int, int, numeric, numeric, uuid, text, text, numeric, text, numeric, date, text, uuid) from public, anon;
grant execute on function public.record_sale(uuid, int, int, numeric, numeric, uuid, text, text, numeric, text, numeric, date, text, uuid) to authenticated;

-- The old version (no stock source) is retired; it keeps its defaults so it can be replaced
create or replace function public.record_sale(
  p_product_id uuid, p_cartons int, p_bottles int, p_price_carton numeric default null, p_price_bottle numeric default null,
  p_customer_id uuid default null, p_new_customer_name text default null, p_new_customer_phone text default null,
  p_amount_paid numeric default 0, p_method text default 'cash', p_discount numeric default 0,
  p_date date default current_date, p_notes text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'The app was updated. Please refresh the page and try again.';
end $$;

-- Agent payments: what customers owe on sales from their hold too
create or replace function public.record_customer_payment(
  p_customer_id uuid, p_amount numeric, p_method text default 'cash', p_date date default current_date, p_notes text default ''
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_left numeric := p_amount;
  v_part numeric;
  v_agent boolean := is_agent();
  v_owed numeric;
begin
  perform require_perm('sales');
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be more than 0'; end if;
  select coalesce(sum(balance), 0) into v_owed from v_sales
  where customer_id = p_customer_id and balance > 0 and (not v_agent or seller_id = auth.uid() or created_by = auth.uid());
  if p_amount > v_owed then
    raise exception 'Amount is more than what the customer owes%', case when v_agent then ' you' else '' end;
  end if;
  for r in select id, balance from v_sales
           where customer_id = p_customer_id and balance > 0 and (not v_agent or seller_id = auth.uid() or created_by = auth.uid())
           order by date, created_at loop
    exit when v_left <= 0;
    v_part := least(v_left, r.balance);
    insert into payments (date, sale_id, customer_id, amount, method, notes)
    values (p_date, r.id, p_customer_id, v_part, coalesce(p_method, 'cash'), coalesce(p_notes, ''));
    v_left := v_left - v_part;
  end loop;
end $$;

-- Agent stats count sales from their hold as theirs
create or replace function public.agent_stats(p_from date, p_to date)
returns table (
  profile_id uuid, full_name text, email text, is_active boolean,
  sales_count bigint, cartons bigint, bottles bigint, sales_total numeric,
  credit_given numeric, collected numeric, owed_now numeric, cash_in_hand numeric,
  customers_added bigint, customers_total bigint, customers_on_map bigint, last_sale date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if is_agent() or not has_perm('reports') then
    raise exception 'You do not have permission for reports' using errcode = '42501';
  end if;
  return query
  select p.id, p.full_name, p.email, p.is_active,
    (select count(*) from v_sales s where s.seller_id = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.cartons), 0)::bigint from v_sales s where s.seller_id = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.bottles), 0)::bigint from v_sales s where s.seller_id = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.total), 0) from v_sales s where s.seller_id = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.balance), 0) from v_sales s where s.seller_id = p.id and s.date between p_from and p_to),
    (select coalesce(sum(py.amount), 0) from payments py where py.received_by = p.id and py.date between p_from and p_to),
    (select coalesce(sum(s.balance), 0) from v_sales s where s.seller_id = p.id),
    (select h.cash_in_hand from v_cash_holders h where h.profile_id = p.id),
    (select count(*) from customers c where c.created_by = p.id and c.created_at::date between p_from and p_to),
    (select count(*) from customers c where c.created_by = p.id),
    (select count(*) from customers c where c.created_by = p.id and c.lat is not null),
    (select max(s.date) from v_sales s where s.seller_id = p.id)
  from profiles p join roles r on r.id = p.role_id
  where r.is_agent and not r.is_admin
  order by 8 desc, 2;
end $$;
