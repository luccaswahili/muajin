-- A customer who has bought from us is "Buying from us" (status active).
-- 1) Every new sale marks its customer active.
-- 2) Backfill: customers who already have sales become active.

create or replace function public.mark_customer_active_on_sale()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.customer_id is not null then
    update public.customers set status = 'active'
     where id = new.customer_id and status is distinct from 'active';
  end if;
  return new;
end $$;

drop trigger if exists sales_mark_customer_active on public.sales;
create trigger sales_mark_customer_active
  after insert or update of customer_id on public.sales
  for each row execute function public.mark_customer_active_on_sale();

update public.customers c set status = 'active'
 where c.status is distinct from 'active'
   and exists (select 1 from public.sales s where s.customer_id = c.id);
