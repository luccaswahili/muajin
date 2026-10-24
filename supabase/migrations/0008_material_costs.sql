-- Real costs for TRA stamps and labels; bottle caps come free with the bottles.
alter table public.materials add column if not exists is_free boolean not null default false;

create or replace view public.v_material_stock with (security_invoker = true) as
select mt.id as material_id, mt.name, mt.unit, mt.unit_cost, mt.low_stock_level, mt.is_active, mt.sort,
  mt.per_bottle, mt.per_carton,
  coalesce(sum(m.qty), 0::numeric) as qty,
  mt.usage, mt.usage_qty, mt.product_id, mt.is_free
from materials mt left join material_movements m on m.material_id = mt.id
group by mt.id;

-- TRA stamps: TZS 800,000 per 18,000. Labels: TZS 300,000 per 10,000.
update public.materials set unit_cost = round(800000.0 / 18000, 4) where name = 'Tra stamp';
update public.materials set unit_cost = 30 where name = 'Labels';
update public.materials set unit_cost = 0, is_free = true where name = 'Bottle caps';

-- Apply the same costs to stock already recorded and to past batches.
update public.material_movements mm set unit_cost = mt.unit_cost
from public.materials mt
where mm.material_id = mt.id and mt.name in ('Tra stamp', 'Labels') and mm.unit_cost = 0
  and mm.reason in ('opening', 'production', 'damage', 'adjustment');
