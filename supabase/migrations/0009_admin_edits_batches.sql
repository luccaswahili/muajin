-- Once a batch is recorded, only the admin (Luca) can change it.
alter policy "update productions" on public.productions
  using (public.is_admin()) with check (public.is_admin());

-- Admin edit of a batch: date, drums, cartons, loose bottles and note.
-- Stock and auto-deducted materials are recalculated; each material keeps the cost it had.
create or replace function public.update_production(
  p_id uuid, p_drums numeric, p_cartons int, p_loose_bottles int, p_date date, p_notes text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  pd productions%rowtype;
  prod products%rowtype;
  v_bottles int;
  v_cartons int := coalesce(p_cartons, 0);
  v_drums numeric := coalesce(p_drums, 0);
  v_qty numeric;
  m record;
begin
  if not is_admin() then raise exception 'Only the admin can edit a batch'; end if;
  select * into pd from productions where id = p_id for update;
  if not found then raise exception 'Batch not found'; end if;
  select * into prod from products where id = pd.product_id;
  if v_cartons < 0 or coalesce(p_loose_bottles, 0) < 0 or v_drums < 0 then raise exception 'Numbers cannot be negative'; end if;
  if v_cartons = 0 and coalesce(p_loose_bottles, 0) = 0 then raise exception 'Enter how many cartons were produced'; end if;
  v_bottles := v_cartons * prod.bottles_per_carton + coalesce(p_loose_bottles, 0);

  update productions set
    date = coalesce(p_date, date), drums_used = v_drums,
    ethanol_litres = v_drums * coalesce((select (value #>> '{}')::numeric from settings where key = 'drum_litres'), 250),
    cartons_produced = v_cartons, loose_bottles = coalesce(p_loose_bottles, 0), notes = coalesce(p_notes, '')
  where id = p_id;

  update product_movements set bottles = v_bottles, date = coalesce(p_date, date)
  where production_id = p_id and reason = 'production';

  if (select coalesce(sum(bottles), 0) from product_movements where product_id = pd.product_id) < 0 then
    raise exception 'Cannot lower the batch this much: those cartons were already sold';
  end if;

  -- Recalculate the auto-deducted materials; each keeps the cost it was recorded at
  for m in select * from materials
           where usage <> 'none' and (product_id is null or product_id = pd.product_id)
  loop
    v_qty := round(case m.usage
      when 'per_bottle' then v_bottles * m.usage_qty
      when 'per_carton' then v_cartons * m.usage_qty
      when 'per_drum' then v_drums * m.usage_qty
    end, 2);
    update material_movements set qty = -v_qty, date = coalesce(p_date, pd.date)
    where production_id = p_id and reason = 'production' and material_id = m.id;
    if not found and m.is_active and v_qty > 0 then
      insert into material_movements (date, material_id, qty, unit_cost, reason, production_id, notes)
      values (coalesce(p_date, pd.date), m.id, -v_qty, m.unit_cost, 'production', p_id,
              format('Auto-deducted by production batch #%s', pd.batch_no));
    end if;
  end loop;

  update material_movements set date = coalesce(p_date, date) where production_id = p_id and reason = 'damage';
end $$;

revoke execute on function public.update_production(uuid, numeric, int, int, date, text) from public, anon;
grant execute on function public.update_production(uuid, numeric, int, int, date, text) to authenticated;
