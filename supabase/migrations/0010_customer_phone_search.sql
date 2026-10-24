-- Digits-only phone, so customers can be searched by number however it was typed.
alter table public.customers add column if not exists phone_digits text
  generated always as (regexp_replace(coalesce(phone, ''), '\D', '', 'g')) stored;
create index if not exists customers_phone_digits_idx on public.customers (phone_digits);

create or replace view public.v_customer_balances with (security_invoker = true) as
select c.id, c.name, c.phone, c.location, c.notes, c.created_by, c.created_at,
  coalesce((select sum(s.total) from sales s where s.customer_id = c.id), 0::numeric) as total_bought,
  coalesce((select sum(p.amount) from payments p where p.customer_id = c.id), 0::numeric) as total_paid,
  coalesce((select sum(s.total) from sales s where s.customer_id = c.id), 0::numeric)
    - coalesce((select sum(p.amount) from payments p where p.customer_id = c.id), 0::numeric) as balance,
  (select max(s.date) from sales s where s.customer_id = c.id) as last_purchase,
  c.shop_type, c.status, c.contact_name, c.region, c.area, c.lat, c.lng,
  coalesce((select sum(s.cartons) from sales s where s.customer_id = c.id), 0::bigint) as cartons_bought,
  pr.full_name as created_by_name,
  c.phone_digits
from customers c left join profiles pr on pr.id = c.created_by;
