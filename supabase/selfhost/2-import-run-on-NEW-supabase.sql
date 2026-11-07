-- Run on the NEW self-hosted Supabase AFTER migrations 0001..0012 (as postgres/supabase_admin).
-- Replace PASTE_DUMP_JSON_HERE with the full dump text from step 1.
-- Clears the seed rows the migrations created in public tables (new DB only), then loads everything.
begin;
set local session_replication_role = replica;
do $imp$
declare d jsonb := $dump$PASTE_DUMP_JSON_HERE$dump$::jsonb; k text; cols text;
begin
  for k in select jsonb_object_keys(d) loop
    if k like 'public.%' then execute format('truncate %s cascade', k); end if;
  end loop;
  for k in select jsonb_object_keys(d) loop
    continue when jsonb_array_length(d->k) = 0;
    select string_agg(quote_ident(a.attname), ',' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = k::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and (d->k->0) ? a.attname;
    execute format('insert into %s (%s) overriding system value select %s from jsonb_populate_recordset(null::%s, $1)', k, cols, cols, k) using d->k;
    raise notice '% rows -> %', jsonb_array_length(d->k), k;
  end loop;
end $imp$;
select setval(pg_get_serial_sequence('public.productions','batch_no'), coalesce((select max(batch_no) from public.productions),1));
select setval(pg_get_serial_sequence('public.audit_log','id'), coalesce((select max(id) from public.audit_log),1));
commit;
-- Check: select count(*) from auth.users;  -- expect 8
--        select count(*) from public.customers; -- expect 16
--        select count(*) from public.sales; -- expect 18
