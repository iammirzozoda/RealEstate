-- ============================================================
-- 063: crm.sms_broadcast_recipients() -- who a custom SMS broadcast
--      reaches, for one of three audiences.
--
-- Backs the new "Своя рассылка" feature in Settings → SMS: an admin
-- writes their own text (not one of the two fixed payment-reminder
-- templates) and sends it to either every client, everyone with a
-- contract in one chosen building, or everyone currently overdue --
-- the exact scenario that prompted this ("дом сдан, приходите за
-- ключами" needs every buyer in THAT building, not a payment
-- reminder).
--
-- One function for all three audiences rather than three separate
-- queries (one in SQL, two hand-rolled in JS) so the definition of
-- "a client with a live contract" and "a client who's overdue" only
-- exists once, in the same place overdue_contracts()/dashboard_summary()
-- already define it. security invoker + granted to authenticated, same
-- as those two: RLS still applies, so a scoped manager (if ever given
-- access to this feature) would only ever see their own clients.
--
-- distinct on (cl.id): a client with two contracts in the audience
-- must appear once, not once per contract -- otherwise they'd get the
-- same SMS twice.
-- ============================================================

create or replace function crm.sms_broadcast_recipients(
  p_audience text,             -- 'all' | 'building' | 'debtors'
  p_building_id uuid default null
)
returns table (
  client_id uuid,
  name text,
  phone text,
  phone2 text
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  with base as (
    select distinct on (cl.id)
      cl.id as client_id,
      cl.name,
      cl.phone,
      cl.phone2
    from crm.contracts c
    join crm.clients cl on cl.id = c.client_id
    left join crm.objects o on o.id = c.object_id
    where c.status <> 'cancelled'
      and (p_audience <> 'building' or o.building_id = p_building_id)
      and (
        p_audience <> 'debtors'
        or exists (
          select 1
          from crm.overdue_installments oi
          where oi.contract_id = c.id
            and oi.due_date < current_date
            and oi.unpaid_amount > 0.005
        )
      )
    order by cl.id
  )
  select client_id, name, phone, phone2
  from base
  order by name;
$$;

grant execute on function crm.sms_broadcast_recipients(text, uuid) to authenticated;
