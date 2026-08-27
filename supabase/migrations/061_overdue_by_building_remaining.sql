-- ============================================================
-- 061: crm.overdue_by_building() also returns remaining_total.
--
-- The Debtors page's per-ЖК chart has always carried a caption saying
-- "red = the overdue portion, grey = the whole remaining balance on those
-- same contracts" -- but overdue_by_building() only ever returned
-- total_overdue, so HBarChart drew a single red bar and the "grey" half of
-- that promise never existed on screen. Reported back as "the charts make
-- no sense": a bar ranked purely by overdue amount, with a caption
-- describing a comparison that isn't there, reads as noise, not
-- information. This adds the missing number so the chart can actually
-- draw what the caption already claimed.
--
-- Mirrors exactly how crm.overdue_contracts()/overdue_totals() already
-- compute remaining_total (migration in 000_full_setup.sql): the whole
-- unpaid balance of the contract (amount - paid_amount), not just its
-- overdue slice. Grouped per building+currency here instead of per
-- contract, via a small CTE so each contract's remaining is counted once
-- even though overdue_installments can carry several unpaid rows for it.
-- ============================================================

drop function if exists crm.overdue_by_building();

create function crm.overdue_by_building()
returns table (
  building_id uuid,
  building_name text,
  currency text,
  contracts int,
  total_overdue numeric,
  remaining_total numeric
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  with base as (
    select
      o.building_id,
      coalesce(b.name, '—') as building_name,
      c.currency::text as currency,
      c.id as contract_id,
      oi.unpaid_amount,
      c.amount,
      c.paid_amount
    from crm.overdue_installments oi
    join crm.contracts c on c.id = oi.contract_id
    left join crm.objects   o on o.id = c.object_id
    left join crm.buildings b on b.id = o.building_id
    where oi.due_date < current_date
      and oi.unpaid_amount > 0.005
  ),
  per_contract as (
    select distinct on (contract_id)
      building_id, currency, contract_id, amount, paid_amount
    from base
  ),
  remaining as (
    select building_id, currency, sum(greatest(amount - paid_amount, 0)) as remaining_total
    from per_contract
    group by building_id, currency
  )
  select
    b.building_id,
    b.building_name,
    b.currency,
    (count(distinct b.contract_id))::int,
    sum(b.unpaid_amount),
    coalesce(r.remaining_total, 0)
  from base b
  left join remaining r
    on r.building_id is not distinct from b.building_id
   and r.currency = b.currency
  group by b.building_id, b.building_name, b.currency, r.remaining_total
  order by sum(b.unpaid_amount) desc;
$$;

grant execute on function crm.overdue_by_building() to authenticated;
