-- ============================================================
-- ПОЛНАЯ УСТАНОВКА БАЗЫ ОДНИМ ФАЙЛОМ.
--
-- 1) Выполнить этот файл в Supabase SQL Editor (Run).
-- 2) СРАЗУ ГОТОВ ВХОД (никакого создания юзеров вручную):
--        Email:  admin@crm.tj
--        Пароль: Admin12345
--    Войдите на сайт и в Настройках смените пароль.
-- 3) Остальных сотрудников создаёте в самой программе
--    (Настройки -> Сотрудники) или в Supabase -> Authentication.
--
-- Файл генерируется из отдельных миграций; не редактируйте его
-- вручную -- правки делаются в исходных файлах.
-- ============================================================




-- ############################################################
-- ### schema.sql
-- ############################################################

-- RealEstate CRM: objects (properties / construction sites) catalog
-- Everything lives in its own "crm" schema so it never collides with
-- other apps (e.g. ZAKI ERP) sharing this same Supabase project.

create schema if not exists crm;

do $idem$ begin
  create type crm.object_type as enum (
  'apartment',
  'house',
  'commercial',
  'land',
  'construction_site'
);
exception when duplicate_object then null;
end $idem$;

do $idem$ begin
  create type crm.object_status as enum (
  'available',
  'reserved',
  'sold',
  'rented',
  'in_progress'
);
exception when duplicate_object then null;
end $idem$;

create table if not exists crm.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  type crm.object_type not null default 'apartment',
  status crm.object_status not null default 'available',
  area numeric,
  price numeric,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists objects_type_idx on crm.objects (type);
create index if not exists objects_status_idx on crm.objects (status);

alter table crm.objects enable row level security;

-- Permissive policy for initial development; tighten once auth/roles are added.
drop policy if exists "Allow all access to objects" on crm.objects;
create policy "Allow all access to objects" on crm.objects
  for all using (true) with check (true);

create or replace function crm.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists objects_set_updated_at on crm.objects;
create trigger objects_set_updated_at
  before update on crm.objects
  for each row execute function crm.set_updated_at();

-- PostgREST needs the anon/authenticated roles granted on this schema,
-- and "crm" added to Project Settings -> API -> Exposed schemas.
grant usage on schema crm to anon, authenticated;
grant all on all tables in schema crm to anon, authenticated;
grant all on all sequences in schema crm to anon, authenticated;
alter default privileges in schema crm grant all on tables to anon, authenticated;
alter default privileges in schema crm grant all on sequences to anon, authenticated;

-- ############################################################
-- ### 002_crm_modules.sql
-- ############################################################

-- RealEstate CRM: clients/leads, tasks, contracts, buildings + apartment matrix
-- Run this AFTER schema.sql, in the same "crm" schema.

-- ===== Clients / leads =====

do $idem$ begin
  create type crm.lead_status as enum (
  'new',
  'contacted',
  'negotiation',
  'client',
  'lost'
);
exception when duplicate_object then null;
end $idem$;

create table if not exists crm.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  email text,
  source text,
  status crm.lead_status not null default 'new',
  interested_object_id uuid references crm.objects(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_status_idx on crm.clients (status);

alter table crm.clients enable row level security;
drop policy if exists "Allow all access to clients" on crm.clients;
create policy "Allow all access to clients" on crm.clients
  for all using (true) with check (true);

drop trigger if exists clients_set_updated_at on crm.clients;
create trigger clients_set_updated_at
  before update on crm.clients
  for each row execute function crm.set_updated_at();

-- ===== Tasks =====

do $idem$ begin
  create type crm.task_status as enum (
  'todo',
  'in_progress',
  'done'
);
exception when duplicate_object then null;
end $idem$;

create table if not exists crm.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  due_date date,
  status crm.task_status not null default 'todo',
  assignee text,
  client_id uuid references crm.clients(id) on delete set null,
  object_id uuid references crm.objects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_status_idx on crm.tasks (status);

alter table crm.tasks enable row level security;
drop policy if exists "Allow all access to tasks" on crm.tasks;
create policy "Allow all access to tasks" on crm.tasks
  for all using (true) with check (true);

drop trigger if exists tasks_set_updated_at on crm.tasks;
create trigger tasks_set_updated_at
  before update on crm.tasks
  for each row execute function crm.set_updated_at();

-- ===== Contracts =====

do $idem$ begin
  create type crm.contract_status as enum (
  'draft',
  'active',
  'completed',
  'cancelled'
);
exception when duplicate_object then null;
end $idem$;

create table if not exists crm.contracts (
  id uuid primary key default gen_random_uuid(),
  number text,
  client_id uuid not null references crm.clients(id) on delete restrict,
  object_id uuid not null references crm.objects(id) on delete restrict,
  amount numeric not null default 0,
  paid_amount numeric not null default 0,
  status crm.contract_status not null default 'draft',
  signed_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contracts_status_idx on crm.contracts (status);
create index if not exists contracts_client_idx on crm.contracts (client_id);
create index if not exists contracts_object_idx on crm.contracts (object_id);

alter table crm.contracts enable row level security;
drop policy if exists "Allow all access to contracts" on crm.contracts;
create policy "Allow all access to contracts" on crm.contracts
  for all using (true) with check (true);

drop trigger if exists contracts_set_updated_at on crm.contracts;
create trigger contracts_set_updated_at
  before update on crm.contracts
  for each row execute function crm.set_updated_at();

-- ===== Buildings + apartment matrix (shakhmatka) =====

create table if not exists crm.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  floors_count integer,
  units_per_floor integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table crm.buildings enable row level security;
drop policy if exists "Allow all access to buildings" on crm.buildings;
create policy "Allow all access to buildings" on crm.buildings
  for all using (true) with check (true);

drop trigger if exists buildings_set_updated_at on crm.buildings;
create trigger buildings_set_updated_at
  before update on crm.buildings
  for each row execute function crm.set_updated_at();

alter table crm.objects add column if not exists building_id uuid references crm.buildings(id) on delete set null;
alter table crm.objects add column if not exists floor integer;
alter table crm.objects add column if not exists position_in_floor integer;

create index if not exists objects_building_idx on crm.objects (building_id);

-- ===== Grants (redundant safety net alongside default privileges from schema.sql) =====

grant usage on schema crm to anon, authenticated;
grant all on all tables in schema crm to anon, authenticated;
grant all on all sequences in schema crm to anon, authenticated;

-- ############################################################
-- ### 003_settings_media_payments.sql
-- ############################################################

-- RealEstate CRM: app settings, building/unit media, flexible pricing,
-- and contract payment schedule (installments / barter / SMS reminders)

-- ===== Settings (singleton row) =====

create table if not exists crm.settings (
  id boolean primary key default true,
  usd_rate numeric not null default 10.5,
  sms_api_key text,
  sms_sender_name text default 'BurjiBohtar',
  sms_reminder_days integer not null default 3,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id)
);

insert into crm.settings (id) values (true) on conflict (id) do nothing;

alter table crm.settings enable row level security;
drop policy if exists "Allow all access to settings" on crm.settings;
create policy "Allow all access to settings" on crm.settings
  for all using (true) with check (true);

drop trigger if exists settings_set_updated_at on crm.settings;
create trigger settings_set_updated_at
  before update on crm.settings
  for each row execute function crm.set_updated_at();

-- ===== Building/unit media + flexible pricing =====

alter table crm.buildings add column if not exists price_per_sqm numeric;
alter table crm.buildings add column if not exists facade_url text;
alter table crm.buildings add column if not exists plan_url text;
alter table crm.buildings add column if not exists construction_status text not null default 'in_progress';
alter table crm.buildings drop constraint if exists buildings_construction_status_check;
alter table crm.buildings add constraint buildings_construction_status_check
  check (construction_status in ('planning', 'in_progress', 'completed'));

alter table crm.objects add column if not exists plan_url text;

-- Storage bucket for facade photos / building plans / unit plans
insert into storage.buckets (id, name, public)
values ('crm-media', 'crm-media', true)
on conflict (id) do nothing;

drop policy if exists "Public read crm-media" on storage.objects;
create policy "Public read crm-media" on storage.objects
  for select using (bucket_id = 'crm-media');
drop policy if exists "Public upload crm-media" on storage.objects;
create policy "Public upload crm-media" on storage.objects
  for insert with check (bucket_id = 'crm-media');
drop policy if exists "Public update crm-media" on storage.objects;
create policy "Public update crm-media" on storage.objects
  for update using (bucket_id = 'crm-media');
drop policy if exists "Public delete crm-media" on storage.objects;
create policy "Public delete crm-media" on storage.objects
  for delete using (bucket_id = 'crm-media');

-- ===== Contract payment type + installment schedule =====

do $idem$ begin
  create type crm.payment_type as enum ('full', 'installment', 'barter');
exception when duplicate_object then null;
end $idem$;

alter table crm.contracts add column if not exists payment_type crm.payment_type not null default 'full';
alter table crm.contracts add column if not exists installment_months integer;
alter table crm.contracts add column if not exists barter_details text;

create table if not exists crm.contract_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references crm.contracts(id) on delete cascade,
  due_date date not null,
  amount numeric not null,
  paid boolean not null default false,
  paid_date date,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists contract_payments_contract_idx on crm.contract_payments (contract_id);
create index if not exists contract_payments_due_date_idx on crm.contract_payments (due_date);

alter table crm.contract_payments enable row level security;
drop policy if exists "Allow all access to contract_payments" on crm.contract_payments;
create policy "Allow all access to contract_payments" on crm.contract_payments
  for all using (true) with check (true);

-- ===== Grants (redundant safety net alongside default privileges from schema.sql) =====

grant usage on schema crm to anon, authenticated;
grant all on all tables in schema crm to anon, authenticated;
grant all on all sequences in schema crm to anon, authenticated;

-- ############################################################
-- ### 004_span_and_settings_cleanup.sql
-- ############################################################

-- RealEstate CRM: support merged units in the shakhmatka grid,
-- and stop defaulting SMS sender name to an unrelated placeholder.

alter table crm.objects add column if not exists span integer not null default 1;

alter table crm.settings alter column sms_sender_name drop default;
update crm.settings set sms_sender_name = null where sms_sender_name = 'BurjiBohtar';

-- ############################################################
-- ### 005_auth_rls.sql
-- ############################################################

-- RealEstate CRM: require a logged-in Supabase Auth user for all data access.
-- Run this ONLY after you've created at least one user in
-- Supabase Dashboard -> Authentication -> Users -> Add user,
-- since anonymous access to every table below is removed.

drop policy if exists "Allow all access to objects" on crm.objects;
drop policy if exists "Authenticated access to objects" on crm.objects;
create policy "Authenticated access to objects" on crm.objects
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to clients" on crm.clients;
drop policy if exists "Authenticated access to clients" on crm.clients;
create policy "Authenticated access to clients" on crm.clients
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to tasks" on crm.tasks;
drop policy if exists "Authenticated access to tasks" on crm.tasks;
create policy "Authenticated access to tasks" on crm.tasks
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to contracts" on crm.contracts;
drop policy if exists "Authenticated access to contracts" on crm.contracts;
create policy "Authenticated access to contracts" on crm.contracts
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to buildings" on crm.buildings;
drop policy if exists "Authenticated access to buildings" on crm.buildings;
create policy "Authenticated access to buildings" on crm.buildings
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to settings" on crm.settings;
drop policy if exists "Authenticated access to settings" on crm.settings;
create policy "Authenticated access to settings" on crm.settings
  for all to authenticated using (true) with check (true);

drop policy if exists "Allow all access to contract_payments" on crm.contract_payments;
drop policy if exists "Authenticated access to contract_payments" on crm.contract_payments;
create policy "Authenticated access to contract_payments" on crm.contract_payments
  for all to authenticated using (true) with check (true);

-- Storage stays public-read (facade photos/plans are non-sensitive marketing
-- images), but only logged-in users may upload/modify/delete.
drop policy if exists "Public upload crm-media" on storage.objects;
drop policy if exists "Authenticated upload crm-media" on storage.objects;
create policy "Authenticated upload crm-media" on storage.objects
  for insert to authenticated with check (bucket_id = 'crm-media');

drop policy if exists "Public update crm-media" on storage.objects;
drop policy if exists "Authenticated update crm-media" on storage.objects;
create policy "Authenticated update crm-media" on storage.objects
  for update to authenticated using (bucket_id = 'crm-media');

drop policy if exists "Public delete crm-media" on storage.objects;
drop policy if exists "Authenticated delete crm-media" on storage.objects;
create policy "Authenticated delete crm-media" on storage.objects
  for delete to authenticated using (bucket_id = 'crm-media');

-- ############################################################
-- ### 006_task_reminders.sql
-- ############################################################

-- RealEstate CRM: optional SMS reminders for task due dates

alter table crm.tasks add column if not exists assignee_phone text;
alter table crm.tasks add column if not exists reminder_sent_at timestamptz;

-- ############################################################
-- ### 007_currency_template_types.sql
-- ############################################################

-- RealEstate CRM: per-deal currency (no auto-conversion), editable contract
-- template + company info, and non-apartment unit types (parking/commercial).

-- ===== Currency per object / per contract =====

do $idem$ begin
  create type crm.currency as enum ('TJS', 'USD');
exception when duplicate_object then null;
end $idem$;

alter table crm.objects add column if not exists currency crm.currency not null default 'TJS';
alter table crm.contracts add column if not exists currency crm.currency not null default 'TJS';
alter table crm.contracts add column if not exists amount_words text;

-- ===== Client passport (needed by the sample contract text) =====

alter table crm.clients add column if not exists passport text;

-- ===== Non-apartment unit types for the shakhmatka (basement/parking, etc.) =====

alter type crm.object_type add value if not exists 'parking';

-- ===== Company info + editable contract template =====

alter table crm.settings add column if not exists company_name text;
alter table crm.settings add column if not exists company_director text;
alter table crm.settings add column if not exists company_address text;
alter table crm.settings add column if not exists company_bank_details text;
alter table crm.settings add column if not exists contract_template text;

-- ############################################################
-- ### 008_default_contract_template.sql
-- ############################################################

-- Seed a default contract template (editable afterwards via Settings).
-- Based on the sample cooperation/purchase agreement provided by the user,
-- with the deal-specific parts replaced by {{placeholders}}.

update crm.settings
set contract_template = $tpl$ШАРТНОМАИ ҲАМКОРИ №{{contract_number}}

{{signed_date}}                                                    {{company_address}}

Тарафҳои аҳдкунанда
Ҷамъияти дорои масъулияти маҳдуди «{{company_name}}» дар шахсияти роҳбари ҷамъият {{company_director}}, ки дар асоси Оинномаи ҷамъият амал мекунад, аз як тараф, минбаъд «Фурӯшанда» ва аз тарафи дигар шаҳрванди Ҷумҳурии Тоҷикистон {{client_name}}, шиноснома {{client_passport}}, ки минбаъд «Харидор» номида мешавад, ҳамин шартномаро бо шартҳои зерин бастанд.

Мақсади шартнома
Бо мақсади вусъат бахшидани рафти сохтмони иншооти воқеъ дар {{building_address}}, тарафҳо уҳдадор шуданд, ки бо шартҳои манфиати мутақобила ҳамкорӣ намоянд.
«Фурӯшанда» имконият медиҳад, ки «Харидор» дар маблағгузории иншооти мазкур ширкат намуда, барои ба моликияти худ ба расмият даровардани {{object_name}}, бо масоҳати {{object_area}} м², ки маблағи фурӯш барои 1 м² — {{price_per_sqm}} {{currency}} мебошад, пардохт намояд. «Харидор» уҳдадор мешавад, ки маблағи умумии объектро — {{amount}} {{currency}} ({{amount_words}}) — пардохт намуда, дар муҳлати пешбининамудаи шартномаи мазкур онро минбаъд ба моликияти шахсии худ табдил дода, иҷро намояд.
«Фурӯшанда» бо анҷом расидани корҳои сохтмонӣ ва супоридани иншоот ба «Харидор» масоҳати зикршударо месупорад.
«Харидор» аз лаҳзаи бастани шартномаи ҳамкорӣ талаботи дар боло нишондодашударо таъмин менамояд.

Уҳдадориҳои тарафҳо
«Фурӯшанда» уҳдадор мешавад ба «Харидор» барои ба расмият даровардани манзил ба моликияти шахсӣ шиносномаи техникӣ диҳад, ки он баъди қабули иншоот ба баҳрабардорӣ дода мешавад.
Тамоми хароҷоти вобаста ба ҳуҷҷатгузории нотариалӣ ва бақайдгирии давлатӣ мустақилона аз ҷониби «Харидор» пардохт карда мешавад.

Масъулияти тарафҳо
«Харидор» барои саривақт пардохт намудани маблағи шартнома масъул мебошад.
«Фурӯшанда» барои саривақт ва босифат иҷро намудани корҳои сохтмонӣ масъул мебошад.

Чораҳои ҷаримавӣ
Дар мавриди риоя накардани муҳлати пардохт зиёда аз як моҳ ба андозаи 0,1% аз маблағи умумии шартнома барои ҳар як рӯзи ба таъхирандозӣ, на зиёда аз 10%, «Харидор» ба «Фурӯшанда» ҷарима пардохт менамояд.

Ҳолатҳои бекор намудани шартнома
Шартнома тибқи мувофиқаи тарафайн то пардохт намудан ва ё бо тартиби яктарафа дар мавриди қобилияти имконнопазир рад намуда, метавон бекор кард.
Дар сурати 2 (ду) моҳ пардохт накардани маблағ аз тарафи «Харидор», «Фурӯшанда» метавонад дигар муштариро барои объекти мазкур аз нав бандад.

Форс-мажор
Ягон тараф масъулиятро барои иҷро накардан ё иҷрои номатлуби уҳдадориҳои худ нахоҳад бурд, агар он дар натиҷаи ҳолатҳои фавқулода (сӯхтор, обхезӣ, заминҷунбӣ ва дигар офатҳои табиӣ) ба вуҷуд омада бошад.

Ҳалли баҳсҳо
Баҳсҳои зимни амалисозии шартномаи мазкур рухдиҳанда бо роҳи гуфтушунид ҳал мешаванд. Дар сурати нагардидани ҳал, баҳс дар асоси қонунҳои амалкунандаи Ҷумҳурии Тоҷикистон дар суди дахлдор ҳаллу фасл карда мешавад.
Шартномаи мазкур аз лаҳзаи ба имзо расонидани ҳар ду тараф эътибор пайдо менамояд ва дар ду нусха бо забони тоҷикӣ барои ҳар кадоме аз тарафҳо тартиб дода шудааст.

Суроғаи ҳуқуқӣ ва имзои тарафҳо:

«Фурӯшанда»                                                    «Харидор»
{{company_director}}                                           {{client_name}}
Суроға: {{company_address}}                             Шиноснома: {{client_passport}}
{{company_bank_details}}

Имзо ___________________                              Имзо ___________________
Санаи {{signed_date}}                                          Санаи {{signed_date}}$tpl$
where contract_template is null;

-- ############################################################
-- ### 009_logo_and_sms_templates.sql
-- ############################################################

-- RealEstate CRM: company logo, block/entrance support for shakhmatka,
-- and editable SMS templates.

alter table crm.settings add column if not exists company_logo_url text;
alter table crm.settings add column if not exists sms_payment_template text;
alter table crm.settings add column if not exists sms_task_template text;
-- Company-wide dashboard hero look (admin-set; users may still override
-- locally). See migration 033.
alter table crm.settings add column if not exists hero_theme text;
alter table crm.settings add column if not exists hero_pattern text;

alter table crm.objects add column if not exists block text;

update crm.settings
set sms_payment_template = $tpl$Уважаемый(ая) {{client_name}}, напоминаем: оплата {{amount}} {{currency}} по договору №{{contract_number}} до {{due_date}}.$tpl$
where sms_payment_template is null;

update crm.settings
set sms_task_template = $tpl${{assignee}}, напоминаем: задача "{{title}}" — срок {{due_date}}.$tpl$
where sms_task_template is null;

-- ############################################################
-- ### 010_cascade_delete_units.sql
-- ############################################################

-- Deleting a building currently orphans its units (building_id set to null),
-- which then show up as stray rows in the top-level Объекты list. Fix so
-- deleting a building removes all of its units in one transaction.

alter table crm.objects
  drop constraint if exists objects_building_id_fkey;

alter table crm.objects
  add constraint objects_building_id_fkey
  foreign key (building_id) references crm.buildings(id) on delete cascade;

-- ############################################################
-- ### 011_roles_and_client_fields.sql
-- ############################################################

-- Roles: admins have full edit rights everywhere; managers can book available
-- units and create new contracts, but cannot edit units/contracts that have
-- already moved past "available" — that's an admin-only action from here on.
--
-- Role assignment is manual and intentional: there is no in-app user
-- management UI. After creating a user in Supabase Dashboard -> Authentication,
-- run this in the SQL Editor (as postgres, which bypasses RLS) to set them up:
--
--   insert into crm.profiles (id, role)
--   values ('<user-id-from-auth-users>', 'admin')
--   on conflict (id) do update set role = excluded.role;
--
-- Use 'manager' instead of 'admin' for regular sales staff. Find a user's id
-- under Authentication -> Users in the dashboard.

create table if not exists crm.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'manager' check (role in ('admin', 'manager')),
  created_at timestamptz not null default now()
);

alter table crm.profiles enable row level security;

drop policy if exists "profiles_select_own" on crm.profiles;
create policy "profiles_select_own" on crm.profiles
  for select to authenticated
  using (id = auth.uid());

-- No insert/update/delete policy for the authenticated role on purpose:
-- role changes only happen via direct SQL (as postgres), which bypasses RLS.
-- This means no logged-in user, including managers, can ever grant
-- themselves admin through the app.

create or replace function crm.is_admin()
returns boolean
language sql
security definer
set search_path = crm, public
stable
as $$
  select coalesce(
    (select role from crm.profiles where id = auth.uid()) = 'admin',
    false
  );
$$;

-- Objects: managers may only update a unit while it's still "available"
-- (i.e. the booking flow, which flips it to "reserved"). Once a unit has
-- moved past that, only an admin can edit it further.
drop policy if exists "Authenticated access to objects" on crm.objects;

drop policy if exists "objects_select" on crm.objects;
create policy "objects_select" on crm.objects
  for select to authenticated using (true);

drop policy if exists "objects_insert" on crm.objects;
create policy "objects_insert" on crm.objects
  for insert to authenticated with check (true);

drop policy if exists "objects_update" on crm.objects;
create policy "objects_update" on crm.objects
  for update to authenticated
  using (status = 'available' or crm.is_admin())
  with check (true);

drop policy if exists "objects_delete" on crm.objects;
create policy "objects_delete" on crm.objects
  for delete to authenticated using (true);

-- Contracts: anyone can create one (booking/sale), but editing or deleting
-- an existing contract is admin-only.
drop policy if exists "Authenticated access to contracts" on crm.contracts;

drop policy if exists "contracts_select" on crm.contracts;
create policy "contracts_select" on crm.contracts
  for select to authenticated using (true);

drop policy if exists "contracts_insert" on crm.contracts;
create policy "contracts_insert" on crm.contracts
  for insert to authenticated with check (true);

drop policy if exists "contracts_update" on crm.contracts;
create policy "contracts_update" on crm.contracts
  for update to authenticated
  using (crm.is_admin())
  with check (true);

drop policy if exists "contracts_delete" on crm.contracts;
create policy "contracts_delete" on crm.contracts
  for delete to authenticated using (crm.is_admin());

-- Client details needed on the printed contract and for the booking-form
-- autocomplete (name -> full profile).
alter table crm.clients add column if not exists birth_date date;
alter table crm.clients add column if not exists address text;
alter table crm.clients add column if not exists passport_issued_by text;

-- ############################################################
-- ### 012_unit_rooms.sql
-- ############################################################

-- Track room count per unit (needed for the block/entrance/room-type
-- constructor: "3 однокомнатных по 45 м², 2 двухкомнатных по 65 м²").
alter table crm.objects add column if not exists rooms smallint;

-- ############################################################
-- ### 013_buildings_admin_rls.sql
-- ############################################################

-- The "Настроить здание" edit page is admin-gated in the UI, but the
-- underlying RLS still let any authenticated user (including managers) call
-- the Supabase API directly to edit or delete a building. Lock that down to
-- match the app-level gate: managers can still create buildings (that's the
-- "+ Новое здание / ЖК" flow in Объекты), but editing/deleting an existing
-- one is admin-only, same as contracts.
drop policy if exists "Authenticated access to buildings" on crm.buildings;

drop policy if exists "buildings_select" on crm.buildings;
create policy "buildings_select" on crm.buildings
  for select to authenticated using (true);

drop policy if exists "buildings_insert" on crm.buildings;
create policy "buildings_insert" on crm.buildings
  for insert to authenticated with check (true);

drop policy if exists "buildings_update" on crm.buildings;
create policy "buildings_update" on crm.buildings
  for update to authenticated
  using (crm.is_admin())
  with check (true);

drop policy if exists "buildings_delete" on crm.buildings;
create policy "buildings_delete" on crm.buildings
  for delete to authenticated using (crm.is_admin());

-- ############################################################
-- ### 020_apply_all_pending.sql
-- ############################################################

-- ============================================================
-- ОДИН ФАЙЛ ВМЕСТО 014–019: безопасно выполняет всё, что нужно
-- приложению на стороне базы. Можно запускать сколько угодно раз
-- (create or replace / drop if exists / if not exists everywhere).
-- Если какие-то из 014–019 уже применялись — ничего не сломает.
-- ============================================================

-- ---------- 014: запись платежа (менеджерам, атомарно) ----------
create or replace function crm.record_payment(
  p_contract_id uuid,
  p_amount numeric,
  p_date date
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
begin
  insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
  values (p_contract_id, p_date, p_amount, true, p_date)
  returning * into v_payment;

  update crm.contracts
  set paid_amount = paid_amount + p_amount
  where id = p_contract_id;

  return v_payment;
end;
$$;

grant execute on function crm.record_payment(uuid, numeric, date) to authenticated;

-- ---------- 015/016: автоматический статус квартиры ----------
create or replace function crm.set_payment_paid(
  p_payment_id uuid,
  p_paid boolean
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
  v_delta numeric;
begin
  select * into v_payment from crm.contract_payments where id = p_payment_id;
  if not found or v_payment.paid = p_paid then
    return v_payment;
  end if;
  v_delta := case when p_paid then v_payment.amount else -v_payment.amount end;

  update crm.contract_payments
  set paid = p_paid, paid_date = case when p_paid then current_date else null end
  where id = p_payment_id
  returning * into v_payment;

  update crm.contracts
  set paid_amount = paid_amount + v_delta
  where id = v_payment.contract_id;

  return v_payment;
end;
$$;

grant execute on function crm.set_payment_paid(uuid, boolean) to authenticated;

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

create or replace function crm.sync_object_status()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  perform crm.recompute_object_status(coalesce(NEW.object_id, OLD.object_id));
  if TG_OP = 'UPDATE' and OLD.object_id is distinct from NEW.object_id then
    perform crm.recompute_object_status(OLD.object_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_object_status on crm.contracts;
create trigger trg_sync_object_status
after insert or update or delete on crm.contracts
for each row execute function crm.sync_object_status();

create or replace function crm.resync_all_object_statuses()
returns integer
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_count integer := 0;
begin
  update crm.objects o
  set status = case
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled' and c.paid_amount > 0
    ) then 'sold'
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled'
    ) then 'reserved'
    else 'available'
  end::crm.object_status
  where exists (select 1 from crm.contracts c where c.object_id = o.id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function crm.resync_all_object_statuses() to authenticated;

-- ---------- 017: удаления только админам + журнал удалений ----------
create table if not exists crm.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table crm.audit_log enable row level security;

drop policy if exists "audit_log_select_admin" on crm.audit_log;
create policy "audit_log_select_admin" on crm.audit_log
  for select to authenticated using (crm.is_admin());

create or replace function crm.log_delete()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'delete', TG_ARGV[0], OLD.id, to_jsonb(OLD));
  return OLD;
end;
$$;

drop trigger if exists trg_audit_delete_clients on crm.clients;
create trigger trg_audit_delete_clients
before delete on crm.clients
for each row execute function crm.log_delete('client');

drop trigger if exists trg_audit_delete_contracts on crm.contracts;
create trigger trg_audit_delete_contracts
before delete on crm.contracts
for each row execute function crm.log_delete('contract');

drop trigger if exists trg_audit_delete_contract_payments on crm.contract_payments;
create trigger trg_audit_delete_contract_payments
before delete on crm.contract_payments
for each row execute function crm.log_delete('contract_payment');

drop trigger if exists trg_audit_delete_objects on crm.objects;
create trigger trg_audit_delete_objects
before delete on crm.objects
for each row execute function crm.log_delete('object');

-- Auto-prune: keep only the last 14 days of the journal so it never piles up.
-- See migration 035.
create index if not exists audit_log_created_at_idx on crm.audit_log (created_at);
create or replace function crm.prune_audit_log()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  delete from crm.audit_log where created_at < now() - interval '14 days';
  return null;
end;
$$;
drop trigger if exists trg_prune_audit_log on crm.audit_log;
create trigger trg_prune_audit_log
after insert on crm.audit_log
for each statement execute function crm.prune_audit_log();

drop policy if exists "Authenticated access to clients" on crm.clients;
drop policy if exists "clients_select" on crm.clients;
drop policy if exists "clients_insert" on crm.clients;
drop policy if exists "clients_update" on crm.clients;
drop policy if exists "clients_delete" on crm.clients;
drop policy if exists "clients_select" on crm.clients;
create policy "clients_select" on crm.clients for select to authenticated using (true);
drop policy if exists "clients_insert" on crm.clients;
create policy "clients_insert" on crm.clients for insert to authenticated with check (true);
drop policy if exists "clients_update" on crm.clients;
create policy "clients_update" on crm.clients for update to authenticated using (true) with check (true);
drop policy if exists "clients_delete" on crm.clients;
create policy "clients_delete" on crm.clients for delete to authenticated using (crm.is_admin());

drop policy if exists "Authenticated access to contract_payments" on crm.contract_payments;
drop policy if exists "contract_payments_select" on crm.contract_payments;
drop policy if exists "contract_payments_insert" on crm.contract_payments;
drop policy if exists "contract_payments_update" on crm.contract_payments;
drop policy if exists "contract_payments_delete" on crm.contract_payments;
drop policy if exists "contract_payments_select" on crm.contract_payments;
create policy "contract_payments_select" on crm.contract_payments for select to authenticated using (true);
drop policy if exists "contract_payments_insert" on crm.contract_payments;
create policy "contract_payments_insert" on crm.contract_payments for insert to authenticated with check (true);
drop policy if exists "contract_payments_update" on crm.contract_payments;
create policy "contract_payments_update" on crm.contract_payments for update to authenticated using (crm.is_admin()) with check (true);
drop policy if exists "contract_payments_delete" on crm.contract_payments;
create policy "contract_payments_delete" on crm.contract_payments for delete to authenticated using (crm.is_admin());

drop policy if exists "objects_delete" on crm.objects;
create policy "objects_delete" on crm.objects for delete to authenticated using (crm.is_admin());

-- ---------- 018: отмена быстрой брони, атомарное удаление платежа,
--                 защита от двойного бронирования ----------
create or replace function crm.cancel_quick_booking(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_ok boolean;
begin
  select (cl.source = 'quick_booking' and c.paid_amount = 0)
  into v_ok
  from crm.contracts c
  join crm.clients cl on cl.id = c.client_id
  where c.id = p_contract_id;

  if not coalesce(v_ok, false) then
    raise exception 'Not an undoable quick booking';
  end if;

  delete from crm.contracts where id = p_contract_id;
end;
$$;

grant execute on function crm.cancel_quick_booking(uuid) to authenticated;

create or replace function crm.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
begin
  if not crm.is_admin() then
    raise exception 'Only an admin can delete a payment';
  end if;

  select * into v_payment from crm.contract_payments where id = p_payment_id;
  if not found then
    return;
  end if;

  delete from crm.contract_payments where id = p_payment_id;

  if v_payment.paid then
    update crm.contracts
    set paid_amount = greatest(paid_amount - v_payment.amount, 0)
    where id = v_payment.contract_id;
  end if;
end;
$$;

grant execute on function crm.delete_payment(uuid) to authenticated;

create unique index if not exists uq_contracts_object_active
  on crm.contracts (object_id)
  where status <> 'cancelled';

-- ---------- 019: настройки только админам + лимиты файлов ----------
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
where id = 'crm-media';

drop policy if exists "Allow all access to settings" on crm.settings;
drop policy if exists "Authenticated access to settings" on crm.settings;
drop policy if exists "settings_select" on crm.settings;
drop policy if exists "settings_update" on crm.settings;

drop policy if exists "settings_select" on crm.settings;
create policy "settings_select" on crm.settings
  for select to authenticated using (true);

drop policy if exists "settings_update" on crm.settings;
create policy "settings_update" on crm.settings
  for update to authenticated using (crm.is_admin()) with check (crm.is_admin());

-- ---------- финальная синхронизация статусов ----------
select crm.resync_all_object_statuses();

-- ############################################################
-- ### 021_roles_scoping_manual_reserve_audit.sql
-- ############################################################

-- ============================================================
-- 021: три вещи.
-- 1) Бронь правой кнопкой БЕЗ клиента: флаг objects.manual_reserved
--    вместо договора-заглушки с подставным клиентом.
-- 2) Роли: manager видит только назначенные ему ЖК; новая роль
--    director — видит всё, менять ничего не может.
-- 3) Журнал событий: фиксирует создание и изменение (не только
--    удаление) договоров, платежей и клиентов.
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

-- ---------- роли ----------
alter table crm.profiles drop constraint if exists profiles_role_check;
alter table crm.profiles
  add constraint profiles_role_check check (role in ('admin', 'manager', 'director'));

create or replace function crm.my_role()
returns text
language sql
security definer
set search_path = crm, public
stable
as $$
  select coalesce((select role from crm.profiles where id = auth.uid()), 'manager');
$$;

create or replace function crm.is_director()
returns boolean
language sql
security definer
set search_path = crm, public
stable
as $$
  select crm.my_role() = 'director';
$$;

-- Директор — только чтение; писать могут админ и менеджер.
create or replace function crm.can_write()
returns boolean
language sql
security definer
set search_path = crm, public
stable
as $$
  select crm.my_role() in ('admin', 'manager');
$$;

-- ---------- назначение ЖК менеджерам ----------
create table if not exists crm.manager_buildings (
  user_id uuid not null references auth.users(id) on delete cascade,
  building_id uuid not null references crm.buildings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, building_id)
);

alter table crm.manager_buildings enable row level security;

drop policy if exists "manager_buildings_select" on crm.manager_buildings;
create policy "manager_buildings_select" on crm.manager_buildings
  for select to authenticated using (crm.is_admin() or user_id = auth.uid());

drop policy if exists "manager_buildings_insert" on crm.manager_buildings;
create policy "manager_buildings_insert" on crm.manager_buildings
  for insert to authenticated with check (crm.is_admin());

drop policy if exists "manager_buildings_delete" on crm.manager_buildings;
create policy "manager_buildings_delete" on crm.manager_buildings
  for delete to authenticated using (crm.is_admin());

-- Админ и директор видят все ЖК; менеджер — только назначенные.
create or replace function crm.can_view_building(p_building_id uuid)
returns boolean
language sql
security definer
set search_path = crm, public
stable
as $$
  select case
    when crm.my_role() in ('admin', 'director') then true
    else exists (
      select 1 from crm.manager_buildings mb
      where mb.user_id = auth.uid() and mb.building_id = p_building_id
    )
  end;
$$;

-- ---------- видимость по ролям (RLS) ----------
drop policy if exists "Authenticated access to buildings" on crm.buildings;
drop policy if exists "buildings_select" on crm.buildings;
drop policy if exists "buildings_insert" on crm.buildings;
drop policy if exists "buildings_update" on crm.buildings;
drop policy if exists "buildings_delete" on crm.buildings;
drop policy if exists "buildings_select" on crm.buildings;
create policy "buildings_select" on crm.buildings
  for select to authenticated using (crm.can_view_building(id));
drop policy if exists "buildings_insert" on crm.buildings;
create policy "buildings_insert" on crm.buildings
  for insert to authenticated with check (crm.is_admin());
drop policy if exists "buildings_update" on crm.buildings;
create policy "buildings_update" on crm.buildings
  for update to authenticated using (crm.is_admin()) with check (crm.is_admin());
drop policy if exists "buildings_delete" on crm.buildings;
create policy "buildings_delete" on crm.buildings
  for delete to authenticated using (crm.is_admin());

drop policy if exists "Authenticated access to objects" on crm.objects;
drop policy if exists "objects_select" on crm.objects;
drop policy if exists "objects_insert" on crm.objects;
drop policy if exists "objects_update" on crm.objects;
drop policy if exists "objects_delete" on crm.objects;
drop policy if exists "objects_select" on crm.objects;
create policy "objects_select" on crm.objects
  for select to authenticated
  using (building_id is null or crm.can_view_building(building_id));
-- Objects are admin-only for create/edit (managers/directors can still view
-- and book them; the reservation RPC and contract triggers set status, not a
-- direct object write). See migration 032.
drop policy if exists "objects_insert" on crm.objects;
create policy "objects_insert" on crm.objects
  for insert to authenticated
  with check (
    crm.is_admin() and (building_id is null or crm.can_view_building(building_id))
  );
drop policy if exists "objects_update" on crm.objects;
create policy "objects_update" on crm.objects
  for update to authenticated
  using (
    crm.is_admin()
    and (building_id is null or crm.can_view_building(building_id))
  )
  with check (crm.is_admin());
drop policy if exists "objects_delete" on crm.objects;
create policy "objects_delete" on crm.objects
  for delete to authenticated using (crm.is_admin());

drop policy if exists "Authenticated access to contracts" on crm.contracts;
drop policy if exists "contracts_select" on crm.contracts;
drop policy if exists "contracts_insert" on crm.contracts;
drop policy if exists "contracts_update" on crm.contracts;
drop policy if exists "contracts_delete" on crm.contracts;
drop policy if exists "contracts_select" on crm.contracts;
create policy "contracts_select" on crm.contracts
  for select to authenticated
  using (
    exists (
      select 1 from crm.objects o
      where o.id = object_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );
drop policy if exists "contracts_insert" on crm.contracts;
create policy "contracts_insert" on crm.contracts
  for insert to authenticated
  with check (
    crm.can_write()
    and exists (
      select 1 from crm.objects o
      where o.id = object_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );
drop policy if exists "contracts_update" on crm.contracts;
create policy "contracts_update" on crm.contracts
  for update to authenticated using (crm.is_admin()) with check (crm.is_admin());
drop policy if exists "contracts_delete" on crm.contracts;
create policy "contracts_delete" on crm.contracts
  for delete to authenticated using (crm.is_admin());

drop policy if exists "Authenticated access to contract_payments" on crm.contract_payments;
drop policy if exists "contract_payments_select" on crm.contract_payments;
drop policy if exists "contract_payments_insert" on crm.contract_payments;
drop policy if exists "contract_payments_update" on crm.contract_payments;
drop policy if exists "contract_payments_delete" on crm.contract_payments;
drop policy if exists "contract_payments_select" on crm.contract_payments;
create policy "contract_payments_select" on crm.contract_payments
  for select to authenticated
  using (
    exists (
      select 1
      from crm.contracts c
      join crm.objects o on o.id = c.object_id
      where c.id = contract_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );
drop policy if exists "contract_payments_insert" on crm.contract_payments;
create policy "contract_payments_insert" on crm.contract_payments
  for insert to authenticated
  with check (
    crm.can_write()
    and exists (
      select 1
      from crm.contracts c
      join crm.objects o on o.id = c.object_id
      where c.id = contract_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );
drop policy if exists "contract_payments_update" on crm.contract_payments;
create policy "contract_payments_update" on crm.contract_payments
  for update to authenticated using (crm.is_admin()) with check (crm.is_admin());
drop policy if exists "contract_payments_delete" on crm.contract_payments;
create policy "contract_payments_delete" on crm.contract_payments
  for delete to authenticated using (crm.is_admin());

drop policy if exists "Authenticated access to clients" on crm.clients;
drop policy if exists "clients_select" on crm.clients;
drop policy if exists "clients_insert" on crm.clients;
drop policy if exists "clients_update" on crm.clients;
drop policy if exists "clients_delete" on crm.clients;
drop policy if exists "clients_select" on crm.clients;
create policy "clients_select" on crm.clients
  for select to authenticated using (true);
drop policy if exists "clients_insert" on crm.clients;
create policy "clients_insert" on crm.clients
  for insert to authenticated with check (crm.can_write());
drop policy if exists "clients_update" on crm.clients;
create policy "clients_update" on crm.clients
  for update to authenticated using (crm.can_write()) with check (crm.can_write());
drop policy if exists "clients_delete" on crm.clients;
create policy "clients_delete" on crm.clients
  for delete to authenticated using (crm.is_admin());

-- ---------- бронь без клиента ----------
alter table crm.objects add column if not exists manual_reserved boolean not null default false;

-- Статус теперь учитывает и ручную бронь (без договора).
create or replace function crm.recompute_object_status(p_object_id uuid)
returns void
language sql
security definer
set search_path = crm, public
as $$
  update crm.objects o
  set status = case
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled' and c.paid_amount > 0
    ) then 'sold'
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled'
    ) then 'reserved'
    when o.manual_reserved then 'reserved'
    else 'available'
  end::crm.object_status
  where o.id = p_object_id;
$$;

create or replace function crm.sync_object_status()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  -- A real contract supersedes a hand-set reservation: once the deal is
  -- drafted, the unit's fate follows the contract, and cancelling that
  -- contract must free the unit rather than fall back to a stale flag.
  if TG_OP = 'INSERT' then
    update crm.objects set manual_reserved = false
    where id = NEW.object_id and manual_reserved;
  end if;

  perform crm.recompute_object_status(coalesce(NEW.object_id, OLD.object_id));
  if TG_OP = 'UPDATE' and OLD.object_id is distinct from NEW.object_id then
    perform crm.recompute_object_status(OLD.object_id);
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_sync_object_status on crm.contracts;
create trigger trg_sync_object_status
after insert or update or delete on crm.contracts
for each row execute function crm.sync_object_status();

create or replace function crm.resync_all_object_statuses()
returns integer
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_count integer := 0;
begin
  update crm.objects o
  set status = case
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled' and c.paid_amount > 0
    ) then 'sold'
    when exists (
      select 1 from crm.contracts c
      where c.object_id = o.id and c.status <> 'cancelled'
    ) then 'reserved'
    when o.manual_reserved then 'reserved'
    else 'available'
  end::crm.object_status
  where o.manual_reserved
     or exists (select 1 from crm.contracts c where c.object_id = o.id);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function crm.resync_all_object_statuses() to authenticated;

-- ПКМ по свободной квартире ставит бронь, повторный ПКМ снимает.
-- Никакого клиента и договора не создаётся.
create or replace function crm.toggle_manual_reservation(p_object_id uuid)
returns boolean
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_building uuid;
  v_new boolean;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;

  select building_id into v_building from crm.objects where id = p_object_id;
  if not found then
    raise exception 'Object not found';
  end if;
  if v_building is not null and not crm.can_view_building(v_building) then
    raise exception 'Building not allowed for this user';
  end if;

  -- A unit whose state is driven by a live contract can't be hand-toggled.
  if exists (
    select 1 from crm.contracts c
    where c.object_id = p_object_id and c.status <> 'cancelled'
  ) then
    raise exception 'Unit is managed by a contract';
  end if;

  update crm.objects
  set manual_reserved = not manual_reserved
  where id = p_object_id
  returning manual_reserved into v_new;

  perform crm.recompute_object_status(p_object_id);
  return v_new;
end;
$$;

grant execute on function crm.toggle_manual_reservation(uuid) to authenticated;

-- ---------- директор: только чтение и в обход RPC ----------
create or replace function crm.record_payment(
  p_contract_id uuid,
  p_amount numeric,
  p_date date
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;
  if not exists (
    select 1
    from crm.contracts c
    join crm.objects o on o.id = c.object_id
    where c.id = p_contract_id
      and (o.building_id is null or crm.can_view_building(o.building_id))
  ) then
    raise exception 'Contract not allowed for this user';
  end if;

  insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
  values (p_contract_id, p_date, p_amount, true, p_date)
  returning * into v_payment;

  update crm.contracts
  set paid_amount = paid_amount + p_amount
  where id = p_contract_id;

  return v_payment;
end;
$$;

create or replace function crm.set_payment_paid(
  p_payment_id uuid,
  p_paid boolean
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
  v_delta numeric;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;

  select * into v_payment from crm.contract_payments where id = p_payment_id;
  if not found or v_payment.paid = p_paid then
    return v_payment;
  end if;
  v_delta := case when p_paid then v_payment.amount else -v_payment.amount end;

  update crm.contract_payments
  set paid = p_paid, paid_date = case when p_paid then current_date else null end
  where id = p_payment_id
  returning * into v_payment;

  update crm.contracts
  set paid_amount = paid_amount + v_delta
  where id = v_payment.contract_id;

  return v_payment;
end;
$$;

create or replace function crm.cancel_quick_booking(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_ok boolean;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;

  select (cl.source = 'quick_booking' and c.paid_amount = 0)
  into v_ok
  from crm.contracts c
  join crm.clients cl on cl.id = c.client_id
  where c.id = p_contract_id;

  if not coalesce(v_ok, false) then
    raise exception 'Not an undoable quick booking';
  end if;

  delete from crm.contracts where id = p_contract_id;
end;
$$;

-- ---------- журнал: создание и изменение, не только удаление ----------
create or replace function crm.log_change()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_diff jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'create', TG_ARGV[0], NEW.id, to_jsonb(NEW));
    return NEW;
  end if;

  -- UPDATE: only the fields that actually changed, old -> new, so the log
  -- reads as "what happened" instead of two full row dumps.
  select coalesce(
    jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)),
    '{}'::jsonb
  )
  into v_diff
  from jsonb_each(to_jsonb(NEW)) n
  join jsonb_each(to_jsonb(OLD)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at');

  if v_diff <> '{}'::jsonb then
    insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
    values (auth.uid(), 'update', TG_ARGV[0], NEW.id, v_diff);
  end if;
  return NEW;
end;
$$;

-- Более ранний вариант этого файла ставил триггеры с другими именами;
-- убираем их, иначе оба набора сработают и журнал задвоится.
drop trigger if exists trg_log_change_contracts on crm.contracts;
drop trigger if exists trg_log_change_contract_payments on crm.contract_payments;
drop trigger if exists trg_log_change_clients on crm.clients;

drop trigger if exists trg_audit_change_contracts on crm.contracts;
create trigger trg_audit_change_contracts
after insert or update on crm.contracts
for each row execute function crm.log_change('contract');

drop trigger if exists trg_audit_change_contract_payments on crm.contract_payments;
create trigger trg_audit_change_contract_payments
after insert or update on crm.contract_payments
for each row execute function crm.log_change('contract_payment');

drop trigger if exists trg_audit_change_clients on crm.clients;
create trigger trg_audit_change_clients
after insert or update on crm.clients
for each row execute function crm.log_change('client');

-- ---------- пересборка графика рассрочки из остатка ----------
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

  update crm.contracts
  set installment_months = p_months, payment_type = 'installment'
  where id = p_contract_id;

  return p_months;
end;
$$;

grant execute on function crm.regenerate_schedule(uuid, integer) to authenticated;

-- Пересозданные выше функции наследуют старые grant-ы, но если 020 в этой
-- базе так и не выполнился, их никто не выдавал — проставим явно.
grant execute on function crm.record_payment(uuid, numeric, date) to authenticated;
grant execute on function crm.set_payment_paid(uuid, boolean) to authenticated;
grant execute on function crm.cancel_quick_booking(uuid) to authenticated;

-- финальная синхронизация статусов
select crm.resync_all_object_statuses();

-- ############################################################
-- ### 022_lock_out_strangers.sql
-- ############################################################

-- ============================================================
-- 022: посторонний с аккаунтом = никто.
--
-- Дыра: crm.my_role() возвращал 'manager' для любого вошедшего
-- пользователя БЕЗ строки в crm.profiles. Если в Supabase включена
-- самостоятельная регистрация (по умолчанию включена), чужак мог
-- зарегистрироваться напрямую через API и сразу получить права
-- менеджера: видеть всех клиентов и писать в базу.
--
-- Исправление: нет строки в profiles — роль 'none', то есть ничего
-- не видно и ничего нельзя. Роль выдаёт только админ (страница
-- «Сотрудники» создаёт profiles через service-ключ).
--
-- ВАЖНО: дополнительно отключите самостоятельную регистрацию в
-- Supabase Dashboard → Authentication → Sign In / Providers →
-- "Allow new users to sign up" → OFF. Аккаунты создаёт только админ.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

create or replace function crm.my_role()
returns text
language sql
security definer
set search_path = crm, public
stable
as $$
  select coalesce((select role from crm.profiles where id = auth.uid()), 'none');
$$;

-- Есть ли у пользователя вообще какая-то роль в системе.
create or replace function crm.has_role()
returns boolean
language sql
security definer
set search_path = crm, public
stable
as $$
  select crm.my_role() in ('admin', 'manager', 'director');
$$;

-- Клиенты: раньше select был using(true) — любой аутентифицированный
-- видел всю клиентскую базу. Теперь только сотрудники.
drop policy if exists "clients_select" on crm.clients;
create policy "clients_select" on crm.clients
  for select to authenticated using (crm.has_role());

-- Квартиры/договоры/платежи: политики уже завязаны на can_view_building,
-- но ветка "building_id is null" была видна всем аутентифицированным.
-- Добавляем общий ролевой замок.
drop policy if exists "objects_select" on crm.objects;
create policy "objects_select" on crm.objects
  for select to authenticated
  using (
    crm.has_role() and (building_id is null or crm.can_view_building(building_id))
  );

drop policy if exists "contracts_select" on crm.contracts;
create policy "contracts_select" on crm.contracts
  for select to authenticated
  using (
    crm.has_role()
    and exists (
      select 1 from crm.objects o
      where o.id = object_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );

drop policy if exists "contract_payments_select" on crm.contract_payments;
create policy "contract_payments_select" on crm.contract_payments
  for select to authenticated
  using (
    crm.has_role()
    and exists (
      select 1
      from crm.contracts c
      join crm.objects o on o.id = c.object_id
      where c.id = contract_id
        and (o.building_id is null or crm.can_view_building(o.building_id))
    )
  );

-- Задачи и настройки: были открыты любому аутентифицированному.
drop policy if exists "Authenticated access to tasks" on crm.tasks;
drop policy if exists "tasks_all" on crm.tasks;
create policy "tasks_all" on crm.tasks
  for all to authenticated using (crm.has_role()) with check (crm.can_write());

drop policy if exists "settings_select" on crm.settings;
create policy "settings_select" on crm.settings
  for select to authenticated using (crm.has_role());

-- ############################################################
-- ### 023_delete_client_cascade.sql
-- ############################################################

-- ============================================================
-- 023: каскадное удаление клиента админом.
--
-- Обычное удаление клиента заблокировано, если у него есть договоры
-- (и это правильно). Этот RPC — осознанное действие админа: удаляет
-- клиента ВМЕСТЕ со всеми его договорами и платежами, одной
-- транзакцией. Роль проверяется здесь, в базе, а не в браузере.
--
-- Каждая удалённая строка попадает в журнал событий (audit_log)
-- через существующие триггеры log_delete, так что «что именно
-- удалили» восстановимо из журнала. Статусы квартир пересчитаются
-- сами: триггер на удаление договора уже это делает.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

create or replace function crm.delete_client_cascade(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_contracts integer := 0;
  v_payments integer := 0;
begin
  if not crm.is_admin() then
    raise exception 'Только администратор может удалять клиентов';
  end if;

  delete from crm.contract_payments cp
  using crm.contracts c
  where cp.contract_id = c.id and c.client_id = p_client_id;
  get diagnostics v_payments = row_count;

  delete from crm.contracts where client_id = p_client_id;
  get diagnostics v_contracts = row_count;

  delete from crm.clients where id = p_client_id;

  return jsonb_build_object('contracts', v_contracts, 'payments', v_payments);
end;
$$;

grant execute on function crm.delete_client_cascade(uuid) to authenticated;

-- ############################################################
-- ### 024_performance_indexes.sql
-- ############################################################

-- ============================================================
-- 024: индексы под реальные запросы приложения.
--
-- Все списки в приложении уже пагинированы (по 25 строк), но без
-- индексов Postgres всё равно перебирает таблицы целиком при каждом
-- фильтре. Эти индексы покрывают ровно те запросы, которые страницы
-- делают постоянно:
--   контракты по клиенту (карточка клиента, колонка долга в списке),
--   контракты по квартире (шахматка),
--   платежи по договору (графики, расиды),
--   квартиры по зданию (шахматка),
--   журнал по дате (страница журнала),
--   клиенты по дате создания (список клиентов).
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

create index if not exists idx_contracts_client_id on crm.contracts (client_id);
create index if not exists idx_contracts_object_id on crm.contracts (object_id);
create index if not exists idx_contract_payments_contract_id
  on crm.contract_payments (contract_id);
create index if not exists idx_objects_building_id on crm.objects (building_id);
create index if not exists idx_audit_log_created_at
  on crm.audit_log (created_at desc);
create index if not exists idx_clients_created_at on crm.clients (created_at desc);
-- Поиск клиентов по имени/телефону идёт через ilike '%…%' -- обычный
-- btree тут не помогает, нужен триграммный.
create extension if not exists pg_trgm;
create index if not exists idx_clients_name_trgm
  on crm.clients using gin (name gin_trgm_ops);
create index if not exists idx_clients_phone_trgm
  on crm.clients using gin (phone gin_trgm_ops);

-- ############################################################
-- ### 025_validate_payment_amounts.sql
-- ############################################################

-- ============================================================
-- 025: платёж не может быть нулевым или отрицательным.
--
-- record_payment принимал любую сумму: отрицательный «платёж» тихо
-- уменьшал paid_amount договора — касса и график разошлись бы, а в
-- истории лежала бы строка с минусом. Теперь база отвергает такие
-- вызовы независимо от того, что прислал интерфейс.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

create or replace function crm.record_payment(
  p_contract_id uuid,
  p_amount numeric,
  p_date date
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if p_date is null then
    raise exception 'Не указана дата платежа';
  end if;
  if not exists (
    select 1
    from crm.contracts c
    join crm.objects o on o.id = c.object_id
    where c.id = p_contract_id
      and (o.building_id is null or crm.can_view_building(o.building_id))
  ) then
    raise exception 'Contract not allowed for this user';
  end if;

  insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
  values (p_contract_id, p_date, p_amount, true, p_date)
  returning * into v_payment;

  update crm.contracts
  set paid_amount = paid_amount + p_amount
  where id = p_contract_id;

  return v_payment;
end;
$$;

grant execute on function crm.record_payment(uuid, numeric, date) to authenticated;

-- Страховка на уровне таблицы: строка платежа с суммой <= 0 не может
-- появиться вообще, каким бы путём её ни вставляли.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_contract_payments_amount_positive'
  ) then
    -- not valid: не проверяет старые строки (вдруг там уже есть мусор --
    -- его чинят руками), но блокирует любые новые.
    alter table crm.contract_payments
      add constraint chk_contract_payments_amount_positive
      check (amount > 0) not valid;
  end if;
end $$;

-- ############################################################
-- ### 026_public_branding.sql
-- ############################################################

-- ============================================================
-- 026: название и логотип компании для страницы входа.
--
-- Настройки целиком (реквизиты, шаблоны SMS) читают только сотрудники
-- (022), но страница входа показывается ДО входа — ей нужно название
-- и логотип. Эта функция отдаёт только эти два поля и ничего больше,
-- поэтому её можно открыть анонимным без риска.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

-- Returns the company hero theme/pattern too, so the pre-auth login page can
-- paint itself in the company theme. See migration 034. DROP first because the
-- return type changed (name+logo -> +theme+pattern).
drop function if exists crm.public_branding();

create or replace function crm.public_branding()
returns table (company_name text, company_logo_url text, hero_theme text, hero_pattern text)
language sql
security definer
set search_path = crm, public
stable
as $$
  select s.company_name, s.company_logo_url, s.hero_theme, s.hero_pattern
  from crm.settings s
  limit 1;
$$;

grant execute on function crm.public_branding() to anon, authenticated;

-- ############################################################
-- ### 027_first_user_is_admin.sql
-- ############################################################

-- ============================================================
-- 027: первый пользователь автоматически становится админом.
--
-- Раньше после создания базы приходилось вручную выполнять SQL,
-- чтобы выдать первому аккаунту роль admin (курица и яйцо: админов
-- ещё нет, а роли выдаёт админ). Теперь: если в системе ещё НЕТ ни
-- одного админа, первый созданный пользователь получает роль admin
-- сам. Все последующие пользователи роли НЕ получают — их создаёт
-- админ со страницы «Сотрудники».
--
-- Безопасность: правило срабатывает только пока админов ноль, то
-- есть ровно один раз за жизнь базы. Но самостоятельную регистрацию
-- всё равно нужно держать выключенной (Authentication → Sign In /
-- Providers → Allow new users to sign up → OFF) — это правило
-- «первый = админ» и открытая регистрация вместе означали бы гонку
-- за первое место.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

create or replace function crm.grant_admin_to_first_user()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if not exists (select 1 from crm.profiles where role = 'admin') then
    insert into crm.profiles (id, role)
    values (new.id, 'admin')
    on conflict (id) do update set role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_first_user_is_admin on auth.users;
create trigger trg_first_user_is_admin
after insert on auth.users
for each row execute function crm.grant_admin_to_first_user();

-- Если база уже существует и в ней ровно один пользователь без роли
-- (типичная картина свежей установки) — сделать его админом сейчас.
do $$
declare
  v_only_user uuid;
begin
  if not exists (select 1 from crm.profiles where role = 'admin') then
    select id into v_only_user from auth.users
    order by created_at asc limit 1;
    if v_only_user is not null then
      insert into crm.profiles (id, role)
      values (v_only_user, 'admin')
      on conflict (id) do update set role = 'admin';
    end if;
  end if;
end $$;

-- ############################################################
-- ### 028_staff_management_no_service_key.sql
-- ############################################################

-- ============================================================
-- 028: управление сотрудниками БЕЗ service-ключа.
--
-- Раньше страница «Сотрудники» ходила в серверный API с секретным
-- ключом (SUPABASE_SERVICE_ROLE_KEY). Любая ошибка этого ключа на
-- Vercel ломала всю страницу целиком — нельзя было даже увидеть
-- список.
--
-- Теперь список пользователей и выдача ролей работают через обычные
-- RPC прямо в базе (SECURITY DEFINER, доступ только админу). Никакого
-- секретного ключа не нужно — всё как с остальными данными
-- программы. Новый порядок:
--   1) админ создаёт пользователя в Supabase → Authentication → Users;
--   2) он сам появляется в списке на странице «Сотрудники»;
--   3) админ ставит ему роль и объекты прямо в программе.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

-- Список всех пользователей с их ролью (роль 'none' — если ещё не
-- назначена). Только для админа. Функция выполняется от владельца БД,
-- поэтому может читать auth.users, недоступную обычному ключу.
create or replace function crm.list_staff()
returns table (id uuid, email text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = crm, public
stable
as $$
begin
  if not crm.is_admin() then
    raise exception 'Только администратор может видеть список сотрудников';
  end if;
  return query
    select u.id,
           u.email::text,
           coalesce(p.role, 'none') as role,
           u.created_at
    from auth.users u
    left join crm.profiles p on p.id = u.id
    order by u.created_at asc;
end;
$$;

grant execute on function crm.list_staff() to authenticated;

-- Выдать/сменить роль. 'none' = убрать доступ (удалить строку роли).
-- Только для админа. Себя понизить нельзя — иначе можно случайно
-- остаться без единого админа.
create or replace function crm.set_user_role(p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if not crm.is_admin() then
    raise exception 'Только администратор может менять роли';
  end if;
  if p_role not in ('admin', 'manager', 'director', 'none') then
    raise exception 'Неизвестная роль: %', p_role;
  end if;
  if p_user = auth.uid() and p_role <> 'admin' then
    raise exception 'Нельзя снять роль администратора с самого себя';
  end if;

  if p_role = 'none' then
    delete from crm.profiles where id = p_user;
  else
    insert into crm.profiles (id, role)
    values (p_user, p_role)
    on conflict (id) do update set role = excluded.role;
  end if;
end;
$$;

grant execute on function crm.set_user_role(uuid, text) to authenticated;

-- ############################################################
-- ### 029_seed_admin.sql
-- ############################################################

-- ============================================================
-- 029: готовый аккаунт администратора прямо из SQL.
--
-- Больше НИКАКОЙ возни с созданием пользователей в дашборде,
-- подтверждением почты и "не тот проект". Выполнили этот файл —
-- сразу есть рабочий вход:
--
--     Email:  admin@crm.tj
--     Пароль: Admin12345
--
-- ПОСЛЕ ПЕРВОГО ВХОДА ОБЯЗАТЕЛЬНО СМЕНИТЕ ПАРОЛЬ в программе:
-- Настройки → «Сменить пароль».
--
-- Заодно, если в базе уже есть аккаунт iammirzozoda@gmail.com,
-- который не пускал, — этот файл чинит его: подтверждает почту и
-- делает админом.
--
-- Файл идемпотентный — можно запускать повторно. ВАЖНО (блок 057):
-- пароль задаётся только при первом создании аккаунта. Если аккаунт уже
-- есть, повторный запуск больше НЕ переписывает его пароль обратно на
-- Admin12345 -- раньше переписывал, из-за чего смена пароля в Настройках
-- выглядела так, будто она "не сохраняется": она сохранялась, но
-- следующий же прогон этого файла (а его просят запускать при каждой
-- новой миграции) тихо возвращал старый пароль. Забыли пароль по-настоящему
-- -- меняйте его как у любого пользователя: Supabase → Authentication →
-- Users → выбрать аккаунт → задать новый пароль.
-- ============================================================

-- crypt() / gen_salt() для хеша пароля.
create extension if not exists pgcrypto;

-- Универсальная процедура: создать аккаунт с паролем, если его нет,
-- либо починить существующий (пароль + подтверждение почты), и в любом
-- случае выдать роль admin.
create or replace function crm.ensure_admin(p_email text, p_password text)
returns void
language plpgsql
security definer
-- extensions: там в Supabase живут crypt()/gen_salt() из pgcrypto.
set search_path = auth, crm, public, extensions
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where email = p_email;

  if v_uid is null then
    v_uid := gen_random_uuid();
    -- ВАЖНО: служебные token-поля задаём пустой строкой, а не оставляем
    -- NULL. Иначе при входе GoTrue (сервис авторизации Supabase) не может
    -- прочитать строку и падает с "Database error querying schema".
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid,
      'authenticated', 'authenticated', p_email,
      crypt(p_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (
      provider_id, user_id, identity_data, provider, created_at, updated_at
    ) values (
      v_uid::text, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', p_email),
      'email', now(), now()
    );
  else
    -- Чиним уже созданный аккаунт: подтверждение почты и те же token-поля,
    -- если они остались NULL от прежней SQL-вставки. Пароль здесь
    -- НАМЕРЕННО не трогается (блок 057) -- иначе каждый повторный запуск
    -- этого файла тихо возвращал бы пароль, честно изменённый через
    -- Настройки, обратно на Admin12345.
    update auth.users
       set email_confirmed_at = coalesce(email_confirmed_at, now()),
           confirmation_token = coalesce(confirmation_token, ''),
           recovery_token = coalesce(recovery_token, ''),
           email_change_token_new = coalesce(email_change_token_new, ''),
           email_change = coalesce(email_change, ''),
           email_change_token_current = coalesce(email_change_token_current, ''),
           phone_change = coalesce(phone_change, ''),
           phone_change_token = coalesce(phone_change_token, ''),
           reauthentication_token = coalesce(reauthentication_token, ''),
           updated_at = now()
     where id = v_uid;
    if not exists (
      select 1 from auth.identities where user_id = v_uid and provider = 'email'
    ) then
      insert into auth.identities (
        provider_id, user_id, identity_data, provider, created_at, updated_at
      ) values (
        v_uid::text, v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', p_email),
        'email', now(), now()
      );
    end if;
  end if;

  insert into crm.profiles (id, role)
  values (v_uid, 'admin')
  on conflict (id) do update set role = 'admin';
end;
$$;

-- КРИТИЧНО: функция умеет назначать админа, поэтому её нельзя вызывать
-- никому, кроме самой базы. По умолчанию Postgres разрешает EXECUTE всем
-- (PUBLIC) — иначе любой аноним через API сделал бы себя админом. Отзываем.
revoke all on function crm.ensure_admin(text, text) from public;
revoke all on function crm.ensure_admin(text, text) from anon;
revoke all on function crm.ensure_admin(text, text) from authenticated;

-- Готовый вход "из коробки".
select crm.ensure_admin('admin@crm.tj', 'Admin12345');

-- Чиним/поднимаем ваш личный аккаунт, если он был заведён раньше.
select crm.ensure_admin('iammirzozoda@gmail.com', 'Admin12345');

-- ############################################################
-- ### 030_sales_by_manager.sql
-- ############################################################

-- ============================================================
-- 030: продажи по менеджерам.
--
-- 1) В договоре появляется поле created_by — кто оформил сделку.
--    Заполняется САМО при создании (триггер ставит текущего
--    пользователя), менять ввод в программе не нужно. Старые договоры
--    останутся без менеджера ("Без менеджера" в отчёте).
-- 2) RPC crm.sales_by_manager() — сводка для дашборда: по каждому
--    менеджеру число сделок, сумма договоров и сколько оплачено, в
--    разрезе валют. Только админ и директор.
--
-- Файл идемпотентный — можно запускать повторно.
-- ============================================================

alter table crm.contracts
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Проставлять автора при вставке (все пути создания договора идут от
-- имени вошедшего пользователя).
create or replace function crm.set_contract_creator()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_contract_creator on crm.contracts;
create trigger trg_set_contract_creator
before insert on crm.contracts
for each row execute function crm.set_contract_creator();

-- Сводка продаж по менеджерам. Читает auth.users (email), поэтому
-- SECURITY DEFINER и только для админа/директора.
create or replace function crm.sales_by_manager()
returns table (
  manager text,
  currency text,
  contracts bigint,
  total numeric,
  paid numeric
)
language plpgsql
security definer
set search_path = crm, public, auth
stable
as $$
begin
  if not (crm.is_admin() or crm.is_director()) then
    raise exception 'Доступно только администратору и директору';
  end if;
  return query
    select
      coalesce(u.email::text, 'Без менеджера') as manager,
      c.currency::text as currency,
      count(*)::bigint as contracts,
      sum(c.amount) as total,
      sum(least(c.paid_amount, c.amount)) as paid
    from crm.contracts c
    left join auth.users u on u.id = c.created_by
    where c.status <> 'cancelled'
    group by 1, 2
    order by 4 desc nulls last;
end;
$$;

grant execute on function crm.sales_by_manager() to authenticated;

-- ############################################################
-- ### 031_office_type.sql
-- ############################################################

-- ============================================================
-- 031: тип помещения «Офис».
--
-- Для смешанных зданий (1 этаж — магазин, 2 этаж — офисы, выше —
-- квартиры) не хватало отдельного типа «офис». Добавляем в enum.
-- 'parking' добавлен ещё в 007 — здесь на всякий случай тоже с
-- IF NOT EXISTS, если база очень старая.
--
-- Файл идемпотентный.
-- ============================================================

alter type crm.object_type add value if not exists 'office';
alter type crm.object_type add value if not exists 'parking';

-- ############################################################
-- ### 037_sales_by_manager_period.sql
-- ############################################################

-- ============================================================
-- 037: «Продажи по менеджерам» — фильтр по периоду.
--
-- crm.sales_by_manager() пересоздаётся с двумя необязательными
-- параметрами (p_from, p_to по signed_date). При NULL ведёт себя как
-- раньше -- без фильтра, вся история. Старая версия без аргументов
-- удаляется явно: иначе Postgres считает вызов sales_by_manager() без
-- скобочных аргументов неоднозначным (обе сигнатуры подходят, у новой
-- ведь оба параметра со значением по умолчанию).
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

drop function if exists crm.sales_by_manager();

create or replace function crm.sales_by_manager(p_from date default null, p_to date default null)
returns table (
  manager text,
  currency text,
  contracts bigint,
  total numeric,
  paid numeric
)
language plpgsql
security definer
set search_path = crm, public, auth
stable
as $$
begin
  if not (crm.is_admin() or crm.is_director()) then
    raise exception 'Доступно только администратору и директору';
  end if;
  return query
    select
      coalesce(u.email::text, 'Без менеджера') as manager,
      c.currency::text as currency,
      count(*)::bigint as contracts,
      sum(c.amount) as total,
      sum(least(c.paid_amount, c.amount)) as paid
    from crm.contracts c
    left join auth.users u on u.id = c.created_by
    where c.status <> 'cancelled'
      and (p_from is null or c.signed_date >= p_from)
      and (p_to is null or c.signed_date <= p_to)
    group by 1, 2
    order by 4 desc nulls last;
end;
$$;

grant execute on function crm.sales_by_manager(date, date) to authenticated;

-- ############################################################
-- ### 032_objects_admin_only.sql
-- ############################################################

-- Objects (property units) become admin-only for create and edit, matching
-- buildings. Managers/directors can still SELECT them, book them (contracts +
-- the SECURITY DEFINER reservation RPC set the unit's status, not a direct
-- object write), and record payments -- but they can no longer add, rename,
-- reprice, or restructure a unit. Delete was already admin-only.

drop policy if exists "objects_insert" on crm.objects;
drop policy if exists "objects_update" on crm.objects;

drop policy if exists "objects_insert" on crm.objects;
create policy "objects_insert" on crm.objects
  for insert to authenticated
  with check (
    crm.is_admin() and (building_id is null or crm.can_view_building(building_id))
  );

drop policy if exists "objects_update" on crm.objects;
create policy "objects_update" on crm.objects
  for update to authenticated
  using (
    crm.is_admin()
    and (building_id is null or crm.can_view_building(building_id))
  )
  with check (crm.is_admin());

-- ############################################################
-- ### 033_hero_theme_settings.sql
-- ############################################################

-- Company-wide dashboard hero look. The admin picks a colour theme and an
-- ornament pattern in Settings; it applies for everyone who hasn't set a
-- personal (device-local) override. Nullable text -- null means the built-in
-- default ("atlas" / no pattern). Settings updates are already admin-only.

alter table crm.settings add column if not exists hero_theme text;
alter table crm.settings add column if not exists hero_pattern text;

-- ############################################################
-- ### 034_public_branding_theme.sql
-- ############################################################

-- Expose the company hero theme/pattern through the anon public_branding RPC,
-- so the LOGIN page (pre-auth, no session) can paint itself in the company's
-- chosen theme instead of the default plum. Only these four non-sensitive
-- fields are returned; nothing else from settings.
--
-- DROP first: Postgres refuses to change a function's return type via CREATE
-- OR REPLACE (the old signature returned only name+logo).
drop function if exists crm.public_branding();

create or replace function crm.public_branding()
returns table (
  company_name text,
  company_logo_url text,
  hero_theme text,
  hero_pattern text
)
language sql
security definer
set search_path = crm, public
stable
as $$
  select s.company_name, s.company_logo_url, s.hero_theme, s.hero_pattern
  from crm.settings s
  limit 1;
$$;

grant execute on function crm.public_branding() to anon, authenticated;

-- ############################################################
-- ### 035_prune_audit_log.sql
-- ############################################################

-- Keep the event journal from growing forever. Entries older than 14 days are
-- pruned automatically, triggered whenever a new event is logged (statement
-- level, so it runs once per insert, not per row). An index on created_at
-- keeps both the prune and the newest-first listing fast.
create index if not exists audit_log_created_at_idx on crm.audit_log (created_at);

create or replace function crm.prune_audit_log()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  delete from crm.audit_log where created_at < now() - interval '14 days';
  return null;
end;
$$;

drop trigger if exists trg_prune_audit_log on crm.audit_log;
create trigger trg_prune_audit_log
after insert on crm.audit_log
for each statement execute function crm.prune_audit_log();

-- ############################################################
-- ### 036_building_construction_status.sql
-- ############################################################

-- Construction-stage tracking for a building/ЖК: planning (нет ещё продаж),
-- in_progress (стройка идёт, актуально для дашборда), completed (сдан --
-- его данные больше не тянут общую статистику дашборда, а сворачиваются в
-- одну сжатую строку). Idempotent: safe to run on a database that already
-- has this column.
alter table crm.buildings
  add column if not exists construction_status text not null default 'in_progress';

alter table crm.buildings
  drop constraint if exists buildings_construction_status_check;

alter table crm.buildings
  add constraint buildings_construction_status_check
  check (construction_status in ('planning', 'in_progress', 'completed'));

-- ############################################################
-- ### 038_dashboard_summary.sql
-- ############################################################

-- ============================================================
-- 038: crm.dashboard_summary() — весь дашборд одним запросом,
--      посчитанным в базе.
--
-- ЗАЧЕМ. Дашборд тянул crm.objects, crm.contracts и crm.contract_payments
-- ЦЕЛИКОМ в браузер и складывал суммы в JavaScript. Пока объектов пара
-- сотен, это просто медленно. Но PostgREST по умолчанию отдаёт максимум
-- 1000 строк на запрос -- и как только объектов (или договоров, или
-- платежей) станет больше тысячи, лишние строки молча отбрасываются.
-- Ошибки при этом НЕ будет: площади, выручка, долги и заполняемость
-- просто начнут показывать неправду. Считать надо в SQL -- Postgres
-- агрегирует по индексам и отдаёт десяток чисел вместо десятков тысяч
-- строк.
--
-- БЕЗОПАСНОСТЬ. Функция намеренно SECURITY INVOKER (в отличие от
-- crm.sales_by_manager, которая definer + явная проверка роли). Дашборд
-- открыт всем сотрудникам, а видимость данных у менеджера ограничена
-- назначенными ему ЖК через RLS (crm.can_view_building). SECURITY
-- DEFINER обошёл бы эти политики и показал бы менеджеру цифры по всей
-- компании. С invoker политики применяются как обычно, поэтому функция
-- возвращает ровно тот же срез данных, который пользователь и так мог
-- бы прочитать сам. Пользователю без роли RLS не отдаст ничего -- он
-- увидит нули.
--
-- ПАРАМЕТРЫ.
--   p_building_id — NULL: все ЖК, кроме сданных ('completed'); иначе
--                   только этот ЖК (в том числе если он сдан).
--   p_from/p_to   — отчётный период по дате подписания договора. NULL =
--                   вся история. Период влияет только на «денежные»
--                   цифры (выручка, долг, должники, выручка по ЖК) --
--                   остатки на складе (количества, площади, заполняемость)
--                   и просрочка периодом не режутся, ровно как и раньше
--                   в интерфейсе.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
-- Квартиры/помещения в области видимости фильтра. Объект без ЖК
-- (building_id is null) остаётся в общей картине: он ничей, но он есть.
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
-- Договоры на эти объекты. building_id тащим с собой, чтобы разложить
-- выручку по ЖК без второго join'а.
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
-- Действующие договоры внутри отчётного периода: основа всех денежных
-- цифр. Расторгнутые не считаются нигде.
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
-- ЖК, попадающие в разрезы «заполняемость» и «выручка по ЖК».
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                    as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0) as area_available,
    -- Потенциал = прайс ещё не проданного.
    coalesce(sum(price) filter (where status = 'available' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status = 'available' and currency  = 'USD'), 0) as pot_usd
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    -- greatest(...,0): переплата по одному договору не должна гасить
    -- долг по другому.
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
-- Просрочка: неоплаченные взносы, срок которых уже прошёл. Периодом не
-- режется -- долг просрочен независимо от того, какой период смотрят.
overdue as (
  select
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.contract_payments p
  join scoped_contracts c on c.id = p.contract_id
  where not p.paid
    and p.due_date < current_date
    and c.status <> 'cancelled'
),
-- График по месяцам: последние 6 месяцев, в которых вообще были
-- подписания. Периодом не режется -- это тренд, а не отчёт.
month_rev as (
  select
    to_char(signed_date, 'YYYY-MM')                            as month,
    coalesce(sum(amount) filter (where currency <> 'USD'), 0)  as tjs,
    coalesce(sum(amount) filter (where currency  = 'USD'), 0)  as usd
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
  group by 1
  order by 1 desc
  limit 6
),
-- График по дням: фактически принятые деньги за выбранный период.
-- Считается только когда период задан (в интерфейсе — «сегодня»/«месяц»).
day_rev as (
  select
    p.paid_date                                                 as day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.contract_payments p
  join scoped_contracts c on c.id = p.contract_id
  where p.paid
    and p.paid_date is not null
    and p_from is not null
    and p_to is not null
    and p.paid_date between p_from and p_to
  group by 1
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
-- Сданные ЖК свёрнуты в одну строку «столько-то домов, столько-то
-- квартир» -- их цифры не должны перевешивать текущие продажи.
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- Индексы под ровно эти агрегаты. Без них Postgres читает таблицы
-- целиком на каждое открытие дашборда -- на больших объёмах это ровно та
-- же медленная страница, только медленная уже на сервере.
--
-- Договоры группируются по месяцу подписания и раскладываются по ЖК:
create index if not exists idx_contracts_signed_date on crm.contracts (signed_date);
-- Просрочка ищет неоплаченные взносы с истёкшим сроком, дневная выручка --
-- оплаченные по дате оплаты. Частичные индексы: по каждому флагу идёт
-- ровно один из двух запросов, и оба они узкие.
create index if not exists idx_contract_payments_unpaid_due
  on crm.contract_payments (due_date) where not paid;
create index if not exists idx_contract_payments_paid_date
  on crm.contract_payments (paid_date) where paid;
-- Срез «квартиры этого ЖК с таким-то статусом» (заполняемость, количества):
create index if not exists idx_objects_building_status
  on crm.objects (building_id, status);


-- ============================================================
-- crm.overdue_contracts() — страница «Должники», сгруппированная в базе.
--
-- Та же болезнь, что и у дашборда, только опаснее: страница тянула ВСЕ
-- неоплаченные просроченные взносы и группировала их по договору в
-- браузере. А взносов на один договор бывает 20-30 (рассрочка на два
-- года), то есть тысячный потолок PostgREST упирался уже на нескольких
-- десятках должников -- и список долгов молча становился неполным.
-- Группировка в SQL даёт СТРОКУ НА ДОГОВОР, а не на взнос.
--
-- SECURITY INVOKER — по тем же причинам, что и dashboard_summary:
-- менеджер должен видеть должников только своих ЖК.
-- ============================================================

create or replace function crm.overdue_contracts()
returns table (
  contract_id uuid,
  contract_number text,
  client_id uuid,
  client_name text,
  client_phone text,
  object_name text,
  currency text,
  missed_count int,
  total_overdue numeric,
  earliest_due date,
  latest_due date
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    c.id,
    c.number,
    cl.id,
    coalesce(cl.name, '—'),
    cl.phone,
    o.name,
    c.currency::text,
    (count(*))::int,
    sum(p.amount),
    min(p.due_date),
    max(p.due_date)
  from crm.contract_payments p
  join crm.contracts c on c.id = p.contract_id
  left join crm.clients cl on cl.id = c.client_id
  left join crm.objects  o  on o.id = c.object_id
  where not p.paid
    and p.due_date < current_date
    -- Остатки графика по расторгнутому договору — это не долг.
    and c.status <> 'cancelled'
  group by c.id, c.number, cl.id, cl.name, cl.phone, o.name, c.currency
  -- Самый большой долг сверху: с него и начинают обзвон.
  order by sum(p.amount) desc;
$$;

grant execute on function crm.overdue_contracts() to authenticated;


-- ============================================================
-- crm.building_unit_stats() — сводка по каждому ЖК для списка объектов.
--
-- Страница «Объекты» считала это, вычитывая все квартиры всех ЖК
-- страницами по 1000 в цикле: на 10 000 квартир — десять последовательных
-- запросов подряд только ради трёх чисел на карточку. Один group by
-- отдаёт то же самое одной строкой на ЖК.
-- ============================================================

create or replace function crm.building_unit_stats()
returns table (
  building_id uuid,
  total int,
  available int,
  available_area numeric
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    o.building_id,
    (count(*))::int,
    (count(*) filter (where o.status = 'available'))::int,
    coalesce(sum(o.area) filter (where o.status = 'available'), 0)
  from crm.objects o
  where o.building_id is not null
  group by o.building_id;
$$;

grant execute on function crm.building_unit_stats() to authenticated;

-- ############################################################
-- ### 039_overdue_pagination.sql
-- ############################################################

-- ============================================================
-- 039: пагинация страницы «Должники».
--
-- 038 убрал главный потолок: список стал СТРОКОЙ НА ДОГОВОР вместо
-- строки на каждый просроченный взнос, и это сразу в 20-30 раз меньше
-- строк. Но потолок PostgREST в 1000 строк никуда не делся -- он просто
-- отодвинулся: когда договоров в просрочке станет больше тысячи,
-- список снова начнёт молча обрываться. Поэтому страница переходит на
-- постраничную выдачу, как «Клиенты» и «Объекты».
--
-- Здесь две правки под это:
--
-- 1. crm.overdue_contracts() пересоздаётся с УСТОЙЧИВОЙ сортировкой.
--    Раньше было просто `order by sum(p.amount) desc`. Для одного
--    запроса этого хватало, но для пагинации -- нет: два договора с
--    ОДИНАКОВОЙ суммой долга Postgres может вернуть в любом порядке, и
--    порядок этот может отличаться между запросом первой страницы и
--    запросом второй. На практике это значит, что один должник
--    показался бы на обеих страницах, а другой не показался бы нигде.
--    Добавлен c.id вторым ключом -- он уникален, поэтому порядок
--    становится полным и воспроизводимым.
--
-- 2. crm.overdue_totals() -- итоги по валютам для плашек над таблицей.
--    Их принципиально нельзя сложить из одной страницы: на экране 25
--    договоров из, скажем, 1200, а в шапке должна стоять сумма долга по
--    ВСЕМ. Считается отдельным агрегатом по всей выборке.
--
-- SECURITY INVOKER -- как и всё в 038: видимость должников ограничена
-- назначенными менеджеру ЖК через RLS.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

create or replace function crm.overdue_contracts()
returns table (
  contract_id uuid,
  contract_number text,
  client_id uuid,
  client_name text,
  client_phone text,
  object_name text,
  currency text,
  missed_count int,
  total_overdue numeric,
  earliest_due date,
  latest_due date
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    c.id,
    c.number,
    cl.id,
    coalesce(cl.name, '—'),
    cl.phone,
    o.name,
    c.currency::text,
    (count(*))::int,
    sum(p.amount),
    min(p.due_date),
    max(p.due_date)
  from crm.contract_payments p
  join crm.contracts c on c.id = p.contract_id
  left join crm.clients cl on cl.id = c.client_id
  left join crm.objects  o  on o.id = c.object_id
  where not p.paid
    and p.due_date < current_date
    -- Остатки графика по расторгнутому договору — это не долг.
    and c.status <> 'cancelled'
  group by c.id, c.number, cl.id, cl.name, cl.phone, o.name, c.currency
  -- Самый большой долг сверху: с него и начинают обзвон. c.id вторым
  -- ключом -- чтобы порядок был полным и страницы не «плавали».
  order by sum(p.amount) desc, c.id;
$$;

grant execute on function crm.overdue_contracts() to authenticated;


create or replace function crm.overdue_totals()
returns table (
  currency text,
  contracts int,
  total_overdue numeric
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    c.currency::text,
    -- distinct: строк здесь по одной на ВЗНОС, а считаем договоры.
    (count(distinct c.id))::int,
    sum(p.amount)
  from crm.contract_payments p
  join crm.contracts c on c.id = p.contract_id
  where not p.paid
    and p.due_date < current_date
    and c.status <> 'cancelled'
  group by c.currency
  order by sum(p.amount) desc;
$$;

grant execute on function crm.overdue_totals() to authenticated;

-- ############################################################
-- ### 040_sms_scheduler.sql
-- ############################################################

-- ============================================================
-- 040: рабочая SMS-рассылка — выключатель «Старт/Стоп», второе
--      напоминание в день платежа и журнал запусков.
--
-- ЧТО БЫЛО НЕ ТАК. Рассылка молчала по трём причинам сразу:
--
--   1. Оба крон-маршрута отклоняют запрос, если переменная окружения
--      CRON_SECRET не задана (fail closed — иначе платный шлюз мог бы
--      дёрнуть кто угодно из интернета). Vercel подставляет заголовок
--      Authorization: Bearer <CRON_SECRET> только когда эта переменная
--      есть в проекте. Не задана — каждый ночной запуск получал 401 и
--      тихо уходил в никуда. Ошибку никто не видел: в интерфейсе нет
--      ни одного места, где было бы написано, работает рассылка или нет.
--      Это лечится не в базе, а настройкой Vercel + новой страницей
--      состояния (/api/sms/status), которая теперь прямо говорит, чего
--      не хватает.
--
--   2. Не было «выключателя»: рассылка либо шла всегда, либо никогда.
--      sms_enabled — это и есть кнопки Старт/Стоп.
--
--   3. Напоминание было ровно одно на взнос (reminder_sent_at), поэтому
--      «за 3 дня И в день платежа» было технически невозможно —
--      вторая отметка просто негде было хранить.
--
-- ОТДЕЛЬНО ВАЖНО. Старый запрос брал взносы с `due_date <= сегодня+3`,
-- то есть ВСЮ просрочку за всё время. Стоило рассылке заработать — и
-- первым же запуском улетели бы сотни SMS по давно просроченным
-- платежам. Новый код ограничен окном (сегодня; сегодня+N] и «ровно
-- сегодня», прошлое не трогается вовсе.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

-- Кнопка Старт/Стоп. По умолчанию ВЫКЛЮЧЕНО: включение — осознанное
-- действие администратора, а не побочный эффект применения миграции.
alter table crm.settings
  add column if not exists sms_enabled boolean not null default false;

-- Чтобы в настройках было видно, что рассылка живая: когда отработала
-- в последний раз и с каким результатом.
alter table crm.settings
  add column if not exists sms_last_run_at timestamptz;

alter table crm.settings
  add column if not exists sms_last_result text;

-- Вторая отметка: напоминание в день платежа. reminder_sent_at остаётся
-- за предварительным (за N дней), так что уже разосланное не повторится.
alter table crm.contract_payments
  add column if not exists due_reminder_sent_at timestamptz;

-- Оба запроса рассылки ищут одинаково: неоплаченные взносы в узком окне
-- дат, у которых соответствующая отметка ещё пустая.
create index if not exists idx_contract_payments_reminder_due
  on crm.contract_payments (due_date)
  where not paid;

-- ############################################################
-- ### 041_client_second_phone.sql
-- ############################################################

-- ============================================================
-- 041: второй номер телефона у клиента.
--
-- У людей регулярно два номера (рабочий и личный, или свой и
-- родственника, который берёт трубку). До сих пор в карточке было одно
-- поле, и второй номер приходилось дописывать в примечания -- откуда его
-- не видно ни в поиске, ни при звонке, ни при отправке SMS.
--
-- Отдельная колонка, а не массив: `phone` используется по всему коду как
-- основной номер (SMS-шлюз, ссылки WhatsApp, поиск, список должников),
-- и превращать его в массив значило бы переписать всё это ради поля,
-- которое почти всегда пустое. phone остаётся основным, phone2 --
-- запасным.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

alter table crm.clients
  add column if not exists phone2 text;

-- Поиск клиентов идёт через ilike '%…%' и по второму номеру тоже, значит
-- ему нужен такой же триграммный индекс, как у phone (см. миграцию 024).
create extension if not exists pg_trgm;

create index if not exists idx_clients_phone2_trgm
  on crm.clients using gin (phone2 gin_trgm_ops);

-- ############################################################
-- ### 042_paid_amount_from_payments.sql
-- ############################################################

-- ============================================================
-- 042: остаток долга считается ПО ИСТОРИИ ПЛАТЕЖЕЙ, а не хранится
--      отдельным числом, которое можно перезаписать руками.
--
-- ЧТО БЫЛО НЕ ТАК. contracts.paid_amount — обычная колонка, и её
-- значение поддерживалось вручную из трёх разных мест:
--
--   * crm.record_payment() прибавлял сумму нового платежа,
--   * crm.delete_payment() вычитал сумму удалённого,
--   * форма договора ПРОСТО ЗАПИСЫВАЛА туда то, что стояло в поле
--     «Оплачено» (а его ещё и пересчитывал ползунок процентов).
--
-- Пока договор не трогали, три источника совпадали. Но стоило открыть
-- «Изменить договор» и сохранить — и в paid_amount уезжало значение из
-- формы, никак не связанное с реальными чеками. Строки платежей при
-- этом оставались на месте: история есть, а «Оплачено» и «Остаток» её
-- больше не отражают. Ровно то, на что жалуется пользователь.
--
-- КАК ЧИНИМ. Единственный источник правды — строки crm.contract_payments
-- с paid = true. Триггер пересчитывает paid_amount при любом изменении
-- этих строк, а обе RPC перестают считать сами (иначе к пересчёту
-- добавилась бы ещё и ручная арифметика — и сумма удвоилась бы).
--
-- ПРО СТАРЫЕ ДАННЫЕ. Разовый пересчёт в конце файла НЕ обнуляет деньги.
-- Если у договора paid_amount больше суммы его чеков (так бывает у
-- договоров, заведённых до того, как первоначальный взнос стали
-- записывать отдельной строкой), разница не стирается, а материализуется
-- как настоящий платёж — датой подписания. Только после этого paid_amount
-- пересчитывается по строкам. Терять уже полученные деньги нельзя.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

create or replace function crm.sync_contract_paid_amount()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_contract_id uuid;
begin
  -- Именно через tg_op, а не coalesce(new.…, old.…): при DELETE запись new
  -- вообще не назначена, и обращение к её полю — ошибка выполнения, а не
  -- NULL. Удаление платежа падало бы.
  if tg_op = 'DELETE' then
    v_contract_id := old.contract_id;
  else
    v_contract_id := new.contract_id;
  end if;

  update crm.contracts c
  set paid_amount = coalesce(
    (select sum(p.amount) from crm.contract_payments p
      where p.contract_id = c.id and p.paid),
    0
  )
  where c.id = v_contract_id;

  if tg_op = 'UPDATE' and old.contract_id is distinct from new.contract_id then
    update crm.contracts c
    set paid_amount = coalesce(
      (select sum(p.amount) from crm.contract_payments p
        where p.contract_id = c.id and p.paid),
      0
    )
    where c.id = old.contract_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_sync_contract_paid_amount on crm.contract_payments;
create trigger trg_sync_contract_paid_amount
after insert or update or delete on crm.contract_payments
for each row execute function crm.sync_contract_paid_amount();


-- record_payment: та же проверка прав и та же вставка, но БЕЗ ручного
-- прибавления к paid_amount — теперь это делает триггер выше.
create or replace function crm.record_payment(
  p_contract_id uuid,
  p_amount numeric,
  p_date date
)
returns crm.contract_payments
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_payment crm.contract_payments;
begin
  if not crm.can_write() then
    raise exception 'Read-only role';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Сумма платежа должна быть больше нуля';
  end if;
  if p_date is null then
    raise exception 'Не указана дата платежа';
  end if;
  if not exists (
    select 1
    from crm.contracts c
    join crm.objects o on o.id = c.object_id
    where c.id = p_contract_id
      and (o.building_id is null or crm.can_view_building(o.building_id))
  ) then
    raise exception 'Contract not allowed for this user';
  end if;

  insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
  values (p_contract_id, p_date, p_amount, true, p_date)
  returning * into v_payment;

  return v_payment;
end;
$$;

grant execute on function crm.record_payment(uuid, numeric, date) to authenticated;


-- delete_payment: то же самое, вычитание убрано.
create or replace function crm.delete_payment(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if not crm.is_admin() then
    raise exception 'Only an admin can delete a payment';
  end if;

  delete from crm.contract_payments where id = p_payment_id;
end;
$$;

grant execute on function crm.delete_payment(uuid) to authenticated;


-- ---- Разовое приведение старых данных в порядок ----

-- 1) Деньги, которые числятся на договоре, но не подтверждены ни одной
--    строкой платежа, становятся настоящим платежом. Иначе пересчёт ниже
--    просто стёр бы их.
insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
select
  c.id,
  coalesce(c.signed_date, c.created_at::date),
  c.paid_amount - coalesce(paid.total, 0),
  true,
  coalesce(c.signed_date, c.created_at::date)
from crm.contracts c
left join lateral (
  select sum(p.amount) as total
  from crm.contract_payments p
  where p.contract_id = c.id and p.paid
) paid on true
where c.paid_amount - coalesce(paid.total, 0) > 0.005;

-- 2) Теперь строки — единственный источник правды: пересчитать всё.
update crm.contracts c
set paid_amount = coalesce(
  (select sum(p.amount) from crm.contract_payments p
    where p.contract_id = c.id and p.paid),
  0
)
where c.paid_amount is distinct from coalesce(
  (select sum(p.amount) from crm.contract_payments p
    where p.contract_id = c.id and p.paid),
  0
);

-- ############################################################
-- ### 043_real_overdue.sql
-- ############################################################

-- ============================================================
-- 043: настоящая просрочка — с учётом уже поступивших денег.
--
-- ЧТО БЫЛО НЕ ТАК. Строки графика рассрочки НИКОГДА не помечаются
-- оплаченными. Платёж записывается ОТДЕЛЬНОЙ строкой (paid = true), а
-- строки плана так и остаются paid = false навсегда. Покрытие считает
-- интерфейс: полученные деньги ложатся на план по очереди, от самой
-- старой строки к новой (см. allocatePlan в ContractPayments).
--
-- А страница «Должники» и плитка «Просрочено» на дашборде считали
-- просроченной КАЖДУЮ строку плана с прошедшим сроком — независимо от
-- того, закрыта она деньгами или нет. То есть клиент, аккуратно
-- плативший два года, всё равно висел в должниках с «21 просроченным
-- платежом» и суммой всего графика. Отсюда и цифры, которые не сходятся
-- с реальностью.
--
-- КАК СЧИТАЕМ ТЕПЕРЬ. Ровно та же раскладка, что и в интерфейсе, только
-- в SQL:
--   pool  = paid_amount - (amount - plan_total)
--           то есть поступившие деньги за вычетом первоначального взноса
--           (той части договора, которой в графике никогда не было);
--   для каждой строки плана по возрастанию срока считаем нарастающий
--   итог cum, и непокрытый остаток строки = clamp(cum - pool, 0, amount).
-- Просрочено = непокрытые остатки строк, срок которых уже прошёл.
--
-- Никаких пеней и процентов: просрочка — это ровно те деньги по графику,
-- которые ещё не поступили. Ничего сверху не начисляется.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

-- Одна общая раскладка для всех потребителей: и «Должники», и дашборд
-- должны показывать одно и то же число.
--
-- security_invoker: представление читается правами вызывающего, значит RLS
-- (и ограничение менеджера своими ЖК) работает как обычно.
drop view if exists crm.overdue_installments cascade;
create or replace view crm.overdue_installments
with (security_invoker = on)
as
with plan as (
  select
    p.id,
    p.contract_id,
    p.due_date,
    p.amount,
    sum(p.amount) over (
      partition by p.contract_id
      order by p.due_date, p.id
      rows between unbounded preceding and current row
    ) as cum
  from crm.contract_payments p
  where not p.paid
),
ctx as (
  select
    c.id                          as contract_id,
    c.amount                      as contract_amount,
    c.paid_amount,
    coalesce(sum(pl.amount), 0)   as plan_total
  from crm.contracts c
  left join plan pl on pl.contract_id = c.id
  where c.status <> 'cancelled'
  group by c.id, c.amount, c.paid_amount
)
select
  pl.id            as payment_id,
  pl.contract_id,
  pl.due_date,
  pl.amount        as scheduled_amount,
  -- Непокрытый остаток именно этой строки после раскладки поступлений.
  least(
    pl.amount,
    greatest(pl.cum - greatest(ctx.paid_amount - (ctx.contract_amount - ctx.plan_total), 0), 0)
  ) as unpaid_amount
from plan pl
join ctx on ctx.contract_id = pl.contract_id;

grant select on crm.overdue_installments to authenticated;


-- Строка на договор: только реально не закрытые просроченные платежи.
--
-- drop, а не только `create or replace`: у функции появилась новая колонка
-- remaining_total, а менять состав OUT-параметров заменой нельзя --
-- Postgres отвечает «cannot change return type of existing function».
drop function if exists crm.overdue_contracts();
create or replace function crm.overdue_contracts()
returns table (
  contract_id uuid,
  contract_number text,
  client_id uuid,
  client_name text,
  client_phone text,
  object_name text,
  currency text,
  missed_count int,
  total_overdue numeric,
  -- Весь остаток по договору, не только просроченная часть: на экране
  -- эти два числа больше не должны путаться друг с другом.
  remaining_total numeric,
  earliest_due date,
  latest_due date
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    c.id,
    c.number,
    cl.id,
    coalesce(cl.name, '—'),
    cl.phone,
    o.name,
    c.currency::text,
    (count(*))::int,
    sum(oi.unpaid_amount),
    greatest(c.amount - c.paid_amount, 0),
    min(oi.due_date),
    max(oi.due_date)
  from crm.overdue_installments oi
  join crm.contracts c on c.id = oi.contract_id
  left join crm.clients cl on cl.id = c.client_id
  left join crm.objects  o  on o.id = c.object_id
  where oi.due_date < current_date
    -- Копейки округления — не долг.
    and oi.unpaid_amount > 0.005
  group by c.id, c.number, cl.id, cl.name, cl.phone, o.name, c.currency, c.amount, c.paid_amount
  order by sum(oi.unpaid_amount) desc, c.id;
$$;

grant execute on function crm.overdue_contracts() to authenticated;


-- Та же история: добавился remaining_total.
drop function if exists crm.overdue_totals();
create or replace function crm.overdue_totals()
returns table (
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
  with per_contract as (
    select
      c.id,
      c.currency,
      sum(oi.unpaid_amount)                  as overdue,
      greatest(c.amount - c.paid_amount, 0)  as remaining
    from crm.overdue_installments oi
    join crm.contracts c on c.id = oi.contract_id
    where oi.due_date < current_date
      and oi.unpaid_amount > 0.005
    group by c.id, c.currency, c.amount, c.paid_amount
  )
  select
    currency::text,
    (count(*))::int,
    sum(overdue),
    sum(remaining)
  from per_contract
  group by currency
  order by sum(overdue) desc;
$$;

grant execute on function crm.overdue_totals() to authenticated;


-- Плитка «Просрочено» на дашборде считала так же неверно, как и страница
-- должников. Пересобираем dashboard_summary с той же раскладкой -- иначе
-- два экрана показывали бы разные числа про одно и то же.
create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                    as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0) as area_available,
    coalesce(sum(price) filter (where status = 'available' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status = 'available' and currency  = 'USD'), 0) as pot_usd
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
-- Просрочка по той же раскладке, что и на странице должников.
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
month_rev as (
  select
    to_char(signed_date, 'YYYY-MM')                            as month,
    coalesce(sum(amount) filter (where currency <> 'USD'), 0)  as tjs,
    coalesce(sum(amount) filter (where currency  = 'USD'), 0)  as usd
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
  group by 1
  order by 1 desc
  limit 6
),
day_rev as (
  select
    p.paid_date                                                 as day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.contract_payments p
  join scoped_contracts c on c.id = p.contract_id
  where p.paid
    and p.paid_date is not null
    and p_from is not null
    and p_to is not null
    and p.paid_date between p_from and p_to
  group by 1
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ############################################################
-- ### 044_potential_revenue_detail.sql
-- ############################################################

-- ============================================================
-- 044: плитка «Потенциальная выручка» перестаёт врать молча.
--
-- ЧТО БЫЛО НЕ ТАК. Плитка складывает цены свободных квартир. Но у
-- квартиры цена может быть НЕ ЗАПОЛНЕНА (price is null) — такая просто
-- не попадает в сумму. На экране это выглядит как «потенциал 800 000»
-- при сорока свободных квартирах: цифра занижена, и понять почему
-- невозможно, потому что нигде не сказано, что половина квартир вообще
-- без цены.
--
-- Считать их «по нулю» нельзя (это и есть текущее враньё), выдумывать им
-- цену — тем более. Единственный честный вариант: показать рядом, из
-- скольких свободных квартир сложилась сумма и у скольких цены нет.
-- Тогда число либо подтверждается, либо сразу видно, что заполнить.
--
-- Здесь только два новых поля в ответе dashboard_summary; вся остальная
-- логика функции не меняется.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                    as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0) as area_available,
    coalesce(sum(price) filter (where status = 'available' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status = 'available' and currency  = 'USD'), 0) as pot_usd,
    -- Из скольких квартир сложилась эта сумма...
    (count(*) filter (where status = 'available' and price is not null and price > 0))::int
      as pot_units,
    -- ...и сколько свободных квартир в неё НЕ попали, потому что у них нет цены.
    (count(*) filter (where status = 'available' and (price is null or price = 0)))::int
      as pot_no_price
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd,
    (count(distinct c.id))::int                                          as contracts
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
month_rev as (
  select
    to_char(signed_date, 'YYYY-MM')                            as month,
    coalesce(sum(amount) filter (where currency <> 'USD'), 0)  as tjs,
    coalesce(sum(amount) filter (where currency  = 'USD'), 0)  as usd
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
  group by 1
  order by 1 desc
  limit 6
),
day_rev as (
  select
    p.paid_date                                                 as day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.contract_payments p
  join scoped_contracts c on c.id = p.contract_id
  where p.paid
    and p.paid_date is not null
    and p_from is not null
    and p_to is not null
    and p.paid_date between p_from and p_to
  group by 1
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'potential_units', (select pot_units from obj_stats),
  'potential_no_price', (select pot_no_price from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'overdue_contracts', (select contracts from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ############################################################
-- ### 045_area_split_and_overdue_by_building.sql
-- ############################################################

-- ============================================================
-- 045: данные под новые графики.
--
--  1. Площадь по статусам — чтобы «Общая площадь / Осталось в продаже»
--     перестали быть двумя плитками и стали одним кольцом «продано /
--     забронировано / в продаже». Раньше отдавались только total и
--     available, а проданной площади не было вовсе — её нельзя было
--     получить вычитанием, потому что между ними ещё брони и «в работе».
--
--  2. Просрочка с разбивкой по ЖК и фильтром по ЖК — страница «Должники»
--     показывает просрочку графиком по объектам, и в фильтре появляется
--     выбор ЖК.
--
-- ВНИМАНИЕ на DROP. У overdue_contracts/overdue_totals меняется И состав
-- колонок, И сигнатура (появляется параметр). Ни то, ни другое
-- `create or replace` не умеет: по колонкам Postgres отвечает «cannot
-- change return type», а добавление параметра со значением по умолчанию
-- создало бы ВТОРУЮ перегрузку — и вызов без аргументов стал бы
-- неоднозначным. Поэтому обе удаляются явно.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

-- ---- 1. Просрочка по ЖК ----

drop function if exists crm.overdue_contracts();
drop function if exists crm.overdue_contracts(uuid);
create function crm.overdue_contracts(p_building_id uuid default null)
returns table (
  contract_id uuid,
  contract_number text,
  client_id uuid,
  client_name text,
  client_phone text,
  object_name text,
  building_id uuid,
  building_name text,
  currency text,
  missed_count int,
  total_overdue numeric,
  remaining_total numeric,
  earliest_due date,
  latest_due date
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    c.id,
    c.number,
    cl.id,
    coalesce(cl.name, '—'),
    cl.phone,
    o.name,
    o.building_id,
    b.name,
    c.currency::text,
    (count(*))::int,
    sum(oi.unpaid_amount),
    greatest(c.amount - c.paid_amount, 0),
    min(oi.due_date),
    max(oi.due_date)
  from crm.overdue_installments oi
  join crm.contracts c on c.id = oi.contract_id
  left join crm.clients   cl on cl.id = c.client_id
  left join crm.objects   o  on o.id = c.object_id
  left join crm.buildings b  on b.id = o.building_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and (p_building_id is null or o.building_id = p_building_id)
  group by c.id, c.number, cl.id, cl.name, cl.phone, o.name, o.building_id, b.name,
           c.currency, c.amount, c.paid_amount
  order by sum(oi.unpaid_amount) desc, c.id;
$$;

grant execute on function crm.overdue_contracts(uuid) to authenticated;


drop function if exists crm.overdue_totals();
drop function if exists crm.overdue_totals(uuid);
create function crm.overdue_totals(p_building_id uuid default null)
returns table (
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
  with per_contract as (
    select
      c.id,
      c.currency,
      sum(oi.unpaid_amount)                  as overdue,
      greatest(c.amount - c.paid_amount, 0)  as remaining
    from crm.overdue_installments oi
    join crm.contracts c on c.id = oi.contract_id
    left join crm.objects o on o.id = c.object_id
    where oi.due_date < current_date
      and oi.unpaid_amount > 0.005
      and (p_building_id is null or o.building_id = p_building_id)
    group by c.id, c.currency, c.amount, c.paid_amount
  )
  select currency::text, (count(*))::int, sum(overdue), sum(remaining)
  from per_contract
  group by currency
  order by sum(overdue) desc;
$$;

grant execute on function crm.overdue_totals(uuid) to authenticated;


-- Просрочка, сгруппированная по ЖК: ровно то, что рисует график на
-- странице должников. Объекты без ЖК собираются в одну строку с NULL --
-- терять их нельзя, долг есть долг.
drop function if exists crm.overdue_by_building();
create function crm.overdue_by_building()
returns table (
  building_id uuid,
  building_name text,
  currency text,
  contracts int,
  total_overdue numeric
)
language sql
stable
security invoker
set search_path = crm, public
as $$
  select
    o.building_id,
    coalesce(b.name, '—'),
    c.currency::text,
    (count(distinct c.id))::int,
    sum(oi.unpaid_amount)
  from crm.overdue_installments oi
  join crm.contracts c on c.id = oi.contract_id
  left join crm.objects   o on o.id = c.object_id
  left join crm.buildings b on b.id = o.building_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
  group by o.building_id, b.name, c.currency
  order by sum(oi.unpaid_amount) desc;
$$;

grant execute on function crm.overdue_by_building() to authenticated;


-- ---- 2. Площадь по статусам в dashboard_summary ----

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                      as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0)   as area_available,
    coalesce(sum(area) filter (where status = 'reserved'), 0)    as area_reserved,
    coalesce(sum(area) filter (where status = 'sold'), 0)        as area_sold,
    coalesce(sum(area) filter (where status = 'rented'), 0)      as area_rented,
    coalesce(sum(area) filter (where status = 'in_progress'), 0) as area_in_progress,
    coalesce(sum(price) filter (where status = 'available' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status = 'available' and currency  = 'USD'), 0) as pot_usd,
    (count(*) filter (where status = 'available' and price is not null and price > 0))::int
      as pot_units,
    (count(*) filter (where status = 'available' and (price is null or price = 0)))::int
      as pot_no_price
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd,
    (count(distinct c.id))::int                                          as contracts
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
month_rev as (
  select
    to_char(signed_date, 'YYYY-MM')                            as month,
    coalesce(sum(amount) filter (where currency <> 'USD'), 0)  as tjs,
    coalesce(sum(amount) filter (where currency  = 'USD'), 0)  as usd
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
  group by 1
  order by 1 desc
  limit 6
),
day_rev as (
  select
    p.paid_date                                                 as day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from crm.contract_payments p
  join scoped_contracts c on c.id = p.contract_id
  where p.paid
    and p.paid_date is not null
    and p_from is not null
    and p_to is not null
    and p.paid_date between p_from and p_to
  group by 1
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'area_split', (
    select jsonb_build_object(
      'sold', area_sold, 'reserved', area_reserved, 'available', area_available,
      'rented', area_rented, 'in_progress', area_in_progress
    ) from obj_stats
  ),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'potential_units', (select pot_units from obj_stats),
  'potential_no_price', (select pot_no_price from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'overdue_contracts', (select contracts from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ############################################################
-- ### 046_gapless_revenue_series.sql
-- ############################################################

-- ============================================================
-- 046: график выручки — без пропусков в оси времени.
--
-- ЧТО БЫЛО НЕ ТАК. month_rev группировал договоры по месяцу подписания и
-- отдавал ТОЛЬКО те месяцы, в которых подписания были. На экране это
-- давало ось «2026-02, 2026-03, 2026-05, 2026-06...» — апреля просто
-- нет. Для линейного графика это не косметика, а искажение: отрезок
-- между мартом и маем рисуется так, будто это соседние месяцы, и наклон
-- (то есть сам тренд, ради которого график и существует) получается
-- неверным. Месяц без продаж — это ноль, а не отсутствие точки.
--
-- То же самое у графика по дням: день без поступлений выпадал из оси.
--
-- КАК ТЕПЕРЬ. Ось строится generate_series по календарю, а суммы
-- подтягиваются к ней через left join. Нет продаж — ровно 0 на своём
-- месте.
--
-- Окно месяцев отсчитывается назад от ПОСЛЕДНЕГО месяца с подписанием, а
-- не от текущей даты: если в базе даты подписания уходят вперёд или,
-- наоборот, последняя продажа была давно, окно всё равно попадает туда,
-- где данные есть.
--
-- Файл идемпотентный -- можно запускать повторно.
-- ============================================================

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                      as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0)   as area_available,
    coalesce(sum(area) filter (where status = 'reserved'), 0)    as area_reserved,
    coalesce(sum(area) filter (where status = 'sold'), 0)        as area_sold,
    coalesce(sum(area) filter (where status = 'rented'), 0)      as area_rented,
    coalesce(sum(area) filter (where status = 'in_progress'), 0) as area_in_progress,
    coalesce(sum(price) filter (where status = 'available' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status = 'available' and currency  = 'USD'), 0) as pot_usd,
    (count(*) filter (where status = 'available' and price is not null and price > 0))::int
      as pot_units,
    (count(*) filter (where status = 'available' and (price is null or price = 0)))::int
      as pot_no_price
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd,
    (count(distinct c.id))::int                                          as contracts
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
-- The end of the window: the last month that actually has a signing, so the
-- chart lands where the data is even if the newest contract is not this month.
month_end as (
  select coalesce(
           date_trunc('month', max(signed_date)),
           date_trunc('month', current_date)
         ) as m
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
),
-- Six consecutive calendar months. A month with no sales must be a zero on the
-- axis, not a missing point.
month_axis as (
  select to_char(g, 'YYYY-MM') as month
  from month_end me,
       generate_series(me.m - interval '5 months', me.m, interval '1 month') as g
),
month_rev as (
  select
    ax.month,
    coalesce(sum(c.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(c.amount) filter (where c.currency  = 'USD'), 0) as usd
  from month_axis ax
  left join scoped_contracts c
         on c.status <> 'cancelled'
        and c.signed_date is not null
        and to_char(c.signed_date, 'YYYY-MM') = ax.month
  group by ax.month
  order by ax.month
),
-- Same treatment for the daily chart: every day in the chosen period appears,
-- including the ones with no money received.
day_axis as (
  select g::date as day
  from generate_series(
         coalesce(p_from, current_date),
         coalesce(p_to, current_date),
         interval '1 day'
       ) as g
  where p_from is not null and p_to is not null
),
day_rev as (
  select
    ax.day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from day_axis ax
  left join crm.contract_payments p
         on p.paid and p.paid_date = ax.day
  left join scoped_contracts c on c.id = p.contract_id
  group by ax.day
  order by ax.day
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'area_split', (
    select jsonb_build_object(
      'sold', area_sold, 'reserved', area_reserved, 'available', area_available,
      'rented', area_rented, 'in_progress', area_in_progress
    ) from obj_stats
  ),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'potential_units', (select pot_units from obj_stats),
  'potential_no_price', (select pot_no_price from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'overdue_contracts', (select contracts from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ### 047_retire_hero_theme_options.sql

-- ============================================================
-- 047: убраны тема «Уқёнус» и узоры «Ситора», «Панҷара».
--
-- ЗАЧЕМ МИГРАЦИЯ. Тема и узор хранятся в crm.settings как обычный текст,
-- без справочника допустимых значений. Оформление живёт в CSS: правило
-- :root[data-hero-theme="ocean"] удалено вместе с темой. Если в базе
-- осталась строка 'ocean', происходит вот что: на <html> по-прежнему
-- ставится data-hero-theme="ocean", подходящего правила нет, и шапка
-- рисуется цветами по умолчанию (Атлас) — то есть внешне всё работает.
-- Но экран Настройки → Оформление подсвечивает кнопку сравнением
-- values.hero_theme === th.id, а такой кнопки больше нет: ни одна тема не
-- выглядит выбранной, и админ не понимает, что у него включено.
--
-- Поэтому приводим базу в соответствие с интерфейсом: снятые значения
-- становятся NULL, что и означает «Атлас» и «Ҳамвор» (без узора) —
-- ровно то, что и так видит пользователь.
--
-- Ничьи данные это не затрагивает: в колонках лежит только выбор
-- оформления. Идемпотентно, повторный запуск безопасен.
-- ============================================================

update crm.settings
set hero_theme = null
where hero_theme = 'ocean';

update crm.settings
set hero_pattern = null
where hero_pattern in ('star', 'trellis');

-- ### 048_reprice_building_units.sql

-- ============================================================
-- 048: смена цены за 1 м² здания пересчитывает квартиры.
--
-- ЧТО БЫЛО НЕ ТАК. buildings.price_per_sqm участвовал ровно в одном месте —
-- в конструкторе этажей, когда квартиры ТОЛЬКО создаются: там один раз
-- считалось objects.price = area * price_per_sqm и записывалось в квартиру.
-- Дальше связи не было никакой. Админ менял цену за метр в карточке здания,
-- в базе менялось одно число в одной строке — и всё. Шахматка показывает
-- objects.price каждой квартиры, поэтому она честно показывала старые
-- суммы: их никто не пересчитывал.
--
-- ПОЧЕМУ ИМЕННО ФУНКЦИЯ В БАЗЕ. Это уже пробовали сделать из программы
-- (коммит 65fbb56, откачен коммитом 1b16dd2: собиралось без ошибок, но на
-- живом сайте не срабатывало, причину тогда не нашли). Тот вариант слал
-- обычные REST-запросы вида PATCH objects?id=in.(...), перечисляя id
-- квартир прямо в адресе — по ~37 символов на каждую, до 100 штук в
-- запросе. Это адрес длиной под 4 КБ, а шлюзы (Vercel, Cloudflare) режут
-- такие адреса. Отсюда и «собирается, но ничего не меняет».
--
-- Здесь никакого списка id нет вообще: один UPDATE внутри базы, отбор по
-- building_id. Длина запроса не зависит от числа квартир, и выполняется он
-- либо целиком, либо никак.
--
-- ЧТО НЕ ТРОГАЕТСЯ:
--   * проданные (status = 'sold') — цена продажи зафиксирована сделкой;
--   * квартиры без площади — считать не из чего (area * ставка = NULL);
--   * квартиры в долларах — ставка в карточке здания указана в сомони
--     (так и написано на самом поле), умножать на неё цену в USD нельзя.
--   Каждая такая группа возвращается отдельным счётчиком, чтобы программа
--   сказала о них вслух, а не молча пропустила.
--
-- ДОГОВОРЫ НЕ ЗАТРАГИВАЮТСЯ. У contracts своя сумма (contracts.amount), она
-- живёт отдельно от objects.price. Пересчёт цены забронированной квартиры
-- НЕ переписывает сумму уже подписанного договора.
--
-- ПРАВА. SECURITY INVOKER (по умолчанию) — намеренно. Политика
-- objects_update разрешает не-админу менять только свободные квартиры
-- (status = 'available'), и через эту функцию это ограничение остаётся в
-- силе: строки, на которые у вызывающего нет прав, просто не попадут в
-- UPDATE. SECURITY DEFINER здесь дал бы любому сотруднику право
-- переоценить забронированные квартиры чужого дома.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

-- Тип результата может меняться при доработках, а PostgreSQL не разрешает
-- менять его через create or replace — поэтому сначала снимаем старую.
drop function if exists crm.reprice_building_units(uuid, numeric);

create function crm.reprice_building_units(
  p_building_id uuid,
  p_price_per_sqm numeric
)
returns table (
  repriced integer,
  skipped_sold integer,
  skipped_no_area integer,
  skipped_currency integer
)
language plpgsql
as $$
declare
  v_repriced integer;
begin
  if p_price_per_sqm is null or p_price_per_sqm <= 0 then
    raise exception 'Цена за 1 м² должна быть больше нуля';
  end if;

  with updated as (
    update crm.objects
    set price = round(area * p_price_per_sqm, 2)
    where building_id = p_building_id
      and status <> 'sold'
      and currency = 'TJS'
      and area is not null
      and area > 0
    returning 1
  )
  select count(*)::integer into v_repriced from updated;

  return query
  select
    v_repriced,
    (
      select count(*)::integer
      from crm.objects
      where building_id = p_building_id
        and status = 'sold'
    ),
    (
      select count(*)::integer
      from crm.objects
      where building_id = p_building_id
        and status <> 'sold'
        and currency = 'TJS'
        and (area is null or area <= 0)
    ),
    (
      select count(*)::integer
      from crm.objects
      where building_id = p_building_id
        and status <> 'sold'
        and currency <> 'TJS'
    );
end;
$$;

grant execute on function crm.reprice_building_units(uuid, numeric) to authenticated;

-- ### 049_potential_counts_unsold.sql

-- ============================================================
-- 049: «Потенциал непроданных» считает непроданные, а не только свободные.
--
-- ЧТО БЫЛО НЕ ТАК. Карточка называется «Потенциал непроданных», а сумма под
-- ней бралась по фильтру status = 'available' — то есть только по СВОБОДНЫМ.
-- Забронированные и «в работе» давали ровно ноль, хотя ни одна из них не
-- продана. Отсюда и ощущение неверного числа: подпись обещает одно, а
-- арифметика считает другое. Старый вариант подписи это признавал открыто —
-- там было написано «по N СВОБОДНЫМ квартирам».
--
-- Напоминание, почему «забронирована» здесь означает «денег ещё не было»:
-- recompute_object_status ставит 'sold', как только по договору прошёл хоть
-- один платёж (paid_amount > 0), и 'reserved' — пока не прошёл ни одного.
-- Значит забронированная квартира — это ещё не выручка, и её место именно в
-- потенциале.
--
-- ЧТО МЕНЯЕТСЯ. Ровно четыре фильтра внутри obj_stats: сумма в сомони, сумма
-- в долларах, счётчик квартир с ценой и счётчик квартир без цены. Везде
-- status = 'available' заменено на status <> 'sold'. Всё остальное в функции
-- не тронуто, включая счётчики статусов и площади.
--
-- Из непроданных исключается только продано. Статус 'rented' формально тоже
-- останется в сумме, но в этой базе его никто не ставит: автоматика знает
-- только available / reserved / sold.
--
-- Число на дашборде после этого ВЫРАСТЕТ — это ожидаемо, в него войдёт вся
-- непроданная площадь, а не одна свободная.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
live_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
    and (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                      as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0)   as area_available,
    coalesce(sum(area) filter (where status = 'reserved'), 0)    as area_reserved,
    coalesce(sum(area) filter (where status = 'sold'), 0)        as area_sold,
    coalesce(sum(area) filter (where status = 'rented'), 0)      as area_rented,
    coalesce(sum(area) filter (where status = 'in_progress'), 0) as area_in_progress,
    coalesce(sum(price) filter (where status <> 'sold' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status <> 'sold' and currency  = 'USD'), 0) as pot_usd,
    (count(*) filter (where status <> 'sold' and price is not null and price > 0))::int
      as pot_units,
    (count(*) filter (where status <> 'sold' and (price is null or price = 0)))::int
      as pot_no_price
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_contracts
),
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd,
    (count(distinct c.id))::int                                          as contracts
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
-- The end of the window: the last month that actually has a signing, so the
-- chart lands where the data is even if the newest contract is not this month.
month_end as (
  select coalesce(
           date_trunc('month', max(signed_date)),
           date_trunc('month', current_date)
         ) as m
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
),
-- Six consecutive calendar months. A month with no sales must be a zero on the
-- axis, not a missing point.
month_axis as (
  select to_char(g, 'YYYY-MM') as month
  from month_end me,
       generate_series(me.m - interval '5 months', me.m, interval '1 month') as g
),
month_rev as (
  select
    ax.month,
    coalesce(sum(c.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(c.amount) filter (where c.currency  = 'USD'), 0) as usd
  from month_axis ax
  left join scoped_contracts c
         on c.status <> 'cancelled'
        and c.signed_date is not null
        and to_char(c.signed_date, 'YYYY-MM') = ax.month
  group by ax.month
  order by ax.month
),
-- Same treatment for the daily chart: every day in the chosen period appears,
-- including the ones with no money received.
day_axis as (
  select g::date as day
  from generate_series(
         coalesce(p_from, current_date),
         coalesce(p_to, current_date),
         interval '1 day'
       ) as g
  where p_from is not null and p_to is not null
),
day_rev as (
  select
    ax.day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from day_axis ax
  left join crm.contract_payments p
         on p.paid and p.paid_date = ax.day
  left join scoped_contracts c on c.id = p.contract_id
  group by ax.day
  order by ax.day
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'area_split', (
    select jsonb_build_object(
      'sold', area_sold, 'reserved', area_reserved, 'available', area_available,
      'rented', area_rented, 'in_progress', area_in_progress
    ) from obj_stats
  ),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'potential_units', (select pot_units from obj_stats),
  'potential_no_price', (select pot_no_price from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'overdue_contracts', (select contracts from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ### 050_building_rate_is_automatic.sql

-- ============================================================
-- 050: цена за 1 м² доходит до квартир САМА, без кнопок.
--
-- ЧТО БЫЛО НЕ ТАК. Цена квартиры — хранимое число, и записывалось оно ровно
-- один раз: в конструкторе этажей, в момент создания квартиры. Всё
-- остальное время связи со ставкой здания не было. Мы её чинили дважды —
-- сперва из браузера (65fbb56, откачено), потом функцией в базе (048) — и
-- оба раза пересчёт запускался ТОЛЬКО когда человек менял ставку и
-- соглашался в диалоге. Достаточно было:
--   * забыть нажать,
--   * сохранить ту же ставку (изменения нет — пересчёта нет),
--   * создать квартиру позже, когда ставка уже стояла,
--   * вписать площадь позже, чем ставку,
-- и квартира навсегда оставалась без цены. Дашборд честно суммирует
-- objects.price, поэтому такие квартиры давали ноль, а карточка «Потенциал
-- непроданных» показывала сумму по половине дома.
--
-- ЗДЕСЬ ПОДХОД ДРУГОЙ. Связь «цена квартиры = её площадь × ставка здания»
-- перестаёт быть разовым действием и становится правилом базы. Три
-- триггера закрывают три момента, когда цена может разойтись:
--
--   1. изменили ставку здания   -> пересчитались непроданные квартиры;
--   2. создали квартиру         -> цена посчиталась сразу;
--   3. вписали площадь позже    -> цена посчиталась сразу.
--
-- Нажимать больше ничего не нужно. Кнопка «Применить» остаётся — она нужна
-- для квартир, созданных ДО этой миграции.
--
-- ЧТО НЕ ТРОГАЕТСЯ (везде одинаково):
--   * проданные (status = 'sold') — цена зафиксирована сделкой;
--   * квартиры без площади — умножать не на что;
--   * квартиры в долларах — ставка здания указана в сомони.
--
-- ДОГОВОРЫ НЕ ЗАТРАГИВАЮТСЯ: у contracts своя сумма (contracts.amount), она
-- хранится отдельно от objects.price.
--
-- ОЧИСТКА СТАВКИ НЕ СТИРАЕТ ЦЕНЫ. Если price_per_sqm стал NULL, триггер
-- ничего не делает: снять цены можно только осознанно, из карточки здания,
-- с отдельным подтверждением. Иначе случайно очищенное поле молча обнулило
-- бы прайс всего дома.
--
-- ПРАВА: SECURITY DEFINER — намеренно, и это отличается от функции 048.
-- Там пересчёт был действием пользователя, и политика objects_update
-- (не-админ меняет только свободные квартиры) должна была его ограничивать.
-- Здесь это не действие, а инвариант данных: если ставка здания изменилась,
-- цены обязаны сойтись целиком, а не на тех строках, до которых дотянулись
-- права. Само право менять ставку по-прежнему проверяется на buildings.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

-- ---------- 1. ставка здания изменилась ----------

create or replace function crm.apply_building_rate()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  -- NULL — это «ставка не задана», а не «обнулить прайс». См. шапку файла.
  if new.price_per_sqm is null or new.price_per_sqm <= 0 then
    return new;
  end if;

  update crm.objects
  set price = round(area * new.price_per_sqm, 2)
  where building_id = new.id
    and status <> 'sold'
    and currency = 'TJS'
    and area is not null
    and area > 0
    -- Не трогаем строки, которые уже стоят на этой цене: лишний UPDATE
    -- дёргает триггер updated_at и заставляет базу писать зря.
    and price is distinct from round(area * new.price_per_sqm, 2);

  return new;
end;
$$;

drop trigger if exists trg_apply_building_rate on crm.buildings;
create trigger trg_apply_building_rate
  after update of price_per_sqm on crm.buildings
  for each row
  when (new.price_per_sqm is distinct from old.price_per_sqm)
  execute function crm.apply_building_rate();

-- ---------- 2. и 3. квартира создана / у неё появилась площадь ----------

create or replace function crm.price_unit_from_building()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_rate numeric;
begin
  if new.building_id is null
     or new.status = 'sold'
     or new.currency <> 'TJS'
     or new.area is null
     or new.area <= 0
  then
    return new;
  end if;

  -- Цену, введённую руками, не перебиваем: ставка здания — значение по
  -- умолчанию, а не запрет назначить квартире свою цену.
  if new.price is not null and new.price > 0 then
    return new;
  end if;

  select b.price_per_sqm into v_rate
  from crm.buildings b
  where b.id = new.building_id;

  if v_rate is null or v_rate <= 0 then
    return new;
  end if;

  new.price := round(new.area * v_rate, 2);
  return new;
end;
$$;

drop trigger if exists trg_price_unit_from_building on crm.objects;
create trigger trg_price_unit_from_building
  before insert or update of area, building_id on crm.objects
  for each row
  execute function crm.price_unit_from_building();

-- ---------- разовая сверка существующих данных ----------
--
-- Всё, что накопилось до этой миграции: квартиры, у которых есть площадь и
-- есть ставка здания, но цены нет. Ровно те 178 строк, из-за которых
-- «Потенциал непроданных» считал половину. Дальше за этим следят триггеры.

update crm.objects o
set price = round(o.area * b.price_per_sqm, 2)
from crm.buildings b
where b.id = o.building_id
  and o.status <> 'sold'
  and o.currency = 'TJS'
  and o.area is not null
  and o.area > 0
  and (o.price is null or o.price = 0)
  and b.price_per_sqm is not null
  and b.price_per_sqm > 0;
-- ############################################################
-- ### 051_sales_by_manager_building_filter.sql
-- ############################################################

-- ЗАЧЕМ. В шапке дашборда есть выбор ЖК, и ему подчиняется каждая цифра на
-- странице — кроме таблицы «Продажи по менеджерам». Она звала
-- sales_by_manager(p_from, p_to): дат достаточно, а ЖК передать некуда.
-- Получалось, что при выбранном одном ЖК верх страницы показывает его, а
-- таблица менеджеров — по-прежнему все объекты. Две половины одного экрана
-- отвечали на разные вопросы, и цифры под ними не сходились.
--
-- Функция получает третий параметр. Старая двухпараметрная версия удаляется, а
-- не остаётся рядом: оставить её — значит оставить и способ позвать таблицу
-- без фильтра.
--
-- Соединение с objects внутреннее, и это безопасно: contracts.object_id
-- объявлен NOT NULL с внешним ключом, так что ни одна строка на нём не
-- потеряется.
--
-- Идемпотентно: drop … if exists перед create, повторный запуск безопасен.
-- ============================================================

drop function if exists crm.sales_by_manager(date, date);

create or replace function crm.sales_by_manager(
  p_from date default null,
  p_to date default null,
  p_building_id uuid default null
)
returns table (
  manager text,
  currency text,
  contracts bigint,
  total numeric,
  paid numeric
)
language plpgsql
security definer
set search_path = crm, public, auth
stable
as $$
begin
  if not (crm.is_admin() or crm.is_director()) then
    raise exception 'Доступно только администратору и директору';
  end if;
  return query
    select
      coalesce(u.email::text, 'Без менеджера') as manager,
      c.currency::text as currency,
      count(*)::bigint as contracts,
      sum(c.amount) as total,
      sum(least(c.paid_amount, c.amount)) as paid
    from crm.contracts c
    join crm.objects o on o.id = c.object_id
    left join auth.users u on u.id = c.created_by
    where c.status <> 'cancelled'
      and (p_from is null or c.signed_date >= p_from)
      and (p_to is null or c.signed_date <= p_to)
      and (p_building_id is null or o.building_id = p_building_id)
    group by 1, 2
    order by 4 desc nulls last;
end;
$$;

grant execute on function crm.sales_by_manager(date, date, uuid) to authenticated;
-- ### 052_sms_provider_label.sql

-- ============================================================
-- 052: поле «Провайдер SMS» становится обычной надписью, а не жёстко
-- вшитым текстом на экране.
--
-- ЧТО БЫЛО. Страница настроек рисовала для «Провайдера» readonly-поле со
-- значением "Payom.tj" прямо в разметке (src/app/(app)/settings/page.tsx) —
-- в базе для этого не было ни колонки, ни смысла её сохранять, потому что
-- сохранять было нечего: значение никогда не менялось.
--
-- ЧТО МЕНЯЕТСЯ. Появляется обычная колонка, обычное поле ввода, обычное
-- сохранение — как у имени отправителя и API-ключа.
--
-- ЧЕСТНОЕ ОГРАНИЧЕНИЕ, О КОТОРОМ НАДО ПОМНИТЬ. В коде реализован ЗАПРОС
-- ИМЕННО К ШЛЮЗУ PAYOM.TJ (gateway.payom.tj, формат тела запроса и
-- авторизации — его собственный, см. src/lib/sms/sendPaymentReminders.ts).
-- Это поле — подпись для админа, а не переключатель шлюза: вписать сюда
-- название другого провайдера не заставит бэкенд слать запросы туда же.
-- Подключить второй шлюз — отдельная задача, для неё нужен его API.
-- ============================================================

alter table crm.settings
  add column if not exists sms_provider text not null default 'Payom.tj';

-- ### 053_audit_log_context.sql

-- ============================================================
-- 053: журнал событий помнит, В КАКОМ договоре/квартире/клиенте произошло
-- событие, а не только голый UUID и список изменённых полей.
--
-- ЧТО БЫЛО НЕ ТАК. crm.log_change()/crm.log_delete() писали:
--   * insert/delete -- всю строку целиком (to_jsonb);
--   * update        -- только изменившиеся поля, {поле: {old, new}}.
-- Для клиента этого достаточно: у строки уже есть name. Но для платежа
-- (contract_payments) и договора (contracts) собственного человекочитаемого
-- имени нет — только client_id/object_id/contract_id, голые UUID. Запись
-- «Пардохт · 16516.66» ничего не говорит, в счёт какого договора, какой
-- квартиры и какого клиента это было. Экран журнала показывал именно это.
--
-- Второй, отдельный баг был на фронтенде: страница журнала ищет
-- details.changed, а триггер никогда не клал diff под ключ "changed" — он
-- И ЕСТЬ details. Поэтому у каждой строки «Тагйирдихӣ» в колонке
-- «Тафсилот» всегда стоял прочерк, даже когда изменения были. Правится в
-- src/app/(app)/settings/audit-log/page.tsx отдельным коммитом.
--
-- ЧТО МЕНЯЕТСЯ. Новая функция crm.audit_context(entity_type, id) одним
-- запросом на нужный тип сущности достаёт то, что относится к делу: имя
-- клиента, номер договора, имя/квартиру объекта, здание, валюту договора.
-- Кладётся в details под ключ "_context" — с подчёркиванием, чтобы никогда
-- не столкнуться с настоящим именем колонки. jsonb_strip_nulls убирает
-- то, что для этого типа сущности не имеет смысла (у клиента нет номера
-- договора), так что фронтенду достаточно проверить, какие ключи вообще
-- пришли.
--
-- ПОЧЕМУ ОДНА ФУНКЦИЯ ПО ID, А НЕ ПО СТРОКЕ NEW/OLD. Она вызывается и из
-- log_change (после INSERT/UPDATE, строка уже видна), и из log_delete
-- (BEFORE DELETE, строка ещё жива) — но она не трогает удаляемую/меняемую
-- строку напрямую, а ищет её заново по id и достраивает связи (платёж →
-- договор → клиент/квартира → здание). Так один код работает в обоих
-- триггерах без дублирования.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

create or replace function crm.audit_context(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_client_name text;
  v_contract_number text;
  v_object_name text;
  v_building_name text;
  v_currency crm.currency;
begin
  if p_entity_type = 'client' then
    select c.name into v_client_name
    from crm.clients c
    where c.id = p_entity_id;

  elsif p_entity_type = 'contract' then
    select cl.name, c.number, o.name, b.name, c.currency
      into v_client_name, v_contract_number, v_object_name, v_building_name, v_currency
    from crm.contracts c
    left join crm.clients cl on cl.id = c.client_id
    left join crm.objects o on o.id = c.object_id
    left join crm.buildings b on b.id = o.building_id
    where c.id = p_entity_id;

  elsif p_entity_type = 'contract_payment' then
    select cl.name, c.number, o.name, b.name, c.currency
      into v_client_name, v_contract_number, v_object_name, v_building_name, v_currency
    from crm.contract_payments p
    join crm.contracts c on c.id = p.contract_id
    left join crm.clients cl on cl.id = c.client_id
    left join crm.objects o on o.id = c.object_id
    left join crm.buildings b on b.id = o.building_id
    where p.id = p_entity_id;

  elsif p_entity_type = 'object' then
    select o.name, b.name into v_object_name, v_building_name
    from crm.objects o
    left join crm.buildings b on b.id = o.building_id
    where o.id = p_entity_id;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'client_name', v_client_name,
    'contract_number', v_contract_number,
    'object_name', v_object_name,
    'building_name', v_building_name,
    'currency', v_currency
  ));
end;
$$;

create or replace function crm.log_change()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_diff jsonb;
  v_context jsonb;
begin
  v_context := crm.audit_context(TG_ARGV[0], NEW.id);

  if TG_OP = 'INSERT' then
    insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'create', TG_ARGV[0], NEW.id,
      to_jsonb(NEW) || jsonb_build_object('_context', v_context)
    );
    return NEW;
  end if;

  -- UPDATE: only the fields that actually changed, old -> new, so the log
  -- reads as "what happened" instead of two full row dumps.
  select coalesce(
    jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)),
    '{}'::jsonb
  )
  into v_diff
  from jsonb_each(to_jsonb(NEW)) n
  join jsonb_each(to_jsonb(OLD)) o using (key)
  where n.value is distinct from o.value
    and n.key not in ('updated_at');

  if v_diff <> '{}'::jsonb then
    insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(), 'update', TG_ARGV[0], NEW.id,
      v_diff || jsonb_build_object('_context', v_context)
    );
  end if;
  return NEW;
end;
$$;

create or replace function crm.log_delete()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
declare
  v_context jsonb;
begin
  -- BEFORE DELETE: OLD still exists, and so does everything audit_context
  -- looks up through it (only OLD itself is about to go away).
  v_context := crm.audit_context(TG_ARGV[0], OLD.id);
  insert into crm.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(), 'delete', TG_ARGV[0], OLD.id,
    to_jsonb(OLD) || jsonb_build_object('_context', v_context)
  );
  return OLD;
end;
$$;

-- ### 054_service_role_schema_grants.sql

-- ============================================================
-- 054: сервисному ключу дали права на схему crm. Наконец настоящая причина
-- «permission denied for schema crm» / «Invalid API key» у SMS-рассылки.
--
-- ЧТО БЫЛО НЕ ТАК. Схема crm и все её таблицы выдавались правами трижды по
-- ходу файла (при создании, потом ещё дважды) — и каждый раз одной и той же
-- строкой:
--
--   grant usage on schema crm to anon, authenticated;
--   grant all on all tables in schema crm to anon, authenticated;
--   grant all on all sequences in schema crm to anon, authenticated;
--   alter default privileges in schema crm grant all on tables to anon, authenticated;
--
-- Ни разу — ни одного упоминания service_role. Обычный вход в программу
-- работает через anon/authenticated, поэтому сайт был в полном порядке.
-- А /api/sms/*, /api/cron/* подключаются SUPABASE_SERVICE_ROLE_KEY — это
-- РОЛЬ В БАЗЕ ПОСТГРЕС с именем service_role, и у неё не было даже права
-- заглянуть в схему crm, не то что читать settings. Отсюда и ошибка: ключ
-- настоящий, из правильного проекта — но роль, которую он представляет,
-- никогда не получала доступа.
--
-- Раньше эта ошибка была подписана «скорее всего ключ из другого проекта»
-- (см. adminErrorMessage в serviceClient.ts) — и это было ПРАВДОПОДОБНОЕ,
-- но не то объяснение: причина была здесь, в базе, а не в Vercel.
--
-- ЧТО ДЕЛАЕТ ЭТОТ ФАЙЛ. Даёт service_role ровно то же самое, что уже есть
-- у authenticated: доступ к схеме, ко всем существующим таблицам и
-- последовательностям, право выполнять функции, и правило на будущее —
-- новая таблица/функция появится уже с этим правом, без ручной правки.
--
-- ПОЧЕМУ ЭТО БЕЗОПАСНО. service_role и так проходит мимо RLS по конструкции
-- Supabase (это и есть смысл «служебной» роли) — у него уже есть полный
-- доступ к данным на уровне движка. Явные grant здесь не открывают ничего
-- нового, они лишь снимают отдельный, более ранний барьер Постгреса
-- (владение схемой/объектом), который стоял ПЕРЕД проверкой RLS и обрубал
-- запрос до неё.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

grant usage on schema crm to service_role;
grant all on all tables in schema crm to service_role;
grant all on all sequences in schema crm to service_role;
grant execute on all functions in schema crm to service_role;

alter default privileges in schema crm grant all on tables to service_role;
alter default privileges in schema crm grant all on sequences to service_role;
alter default privileges in schema crm grant execute on functions to service_role;

-- ### 055_auto_regenerate_schedule.sql

-- ============================================================
-- 055: смена суммы договора сама пересчитывает неоплаченный график.
--
-- ЧТО БЫЛО НЕ ТАК (048/предыдущий фикс). Функция crm.regenerate_schedule
-- уже умела ровно то, что нужно: удалить неоплаченные строки графика и
-- пересобрать их от текущего остатка (сумма − оплачено), поровну на
-- installment_months. Но её никто и ниоткуда не вызывал — правку суммы
-- договора (скидка, исправление) форма писала только в crm.contracts,
-- сам график в crm.contract_payments оставался от старой суммы. Мы дали
-- администратору кнопку «Пересчитать график» — но это по-прежнему ручное
-- действие: забыл нажать — и печатный договор снова врёт про остаток.
--
-- ЧТО МЕНЯЕТСЯ. Триггер на crm.contracts: если у ДОГОВОРА С РАССРОЧКОЙ
-- изменилась сумма и есть хоть одна неоплаченная строка графика —
-- график пересобирается сам, в том же самом запросе, без отдельного шага.
--
-- КОГДА ТРИГГЕР НЕ СРАБАТЫВАЕТ (и это осознанно):
--   * payment_type <> 'installment' — у разовой оплаты и бартера нет
--     графика, который можно было бы пересчитать;
--   * installment_months не задан — распределять остаток не на сколько
--     месяцев, взять неоткуда;
--   * сумма не менялась — правка телефона клиента через ту же форму не
--     должна пересобирать и так верный график;
--   * неоплаченных строк нет вовсе — то есть график либо ещё не создан
--     (создаётся отдельной кнопкой «Сгенерировать график»), либо уже
--     полностью погашен, пересобирать нечего;
--   * новая сумма не больше уже оплаченного (NEW.amount <= NEW.paid_amount).
--     Сама regenerate_schedule в этом случае бросает исключение «Nothing
--     left to schedule» — и поскольку триггер выполняется ПОСЛЕ обновления
--     договора, это исключение откатило бы всё сохранение целиком, включая
--     саму правку суммы. Такую сумму (меньше уже полученных денег) просто
--     не с чем распределять по месяцам — расхождение при этом останется на
--     виду через баннер и кнопку «Пересчитать график» на карточке, а не
--     будет спрятано отменённым сохранением.
--
-- Оплаченные строки (receipts) триггер не трогает — это делает сама
-- regenerate_schedule (`where ... and paid = false`).
--
-- КНОПКА «ПЕРЕСЧИТАТЬ ГРАФИК» ОСТАЁТСЯ. Она нужна для договоров, у которых
-- расхождение УЖЕ есть, накопленное до этого триггера — сам триггер видит
-- только новые изменения суммы, а не чинит задним числом то, что случилось
-- раньше него.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

create or replace function crm.auto_regenerate_schedule()
returns trigger
language plpgsql
security definer
set search_path = crm, public
as $$
begin
  if NEW.payment_type = 'installment'
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

drop trigger if exists trg_auto_regenerate_schedule on crm.contracts;
create trigger trg_auto_regenerate_schedule
after update of amount on crm.contracts
for each row execute function crm.auto_regenerate_schedule();

-- ### 056_backfill_drifted_schedules.sql

-- ============================================================
-- 056: разовая чистка всех договоров, у которых график уже разошёлся с
-- суммой ДО того, как появился автоматический триггер (055).
--
-- ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ, А НЕ КНОПКА «ПЕРЕСЧИТАТЬ ГРАФИК» НА КАЖДОМ
-- ДОГОВОРЕ. Триггер 055 видит только НОВЫЕ изменения суммы — тем
-- договорам, у которых расхождение накопилось раньше (сумму меняли до
-- того, как триггер появился), он ничем не помогает: пересчитывать их
-- задним числом руками, открывая каждый по одному, при десятках и сотнях
-- договоров — не работа для человека, а работа для одного запроса.
--
-- ПОЧЕМУ НЕ ВЫЗЫВАЕТСЯ crm.regenerate_schedule() НАПРЯМУЮ. Эта функция
-- сама проверяет право на запись (crm.can_write()) через auth.uid() —
-- правильно для действия из программы, где есть авторизованный
-- пользователь. Но в SQL Editor запрос выполняется без такой сессии,
-- auth.uid() там пустой, my_role() падает на 'none', can_write() — false,
-- и вызов regenerate_schedule закончился бы «Read-only role». Поэтому
-- здесь та же самая арифметика (переписана из regenerate_schedule один в
-- один) выполняется прямыми командами, без проверки роли — сам факт того,
-- что администратор запускает файл в SQL Editor, уже и есть разрешение.
--
-- КОГО ТРОГАЕТ. Только договоры с рассрочкой, у которых сумма ГРАФИКА
-- (оплачено + план) не совпадает с суммой ДОГОВОРА больше чем на 50 дирам/
-- центов, есть хоть одна неоплаченная строка и новую сумму есть на что
-- распределять (amount > paid_amount). Уже верные договоры не трогает
-- совсем — RAISE NOTICE в конце покажет, сколько именно исправлено.
--
-- Оплаченные платежи не удаляются и не пересоздаются никогда.
--
-- Идемпотентно: повторный запуск на уже исправленных договорах найдёт
-- ноль расхождений и ничего не сделает.
-- ============================================================

do $$
declare
  v_contract record;
  v_remaining numeric;
  v_base numeric;
  v_amount numeric;
  i integer;
  v_fixed integer := 0;
begin
  for v_contract in
    select c.id, c.amount, c.paid_amount, c.installment_months
    from crm.contracts c
    where c.payment_type = 'installment'
      and c.installment_months is not null
      and c.installment_months > 0
      and c.amount > c.paid_amount
      and exists (
        select 1 from crm.contract_payments p
        where p.contract_id = c.id and p.paid = false
      )
      and abs(
        coalesce((select sum(p.amount) from crm.contract_payments p where p.contract_id = c.id), 0)
        - c.amount
      ) > 0.5
  loop
    v_remaining := v_contract.amount - v_contract.paid_amount;

    -- Только план; фактические (оплаченные) строки неприкосновенны -- та же
    -- гарантия, что и в crm.regenerate_schedule.
    delete from crm.contract_payments
    where contract_id = v_contract.id and paid = false;

    v_base := floor(v_remaining / v_contract.installment_months * 100) / 100;
    for i in 1..v_contract.installment_months loop
      if i = v_contract.installment_months then
        v_amount := round((v_remaining - v_base * (v_contract.installment_months - 1)) * 100) / 100;
      else
        v_amount := v_base;
      end if;
      insert into crm.contract_payments (contract_id, due_date, amount, paid, paid_date)
      values (v_contract.id, (current_date + (i || ' month')::interval)::date, v_amount, false, null);
    end loop;

    v_fixed := v_fixed + 1;
  end loop;

  raise notice 'Пересчитано договоров с разошедшимся графиком: %', v_fixed;
end $$;

-- ### 058_due_today_sms_template.sql

-- ============================================================
-- 058: отдельный текст SMS для «сегодня день платежа», а не тот же текст,
-- что и для напоминания за N дней вперёд.
--
-- ЧТО БЫЛО НЕ ТАК. Рассылка платежей отправляет ДВА разных напоминания по
-- одному и тому же взносу: заранее (за sms_reminder_days дней) и в день
-- самого платежа — с отдельными отметками (reminder_sent_at /
-- due_reminder_sent_at), чтобы не задвоить. Но текст брался ОДИН и тот же
-- (settings.sms_payment_template) для обоих случаев — разница была только
-- в том, какая дата подставлялась в {{due_date}}. Для «за 3 дня» это
-- звучит нормально («…до 25.08.2026»), а для «сегодня» — «…до 21.08.2026»,
-- где 21.08.2026 и есть сегодняшняя дата: смысл верный, но сообщение не
-- говорит прямо «сегодня», а вместо этого повторяет число, которое клиент
-- и так видит в календаре телефона.
--
-- ЧТО МЕНЯЕТСЯ. Новая колонка sms_due_today_template — свой текст для
-- дня платежа, с теми же плейсхолдерами. Если админ его не заполнит,
-- используется дефолт ниже; если заполнит — со дня платежа рассылка сама
-- возьмёт именно его, шаблон за N дней вперёд она не трогает.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

alter table crm.settings
  add column if not exists sms_due_today_template text;

update crm.settings
set sms_due_today_template = $tpl$Уважаемый(ая) {{client_name}}, напоминаем: сегодня срок оплаты {{amount}} {{currency}} по договору №{{contract_number}}.$tpl$
where sms_due_today_template is null;

-- ### 059_rental_units.sql

-- ============================================================
-- 059: новый вид сделки -- аренда.
--
-- Только это одно значение enum, ничего больше. ALTER TYPE ... ADD VALUE
-- нельзя использовать в той же транзакции, где новое значение потом
-- где-то СРАВНИВАЕТСЯ (в функции, ограничении и т.п.) -- Postgres прямо
-- запрещает "unsafe use of new value of enum type" в пределах одной
-- транзакции. Поэтому вся остальная работа (recompute_object_status,
-- новая колонка listing_type и т.д.) -- в 060 ниже, ПОСЛЕ явного commit --
-- не потому что это менее связанные изменения, а потому что весь этот
-- файл выполняется одним запросом (одной неявной транзакцией), и без
-- этого commit новое значение 'rent' было бы недоступно тем же функциям
-- чуть ниже, на первом же прогоне на базе, где его ещё нет.
--
-- Дальше по смыслу: сумма договора аренды -- это не цена объекта, а
-- арендная плата за весь срок (ставка × месяцев), а installment_months
-- значит срок аренды. Механика графика платежей та же, что у рассрочки
-- (см. 060) -- отдельного движка для повторяющихся платежей не нужно.
--
-- Идемпотентно, повторный запуск безопасен.
-- ============================================================

alter type crm.payment_type add value if not exists 'rent';

-- Обязательный явный commit -- см. пояснение выше. Безвреден и на
-- повторном прогоне, когда 'rent' уже существует и ничего нового не
-- добавлялось: просто фиксирует то, что уже сделано, и открывает
-- следующую неявную транзакцию для 060.
commit;

-- ### 060_rental_units_status.sql

-- ============================================================
-- 060: аренда -- остальное. Follows 059 (payment_type gained 'rent' there,
-- committed separately above -- see that block for why it had to be).
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

-- ### 061_overdue_by_building_remaining.sql

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
-- compute remaining_total (earlier in this file): the whole unpaid
-- balance of the contract (amount - paid_amount), not just its overdue
-- slice. Grouped per building+currency here instead of per contract, via
-- a small CTE so each contract's remaining is counted once even though
-- overdue_installments can carry several unpaid rows for it.
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

-- ### 062_dashboard_summary_period_scoping.sql

-- ============================================================
-- 062: paid/debt/top-debtors on the dashboard stop vanishing under
--      "Сегодня"/"Этот месяц" -- they were being filtered by the
--      contract's SIGN date, not by whether any money moved in the
--      period.
--
-- ЧТО БЫЛО НЕ ТАК. money (paid/debt) and top_debtors were both computed
-- from live_contracts, which restricts to contracts whose signed_date
-- falls inside [p_from, p_to]. That's the right scope for a SALES metric
-- ("how much did we sign this period") -- month_rev/day_rev/bld_rev
-- legitimately want exactly that. It is the wrong scope for paid/debt/
-- top_debtors: those are CURRENT-STATE totals (how much has been
-- collected in total, how much is still owed in total, who owes the
-- most right now), which have nothing to do with when a contract was
-- SIGNED. A payment received today on a contract signed six months ago
-- is real income today -- but with the "Сегодня" period picked, that
-- contract falls outside [today, today] by signed_date, so its entire
-- paid_amount (not just today's payment) silently dropped out of
-- "Даромади умумӣ", its remaining balance dropped out of "Қарзи
-- харидорон", and the client dropped out of "Бузургтарин қарздорон" --
-- while the "Воридот аз рӯи рӯз" chart right above it (built from
-- contract_payments.paid_date, not signed_date) correctly showed the
-- same payment. Two panels on the same page, same underlying event,
-- contradicting each other.
--
-- ЧТО МЕНЯЕТСЯ. A new CTE, live_state_contracts: scoped_contracts minus
-- cancelled, WITHOUT the signed_date/period restriction live_contracts
-- adds. money and debtors now read from it instead of live_contracts.
-- Building scope (p_building_id) still applies to both, same as before
-- -- only the period picker (p_from/p_to) stops touching them.
-- month_rev, day_rev, bld_rev are untouched: revenue-over-time and
-- revenue-by-building are genuinely period/sales metrics, and stay
-- exactly as period-scoped as before.
--
-- Also closes a second, smaller inconsistency found while in here:
-- day_rev joined scoped_contracts with no status filter at all, so a
-- payment recorded against a contract that was LATER cancelled still
-- counted in the daily chart, even though month_rev already excludes
-- cancelled contracts from the equivalent monthly figure. day_rev's
-- join now carries the same "status <> 'cancelled'" condition
-- month_rev's does.
--
-- Idempotent, safe to run again.
-- ============================================================

create or replace function crm.dashboard_summary(
  p_building_id uuid default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = crm, public
as $$
with
scoped_objects as (
  select o.id, o.status, o.building_id, o.price, o.currency, o.area
  from crm.objects o
  left join crm.buildings b on b.id = o.building_id
  where case
          when p_building_id is not null then o.building_id = p_building_id
          else coalesce(b.construction_status, 'in_progress') <> 'completed'
        end
),
scoped_contracts as (
  select c.id, c.client_id, c.amount, c.paid_amount, c.currency,
         c.signed_date, c.status, so.building_id
  from crm.contracts c
  join scoped_objects so on so.id = c.object_id
),
-- Every live (not cancelled) contract in scope, with NO date restriction.
-- The one thing paid/debt/top_debtors actually want: today's, this
-- month's and this year's totals are all the same number, because those
-- three are a snapshot of current state, not a flow during the period.
live_state_contracts as (
  select *
  from scoped_contracts
  where status <> 'cancelled'
),
-- Same, but additionally restricted to contracts SIGNED inside the
-- chosen period -- for the metrics that actually mean "sales this
-- period" (month_rev, day_rev's contract lookup, bld_rev).
live_contracts as (
  select *
  from live_state_contracts
  where (p_from is null or (signed_date is not null and signed_date >= p_from))
    and (p_to   is null or (signed_date is not null and signed_date <= p_to))
),
rel_buildings as (
  select b.id, b.name
  from crm.buildings b
  where case
          when p_building_id is not null then b.id = p_building_id
          else b.construction_status <> 'completed'
        end
),
obj_stats as (
  select
    (count(*))::int                                             as total,
    (count(*) filter (where status = 'available'))::int         as available,
    (count(*) filter (where status = 'reserved'))::int          as reserved,
    (count(*) filter (where status = 'sold'))::int              as sold,
    (count(*) filter (where status = 'in_progress'))::int       as in_progress,
    coalesce(sum(area), 0)                                      as area_total,
    coalesce(sum(area) filter (where status = 'available'), 0)   as area_available,
    coalesce(sum(area) filter (where status = 'reserved'), 0)    as area_reserved,
    coalesce(sum(area) filter (where status = 'sold'), 0)        as area_sold,
    coalesce(sum(area) filter (where status = 'rented'), 0)      as area_rented,
    coalesce(sum(area) filter (where status = 'in_progress'), 0) as area_in_progress,
    coalesce(sum(price) filter (where status <> 'sold' and currency <> 'USD'), 0) as pot_tjs,
    coalesce(sum(price) filter (where status <> 'sold' and currency  = 'USD'), 0) as pot_usd,
    (count(*) filter (where status <> 'sold' and price is not null and price > 0))::int
      as pot_units,
    (count(*) filter (where status <> 'sold' and (price is null or price = 0)))::int
      as pot_no_price
  from scoped_objects
),
money as (
  select
    coalesce(sum(paid_amount) filter (where currency <> 'USD'), 0) as paid_tjs,
    coalesce(sum(paid_amount) filter (where currency  = 'USD'), 0) as paid_usd,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency <> 'USD'), 0) as debt_tjs,
    coalesce(sum(greatest(amount - paid_amount, 0)) filter (where currency  = 'USD'), 0) as debt_usd
  from live_state_contracts
),
overdue as (
  select
    coalesce(sum(oi.unpaid_amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(oi.unpaid_amount) filter (where c.currency  = 'USD'), 0) as usd,
    (count(distinct c.id))::int                                          as contracts
  from crm.overdue_installments oi
  join scoped_contracts c on c.id = oi.contract_id
  where oi.due_date < current_date
    and oi.unpaid_amount > 0.005
    and c.status <> 'cancelled'
),
-- The end of the window: the last month that actually has a signing, so the
-- chart lands where the data is even if the newest contract is not this month.
month_end as (
  select coalesce(
           date_trunc('month', max(signed_date)),
           date_trunc('month', current_date)
         ) as m
  from scoped_contracts
  where status <> 'cancelled' and signed_date is not null
),
-- Six consecutive calendar months. A month with no sales must be a zero on the
-- axis, not a missing point.
month_axis as (
  select to_char(g, 'YYYY-MM') as month
  from month_end me,
       generate_series(me.m - interval '5 months', me.m, interval '1 month') as g
),
month_rev as (
  select
    ax.month,
    coalesce(sum(c.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(c.amount) filter (where c.currency  = 'USD'), 0) as usd
  from month_axis ax
  left join scoped_contracts c
         on c.status <> 'cancelled'
        and c.signed_date is not null
        and to_char(c.signed_date, 'YYYY-MM') = ax.month
  group by ax.month
  order by ax.month
),
-- Same treatment for the daily chart: every day in the chosen period appears,
-- including the ones with no money received.
day_axis as (
  select g::date as day
  from generate_series(
         coalesce(p_from, current_date),
         coalesce(p_to, current_date),
         interval '1 day'
       ) as g
  where p_from is not null and p_to is not null
),
day_rev as (
  select
    ax.day,
    coalesce(sum(p.amount) filter (where c.currency <> 'USD'), 0) as tjs,
    coalesce(sum(p.amount) filter (where c.currency  = 'USD'), 0) as usd
  from day_axis ax
  left join crm.contract_payments p
         on p.paid and p.paid_date = ax.day
  left join scoped_contracts c
         on c.id = p.contract_id
        and c.status <> 'cancelled'
  group by ax.day
  order by ax.day
),
occ as (
  select
    rb.id, rb.name,
    (count(*))::int                                          as total,
    (count(*) filter (where so.status = 'available'))::int    as available,
    (count(*) filter (where so.status = 'reserved'))::int     as reserved,
    (count(*) filter (where so.status = 'sold'))::int         as sold,
    (count(*) filter (where so.status = 'rented'))::int       as rented,
    (count(*) filter (where so.status = 'in_progress'))::int  as in_progress
  from rel_buildings rb
  join scoped_objects so on so.building_id = rb.id
  group by rb.id, rb.name
),
bld_rev as (
  select
    rb.id, rb.name,
    coalesce(sum(lc.amount) filter (where lc.currency <> 'USD'), 0) as tjs,
    coalesce(sum(lc.amount) filter (where lc.currency  = 'USD'), 0) as usd
  from rel_buildings rb
  join live_contracts lc on lc.building_id = rb.id
  group by rb.id, rb.name
),
debtors as (
  select
    lc.client_id,
    cl.name,
    lc.currency::text                       as currency,
    sum(lc.amount - lc.paid_amount)         as remaining
  from live_state_contracts lc
  join crm.clients cl on cl.id = lc.client_id
  where lc.amount - lc.paid_amount > 0
  group by 1, 2, 3
  order by 4 desc
  limit 5
),
completed as (
  select
    (select count(*) from crm.buildings where construction_status = 'completed')::int as buildings,
    (select count(*)
       from crm.objects o
       join crm.buildings b on b.id = o.building_id
      where b.construction_status = 'completed')::int as units
)
select jsonb_build_object(
  'counts', (
    select jsonb_build_object(
      'total', total, 'available', available, 'reserved', reserved,
      'sold', sold, 'in_progress', in_progress
    ) from obj_stats
  ),
  'area', (select jsonb_build_object('total', area_total, 'available', area_available) from obj_stats),
  'area_split', (
    select jsonb_build_object(
      'sold', area_sold, 'reserved', area_reserved, 'available', area_available,
      'rented', area_rented, 'in_progress', area_in_progress
    ) from obj_stats
  ),
  'potential', (select jsonb_build_object('tjs', pot_tjs, 'usd', pot_usd) from obj_stats),
  'potential_units', (select pot_units from obj_stats),
  'potential_no_price', (select pot_no_price from obj_stats),
  'paid', (select jsonb_build_object('tjs', paid_tjs, 'usd', paid_usd) from money),
  'debt', (select jsonb_build_object('tjs', debt_tjs, 'usd', debt_usd) from money),
  'overdue', (select jsonb_build_object('tjs', tjs, 'usd', usd) from overdue),
  'overdue_contracts', (select contracts from overdue),
  'revenue_months', coalesce((
    select jsonb_agg(jsonb_build_object('month', month, 'tjs', tjs, 'usd', usd) order by month)
    from month_rev
  ), '[]'::jsonb),
  'revenue_days', coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'tjs', tjs, 'usd', usd) order by day)
    from day_rev
  ), '[]'::jsonb),
  'occupancy', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'total', total,
      'available', available, 'reserved', reserved, 'sold', sold,
      'rented', rented, 'in_progress', in_progress
    ) order by name)
    from occ
  ), '[]'::jsonb),
  'revenue_by_building', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'tjs', tjs, 'usd', usd)
                     order by (tjs + usd) desc)
    from bld_rev where tjs > 0 or usd > 0
  ), '[]'::jsonb),
  'top_debtors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id', client_id, 'name', name, 'currency', currency, 'remaining', remaining
    ) order by remaining desc)
    from debtors
  ), '[]'::jsonb),
  'completed', (select jsonb_build_object('buildings', buildings, 'units', units) from completed)
);
$$;

grant execute on function crm.dashboard_summary(uuid, date, date) to authenticated;

-- ### 063_sms_broadcast_recipients.sql

-- ============================================================
-- 063: crm.sms_broadcast_recipients() -- who a custom SMS broadcast
--      reaches, for one of three audiences.
--
-- Backs the "Своя рассылка" feature in Settings → SMS: an admin writes
-- their own text (not one of the two fixed payment-reminder templates)
-- and sends it to either every client, everyone with a contract in one
-- chosen building, or everyone currently overdue -- the exact scenario
-- that prompted this ("дом сдан, приходите за ключами" needs every
-- buyer in THAT building, not a payment reminder).
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
