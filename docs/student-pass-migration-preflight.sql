-- Youmi Lens Student Pass migration preflight
-- READ ONLY. This file intentionally contains no schema changes and no data changes.
-- Run in Supabase SQL editor before applying supabase-migration-student-pass-entitlements.sql.
--
-- The DO block uses dynamic SELECTs so it is safe when either the legacy ledger
-- or the renamed ledger does not yet exist. Results are emitted as NOTICE lines.

select
  'table_existence' as check_name,
  to_regclass('public.app_store_subscriptions') as app_store_subscriptions,
  to_regclass('public.apple_iap_transactions') as apple_iap_transactions,
  to_regclass('public.user_entitlements') as user_entitlements,
  to_regclass('public.billing_products') as billing_products,
  to_regclass('public.billing_events') as billing_events,
  to_regclass('public.apple_iap_notifications') as apple_iap_notifications,
  to_regclass('public.user_quota') as user_quota;

select
  'estimated_row_counts' as check_name,
  n.nspname as schema_name,
  c.relname as table_name,
  c.reltuples::bigint as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'app_store_subscriptions',
    'apple_iap_transactions',
    'user_entitlements',
    'billing_products',
    'billing_events',
    'apple_iap_notifications',
    'user_quota'
  )
order by c.relname;

do $$
declare
  table_name text;
  r record;
  v_count bigint;
begin
  foreach table_name in array array['app_store_subscriptions', 'apple_iap_transactions'] loop
    if to_regclass('public.' || table_name) is null then
      raise notice '%: table_missing', table_name;
      continue;
    end if;

    execute format('select count(*) from public.%I', table_name) into v_count;
    raise notice '% row_count=%', table_name, v_count;

    execute format($sql$
      select count(*) from (
        select transaction_id
        from public.%I
        group by transaction_id
        having count(*) > 1
      ) d
    $sql$, table_name) into v_count;
    raise notice '% duplicate_transaction_id_groups=%', table_name, v_count;

    execute format($sql$
      select count(*) from (
        select original_transaction_id
        from public.%I
        where nullif(trim(original_transaction_id), '') is not null
        group by original_transaction_id
        having count(*) > 1
      ) d
    $sql$, table_name) into v_count;
    raise notice '% duplicate_original_transaction_id_groups=%', table_name, v_count;

    execute format($sql$
      select count(*)
      from public.%I
      where transaction_id is null
        or trim(transaction_id) = ''
        or length(trim(transaction_id)) < 3
    $sql$, table_name) into v_count;
    raise notice '% null_or_malformed_transaction_ids=%', table_name, v_count;

    execute format($sql$
      select count(*)
      from public.%I s
      left join auth.users u on u.id = s.user_id
      where s.user_id is not null and u.id is null
    $sql$, table_name) into v_count;
    raise notice '% orphaned_user_ids=%', table_name, v_count;

    raise notice '% plan_type values:', table_name;
    for r in execute format('select plan_type, count(*) as row_count from public.%I group by plan_type order by row_count desc, plan_type', table_name) loop
      raise notice '  plan_type=% row_count=%', r.plan_type, r.row_count;
    end loop;

    raise notice '% status values:', table_name;
    for r in execute format('select status, count(*) as row_count from public.%I group by status order by row_count desc, status', table_name) loop
      raise notice '  status=% row_count=%', r.status, r.row_count;
    end loop;
  end loop;
end $$;

do $$
declare
  r record;
begin
  if to_regclass('public.user_quota') is null then
    raise notice 'user_quota: table_missing';
  else
    raise notice 'user_quota plan_type values:';
    for r in execute 'select plan_type, count(*) as row_count from public.user_quota group by plan_type order by row_count desc, plan_type' loop
      raise notice '  plan_type=% row_count=%', r.plan_type, r.row_count;
    end loop;

    raise notice 'user_quota values outside Phase 4 allowed set:';
    for r in execute $sql$
      select plan_type, count(*) as row_count
      from public.user_quota
      where plan_type not in (
        'public_trial',
        'student_basic',
        'student_plus',
        'student_pro',
        'student_pass',
        'core_tester',
        'admin',
        'developer'
      )
      group by plan_type
      order by row_count desc, plan_type
    $sql$ loop
      raise notice '  unexpected_plan_type=% row_count=%', r.plan_type, r.row_count;
    end loop;
  end if;
end $$;

select
  'public_policies_relevant_tables' as check_name,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'app_store_subscriptions',
    'apple_iap_transactions',
    'billing_products',
    'user_entitlements',
    'billing_events',
    'apple_iap_notifications'
  )
order by tablename, policyname;

select
  'relevant_indexes' as check_name,
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'app_store_subscriptions',
    'apple_iap_transactions',
    'billing_products',
    'user_entitlements',
    'billing_events',
    'apple_iap_notifications'
  )
order by tablename, indexname;

select
  'relevant_triggers' as check_name,
  event_object_schema,
  event_object_table,
  trigger_name,
  action_timing,
  event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'app_store_subscriptions',
    'apple_iap_transactions',
    'billing_products',
    'user_entitlements',
    'billing_events',
    'apple_iap_notifications'
  )
order by event_object_table, trigger_name;

select
  'relevant_constraints' as check_name,
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname,
  con.contype,
  pg_get_constraintdef(con.oid) as constraint_def
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'app_store_subscriptions',
    'apple_iap_transactions',
    'billing_products',
    'user_entitlements',
    'billing_events',
    'apple_iap_notifications'
  )
order by c.relname, con.conname;

select
  'gen_random_uuid_support' as check_name,
  to_regprocedure('gen_random_uuid()') is not null as gen_random_uuid_available,
  exists(select 1 from pg_extension where extname = 'pgcrypto') as pgcrypto_extension_present;

do $$
declare
  r record;
begin
  if to_regclass('public.billing_products') is null then
    raise notice 'billing_products: table_missing';
  else
    for r in execute $sql$
      select product_id, plan_type, kind, entitlement_days, is_purchasable, sales_end_at
      from public.billing_products
      where product_id = 'com.aydenz.youmilensipad.studentpass30d'
    $sql$ loop
      raise notice 'student_pass_product product_id=% plan_type=% kind=% entitlement_days=% is_purchasable=% sales_end_at=%',
        r.product_id, r.plan_type, r.kind, r.entitlement_days, r.is_purchasable, r.sales_end_at;
    end loop;
  end if;
end $$;
