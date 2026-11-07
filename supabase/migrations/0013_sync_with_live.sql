-- Brings a fresh database in line with the live one (some earlier changes were applied
-- directly and differ from the files above). For fresh databases only (the live DB already has these).

CREATE OR REPLACE FUNCTION public.record_production(p_product_id uuid, p_drums numeric, p_cartons integer, p_loose_bottles integer DEFAULT 0, p_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT ''::text, p_use_materials boolean DEFAULT true, p_flavor_material_id uuid DEFAULT NULL::uuid, p_labour_cost numeric DEFAULT 0, p_labour_paid_from text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'The app was updated. Please refresh the page and try again.';
end $function$
;

-- On a fresh DB this function has different parameter defaults, so recreate it.
drop function if exists public.record_production(uuid, numeric, integer, integer, date, text, jsonb, numeric, text);

CREATE OR REPLACE FUNCTION public.record_production(p_product_id uuid, p_drums numeric, p_cartons integer, p_loose_bottles integer, p_date date, p_notes text, p_damaged jsonb, p_labour_cost numeric DEFAULT 0, p_labour_paid_from text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prod products%rowtype;
  v_id uuid;
  v_no int;
  v_bottles int;
  v_cartons int := coalesce(p_cartons, 0);
  v_drums numeric := coalesce(p_drums, 0);
  v_qty numeric;
  m record;
  d jsonb;
  v_cat uuid;
begin
  perform require_perm('production');
  select * into prod from products where id = p_product_id;
  if not found then raise exception 'Product not found'; end if;
  if v_cartons < 0 or coalesce(p_loose_bottles, 0) < 0 or v_drums < 0 then raise exception 'Numbers cannot be negative'; end if;
  if v_cartons = 0 and coalesce(p_loose_bottles, 0) = 0 then raise exception 'Enter how many cartons were produced'; end if;
  v_bottles := v_cartons * prod.bottles_per_carton + coalesce(p_loose_bottles, 0);

  insert into productions (date, product_id, drums_used, ethanol_litres, cartons_produced, loose_bottles, notes)
  values (coalesce(p_date, current_date), p_product_id, v_drums,
          v_drums * coalesce((select (value #>> '{}')::numeric from settings where key = 'drum_litres'), 250),
          v_cartons, coalesce(p_loose_bottles, 0), coalesce(p_notes, ''))
  returning id, batch_no into v_id, v_no;

  insert into product_movements (date, product_id, bottles, reason, production_id, notes)
  values (coalesce(p_date, current_date), p_product_id, v_bottles, 'production', v_id, format('Produced in batch #%s', v_no));

  for m in select * from materials
           where is_active and usage <> 'none' and usage_qty > 0 and (product_id is null or product_id = p_product_id)
  loop
    v_qty := case m.usage
      when 'per_bottle' then v_bottles * m.usage_qty
      when 'per_carton' then v_cartons * m.usage_qty
      when 'per_drum' then v_drums * m.usage_qty
    end;
    if v_qty > 0 then
      insert into material_movements (date, material_id, qty, unit_cost, reason, production_id, notes)
      values (coalesce(p_date, current_date), m.id, -round(v_qty, 2), m.unit_cost, 'production', v_id,
              format('Auto-deducted by production batch #%s', v_no));
    end if;
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p_damaged, '[]'::jsonb)) loop
    v_qty := (d ->> 'qty')::numeric;
    if v_qty is not null and v_qty > 0 then
      insert into material_movements (date, material_id, qty, unit_cost, reason, production_id, notes)
      select coalesce(p_date, current_date), id, -v_qty, unit_cost, 'damage', v_id,
             format('Damaged during production batch #%s', v_no) || coalesce(nullif(' · ' || (d ->> 'note'), ' · '), '')
      from materials where id = (d ->> 'material_id')::uuid;
    end if;
  end loop;

  if coalesce(p_labour_cost, 0) > 0 then
    select id into v_cat from expense_categories where name = 'Temporary workers';
    if v_cat is null then
      insert into expense_categories (name) values ('Temporary workers') returning id into v_cat;
    end if;
    insert into expenses (date, category_id, amount, description, paid_from, production_id)
    values (coalesce(p_date, current_date), v_cat, p_labour_cost, format('Workers for batch #%s', v_no), coalesce(p_labour_paid_from, 'cash'), v_id);
  end if;
  return v_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.record_sale(p_product_id uuid, p_cartons integer, p_bottles integer, p_price_carton numeric, p_price_bottle numeric, p_customer_id uuid, p_new_customer_name text, p_new_customer_phone text, p_amount_paid numeric, p_method text, p_discount numeric, p_date date, p_notes text, p_from_agent uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  if coalesce(p_amount_paid, 0) > 0 then
    insert into payments (date, sale_id, customer_id, amount, method, received_by)
    values (p_date, v_sale, v_customer, p_amount_paid, coalesce(p_method, 'cash'), coalesce(v_agent, auth.uid()));
  end if;
  return v_sale;
end $function$
;

CREATE OR REPLACE FUNCTION public.update_production(p_id uuid, p_drums numeric, p_cartons integer, p_loose_bottles integer, p_date date, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

drop view if exists public.v_production_costs;
create view public.v_production_costs with (security_invoker = true) as  SELECT pd.id,
    pd.date,
    pd.product_id,
    pd.drums_used,
    pd.ethanol_litres,
    pd.cartons_produced,
    pd.loose_bottles,
    pd.notes,
    pd.created_by,
    pd.created_at,
    p.name AS product_name,
    p.bottles_per_carton,
    p.price_carton,
    pr.full_name AS created_by_name,
    COALESCE(( SELECT sum((- m.qty) * m.unit_cost) AS sum
           FROM material_movements m
          WHERE m.production_id = pd.id), 0::numeric) AS material_cost,
    COALESCE(( SELECT sum(e.amount) AS sum
           FROM expenses e
          WHERE e.production_id = pd.id), 0::numeric) AS other_cost,
    COALESCE(( SELECT sum((- m.qty) * m.unit_cost) AS sum
           FROM material_movements m
          WHERE m.production_id = pd.id), 0::numeric) + COALESCE(( SELECT sum(e.amount) AS sum
           FROM expenses e
          WHERE e.production_id = pd.id), 0::numeric) AS total_cost,
        CASE
            WHEN (pd.cartons_produced::numeric + pd.loose_bottles::numeric / p.bottles_per_carton::numeric) > 0::numeric THEN (COALESCE(( SELECT sum((- m.qty) * m.unit_cost) AS sum
               FROM material_movements m
              WHERE m.production_id = pd.id), 0::numeric) + COALESCE(( SELECT sum(e.amount) AS sum
               FROM expenses e
              WHERE e.production_id = pd.id), 0::numeric)) / (pd.cartons_produced::numeric + pd.loose_bottles::numeric / p.bottles_per_carton::numeric)
            ELSE NULL::numeric
        END AS cost_per_carton,
        CASE
            WHEN pd.drums_used > 0::numeric THEN (pd.cartons_produced::numeric + pd.loose_bottles::numeric / p.bottles_per_carton::numeric) / pd.drums_used
            ELSE NULL::numeric
        END AS cartons_per_drum,
    pd.batch_no
   FROM productions pd
     JOIN products p ON p.id = pd.product_id
     LEFT JOIN profiles pr ON pr.id = pd.created_by;

revoke execute on function public.record_production(uuid, numeric, integer, integer, date, text, jsonb, numeric, text) from public, anon;
grant execute on function public.record_production(uuid, numeric, integer, integer, date, text, jsonb, numeric, text) to authenticated;
revoke execute on function public.record_production(uuid, numeric, integer, integer, date, text, boolean, uuid, numeric, text) from public, anon;
grant execute on function public.record_production(uuid, numeric, integer, integer, date, text, boolean, uuid, numeric, text) to authenticated;
