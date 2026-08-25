-- ============================================================
-- 060: аренда -- остальное. Follows 059 (payment_type gained 'rent' there,
-- in its own transaction -- see that file for why it had to be separate).
--
-- 1. crm.objects.listing_type ('sale' | 'rent', default 'sale' -- every
--    existing row keeps behaving exactly as before). This is what tells
--    a warehouse meant for rent apart from an apartment meant for sale
--    BEFORE either one has a contract at all -- the shakhmatka excludes
--    listing_type = 'rent' objects, the new "Аренда" section on the
--    building page shows only those.
--
-- 2. crm.recompute_object_status() now sets 'rented' (already a valid
--    status, already coloured/translated in the app -- see 049's own
--    comment noting nothing ever set it) instead of 'sold' when the
--    paying contract on the object is payment_type = 'rent'. Every other
--    branch (reserved, available) is untouched.
--
-- 3. crm.regenerate_schedule() stops forcing payment_type back to
--    'installment' on every call. Safe today only because every current
--    caller already has payment_type = 'installment' before calling it
--    -- but it would silently turn a rent contract back into an
--    installment sale the first time someone clicked "Пересчитать
--    график" on a lease.
--
-- 4. trg_auto_regenerate_schedule (055) reacts to payment_type = 'rent'
--    too, not just 'installment' -- editing an active lease's amount
--    should regenerate its schedule the same way editing a sale's does.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

alter table crm.objects add column if not exists listing_type text not null default 'sale';
alter table crm.objects drop constraint if exists objects_listing_type_check;
alter table crm.objects add constraint objects_listing_type_check
  check (listing_type in ('sale', 'rent'));

create index if not exists objects_listing_type_idx on crm.objects (listing_type);

create or replace function crm.recompute_object_status(p_object_id uuid)
returns void
language sql
security definer
set search_path = crm, public
as $$
  update crm.objects
  set status = case
    when exists (
      select 1 from crm.contracts c
      where c.object_id = p_object_id and c.status <> 'cancelled'
        and c.paid_amount > 0 and c.payment_type = 'rent'
    ) then 'rented'
    when exists (
      select 1 from crm.contracts c
      where c.object_id = p_object_id and c.status <> 'cancelled' and c.paid_amount > 0
    ) then 'sold'
    when exists (
      select 1 from crm.contracts c
      where c.object_id = p_object_id and c.status <> 'cancelled'
    ) then 'reserved'
    else 'available'
  end::crm.object_status
  where id = p_object_id;
$$;

create or replace function crm.regenerate_schedule(
  p_contract_id uuid,
  p_months integer
)
returns integer
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_contract crm.contracts;
  v_remaining numeric;
  v_base numeric;
  v_amount numeric;
  i integer;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;
  if p_months is null or p_months < 1 then
    raise exception 'Months must be at least 1';
  end if;

  select * into v_contract from crm.contracts where id = p_contract_id;
  if not found then
    raise exception 'Contract not found';
  end if;

  v_remaining := greatest(v_contract.amount - v_contract.paid_amount, 0);
  if v_remaining <= 0 then
    raise exception 'Nothing left to schedule';
  end if;

  -- Только план; фактические (оплаченные) строки неприкосновенны.
  delete from crm.contract_payments
  where contract_id = p_contract_id and paid = false;

  v_base := floor(v_remaining / p_months * 100) / 100;
  for i in 1..p_months loop
    if i = p_months then
      v_amount := round((v_remaining - v_base * (p_months - 1)) * 100) / 100;
    else
      v_amount := v_base;
    end if;
    insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
    values (p_contract_id, (current_date + (i || ' month')::interval)::date, v_amount, false, null);
  end loop;

  -- payment_type is deliberately NOT touched here anymore -- see this
  -- migration's header. installment_months is the only thing this
  -- function's caller expects it to keep in sync.
  update crm.contracts
  set installment_months = p_months
  where id = p_contract_id;

  return p_months;
end;
$$;

create or replace function crm.auto_regenerate_schedule()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if NEW.payment_type in ('installment', 'rent')
     and NEW.installment_months is not null
     and NEW.installment_months > 0
     and NEW.amount is distinct from OLD.amount
     and NEW.amount > NEW.paid_amount
     and exists (
       select 1 from crm.contract_payments
       where contract_id = NEW.id and paid = false
     )
  then
    perform crm.regenerate_schedule(NEW.id, NEW.installment_months);
  end if;
  return NEW;
end;
$$;
