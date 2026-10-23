-- Customers become mappable shops (magi shops, bars, wholesalers…)
alter table public.customers
  add column shop_type text not null default 'magi_shop' check (shop_type in ('magi_shop', 'bar', 'wholesaler', 'shop', 'other')),
  add column status text not null default 'active' check (status in ('prospect', 'active', 'not_interested')),
  add column contact_name text not null default '',
  add column region text not null default '',
  add column area text not null default '',
  add column lat double precision check (lat between -90 and 90),
  add column lng double precision check (lng between -180 and 180);

create index on public.customers (region);

create or replace view public.v_customer_balances with (security_invoker = true) as
select c.id, c.name, c.phone, c.location, c.notes, c.created_by, c.created_at,
  coalesce((select sum(total) from sales s where s.customer_id = c.id), 0) as total_bought,
  coalesce((select sum(amount) from payments p where p.customer_id = c.id), 0) as total_paid,
  coalesce((select sum(total) from sales s where s.customer_id = c.id), 0)
    - coalesce((select sum(amount) from payments p where p.customer_id = c.id), 0) as balance,
  (select max(date) from sales s where s.customer_id = c.id) as last_purchase,
  c.shop_type, c.status, c.contact_name, c.region, c.area, c.lat, c.lng,
  coalesce((select sum(cartons) from sales s where s.customer_id = c.id), 0) as cartons_bought,
  pr.full_name as created_by_name
from customers c
left join profiles pr on pr.id = c.created_by;
