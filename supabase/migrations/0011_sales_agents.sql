-- Sales agents: add customers and sales, collect payments on their own sales.
-- They see only their own sales, what customers owe them, and no company finances.
alter table public.roles add column if not exists is_agent boolean not null default false;

create or replace function public.is_agent() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.is_agent and not r.is_admin from profiles p join roles r on r.id = p.role_id
    where p.id = auth.uid() and p.is_active), false);
$$;
revoke execute on function public.is_agent() from public, anon;
grant execute on function public.is_agent() to authenticated;

-- Sales: agents read only their own, and cannot change or delete any
alter policy "members read" on public.sales using (public.is_member() and (not public.is_agent() or created_by = auth.uid()));
alter policy "update sales notes" on public.sales using (public.has_perm('sales') and not public.is_agent()) with check (public.has_perm('sales') and not public.is_agent());
alter policy "delete sales" on public.sales using (public.has_perm('sales') and not public.is_agent());

-- Payments: agents read only payments on their own sales
alter policy "members read" on public.payments using (
  public.is_member() and (not public.is_agent()
    or exists (select 1 from public.sales s where s.id = payments.sale_id and s.created_by = auth.uid())));
alter policy "delete payments" on public.payments using (public.has_perm('sales') and not public.is_agent());

-- Customers: everyone reads all; agents can add but not edit
alter policy "sellers update customers" on public.customers using ((public.has_perm('sales') or public.has_perm('customers')) and not public.is_agent());

-- Company finances are hidden from agents
alter policy "members read" on public.deposits using (public.is_member() and not public.is_agent());
alter policy "members read" on public.expenses using (public.is_member() and not public.is_agent());
alter policy "members read" on public.owner_withdrawals using (public.is_member() and not public.is_agent());
alter policy "members read" on public.cash_transfers using (public.is_member() and not public.is_agent());
alter policy "members read" on public.cash_adjustments using (public.is_member() and not public.is_agent());
alter policy "members read" on public.productions using (public.is_member() and not public.is_agent());
alter policy "members read" on public.material_movements using (public.is_member() and not public.is_agent());
alter policy "members read" on public.owners using (public.is_member() and not public.is_agent());

-- Payments: an agent can only collect what is owed on their own sales
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
  where customer_id = p_customer_id and balance > 0 and (not v_agent or created_by = auth.uid());
  if p_amount > v_owed then
    raise exception 'Amount is more than what the customer owes%', case when v_agent then ' you' else '' end;
  end if;
  for r in select id, balance from v_sales
           where customer_id = p_customer_id and balance > 0 and (not v_agent or created_by = auth.uid())
           order by date, created_at loop
    exit when v_left <= 0;
    v_part := least(v_left, r.balance);
    insert into payments (date, sale_id, customer_id, amount, method, notes)
    values (p_date, r.id, p_customer_id, v_part, coalesce(p_method, 'cash'), coalesce(p_notes, ''));
    v_left := v_left - v_part;
  end loop;
end $$;

-- Pin a customer's location; agents may only pin customers who have none yet
create or replace function public.pin_customer_location(p_id uuid, p_lat numeric, p_lng numeric)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c customers%rowtype;
begin
  if not (has_perm('sales') or has_perm('customers')) then
    raise exception 'You do not have permission for customers' using errcode = '42501';
  end if;
  select * into c from customers where id = p_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if is_agent() and c.lat is not null then
    raise exception 'This customer is already on the map. Only the owners can move the pin.';
  end if;
  update customers set lat = p_lat, lng = p_lng where id = p_id;
  return c.name;
end $$;
revoke execute on function public.pin_customer_location(uuid, numeric, numeric) from public, anon;
grant execute on function public.pin_customer_location(uuid, numeric, numeric) to authenticated;

-- Cash the signed-in person is holding (agents cannot read the cash tables)
create or replace function public.my_cash_in_hand() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select cash_in_hand from v_cash_holders where profile_id = auth.uid()), 0);
$$;
revoke execute on function public.my_cash_in_hand() from public, anon;
grant execute on function public.my_cash_in_hand() to authenticated;

-- Performance of each sales agent between two dates (owners only)
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
    (select count(*) from sales s where s.created_by = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.cartons), 0)::bigint from sales s where s.created_by = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.bottles), 0)::bigint from sales s where s.created_by = p.id and s.date between p_from and p_to),
    (select coalesce(sum(s.total), 0) from sales s where s.created_by = p.id and s.date between p_from and p_to),
    (select coalesce(sum(v.balance), 0) from v_sales v where v.created_by = p.id and v.date between p_from and p_to),
    (select coalesce(sum(py.amount), 0) from payments py where py.received_by = p.id and py.date between p_from and p_to),
    (select coalesce(sum(v.balance), 0) from v_sales v where v.created_by = p.id),
    (select h.cash_in_hand from v_cash_holders h where h.profile_id = p.id),
    (select count(*) from customers c where c.created_by = p.id and c.created_at::date between p_from and p_to),
    (select count(*) from customers c where c.created_by = p.id),
    (select count(*) from customers c where c.created_by = p.id and c.lat is not null),
    (select max(s.date) from sales s where s.created_by = p.id)
  from profiles p join roles r on r.id = p.role_id
  where r.is_agent and not r.is_admin
  order by 8 desc, 2;
end $$;
revoke execute on function public.agent_stats(date, date) from public, anon;
grant execute on function public.agent_stats(date, date) to authenticated;

-- The role
insert into public.roles (name, is_admin, is_agent, permissions)
select 'Sales agent', false, true, '{"sales": true}'::jsonb
where not exists (select 1 from public.roles where name = 'Sales agent');

-- Rajabu, Chriss and Arnold signed up on 2026-10-25; Luca asked for them to be sales agents.
update public.profiles set role_id = (select id from public.roles where name = 'Sales agent'), is_active = true
where email in ('rajabu@gmail.com', 'chriss@gmail.com', 'arnold@gmail.com');
