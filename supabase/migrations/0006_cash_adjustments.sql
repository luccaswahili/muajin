-- Admin-only corrections to the cash a member is holding (not banked).
create table public.cash_adjustments (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  profile_id uuid not null references public.profiles(id),
  amount numeric(14,2) not null check (amount <> 0),
  notes text not null default '',
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.cash_adjustments enable row level security;
create policy "members read" on public.cash_adjustments for select to authenticated using (public.is_member());
create policy "admin delete" on public.cash_adjustments for delete to authenticated using (public.is_admin());
create trigger audit_cash_adjustments after insert or update or delete on public.cash_adjustments
  for each row execute function public.audit_trigger();

create or replace function public.record_cash_adjustment(
  p_profile_id uuid, p_amount numeric, p_notes text default '', p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Only the admin can adjust cash' using errcode = '42501'; end if;
  if coalesce(p_amount, 0) = 0 then raise exception 'Enter an amount'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Write a reason for the adjustment'; end if;
  insert into cash_adjustments (date, profile_id, amount, notes) values (p_date, p_profile_id, p_amount, trim(p_notes));
end $$;
revoke execute on function public.record_cash_adjustment(uuid, numeric, text, date) from public, anon;
grant execute on function public.record_cash_adjustment(uuid, numeric, text, date) to authenticated;

create or replace view public.v_cash_holders with (security_invoker = true) as
select pr.id as profile_id, pr.full_name, pr.email,
  coalesce((select sum(amount) from payments p where p.received_by = pr.id and p.method <> 'bank'), 0)
  + coalesce((select sum(amount) from cash_transfers t where t.to_profile = pr.id), 0)
  - coalesce((select sum(amount) from cash_transfers t where t.from_profile = pr.id), 0)
  - coalesce((select sum(amount) from deposits d where d.deposited_by = pr.id and d.status <> 'rejected'), 0)
  - coalesce((select sum(amount) from expenses e where e.paid_by = pr.id and e.paid_from = 'cash'), 0)
  - coalesce((select sum(amount) from owner_withdrawals w where w.paid_by = pr.id and w.paid_from = 'cash'), 0)
  + coalesce((select sum(amount) from cash_adjustments a where a.profile_id = pr.id), 0)
  as cash_in_hand
from profiles pr
where pr.role_id is not null;
