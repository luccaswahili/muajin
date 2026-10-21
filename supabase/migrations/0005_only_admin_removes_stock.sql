-- Only the admin can take stock out by hand, undo stock entries, delete a production batch,
-- or delete an expense that added materials to stock.
create or replace function public.adjust_product_stock(
  p_product_id uuid, p_bottles int, p_reason text, p_notes text default '', p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
declare v_bottles int;
begin
  perform require_perm('stock');
  if p_reason not in ('opening', 'adjustment', 'sample', 'breakage', 'return') then raise exception 'Invalid reason'; end if;
  v_bottles := case when p_reason in ('sample', 'breakage') then -abs(p_bottles) else p_bottles end;
  if v_bottles < 0 and not is_admin() then
    raise exception 'Only the admin can remove stock' using errcode = '42501';
  end if;
  insert into product_movements (date, product_id, bottles, reason, notes)
  values (p_date, p_product_id, v_bottles, p_reason, coalesce(p_notes, ''));
end $$;

create or replace function public.adjust_material_stock(
  p_material_id uuid, p_qty numeric, p_reason text, p_notes text default '', p_date date default current_date
) returns void
language plpgsql security definer set search_path = public as $$
declare v_qty numeric;
begin
  perform require_perm('stock');
  if p_reason not in ('opening', 'adjustment', 'damage') then raise exception 'Invalid reason'; end if;
  v_qty := case when p_reason = 'damage' then -abs(p_qty) else p_qty end;
  if v_qty < 0 and not is_admin() then
    raise exception 'Only the admin can remove stock' using errcode = '42501';
  end if;
  insert into material_movements (date, material_id, qty, unit_cost, reason, notes)
  select p_date, id, v_qty, unit_cost, p_reason, coalesce(p_notes, '')
  from materials where id = p_material_id;
end $$;

alter policy "delete product movements" on public.product_movements using (public.is_admin() and reason not in ('sale', 'production'));
alter policy "delete material movements" on public.material_movements using (public.is_admin() and reason not in ('production', 'purchase'));
alter policy "delete productions" on public.productions using (public.is_admin());
alter policy "delete expenses" on public.expenses using (public.has_perm('expenses') and (material_id is null or public.is_admin()));
