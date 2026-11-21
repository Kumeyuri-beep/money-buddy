-- Invest v2 รอบที่ 2 · Categories (หมวดของผู้ใช้ + เป้า % ต่อหมวด) · docs/proposals/R2-categories.md (เจ้าของอนุมัติ 21 พ.ย. 2569)
-- **migration แบบ "เพิ่ม" เท่านั้น:** add column / create table / create index / create function / create or replace function
-- (ไม่มี drop / delete ข้อมูลเดิม / truncate / เปลี่ยนชนิดคอลัมน์) · ข้อมูลเดิมไม่ถูกแตะ: assets ได้คอลัมน์ใหม่ที่เป็น null
-- ประกอบด้วย: (1) assets.sector/category_id (2) ตาราง asset_categories + ด่าน + RLS (3) save_categories
--             (4) create or replace reset_my_ledger / reset_my_ledger_step / import_ledger_abort ให้ล้าง asset_categories ด้วย (PDPA)
--             (5) create or replace import_ledger_investments ให้นำเข้า categories/sector/categoryId (ไฟล์สำรองรุ่นเก่าที่ไม่มีหมวดยังนำเข้าได้)

-- ---------------------------------------------------------------------------
-- 1. คอลัมน์ใหม่บน assets (ไม่บังคับ)
-- ---------------------------------------------------------------------------
alter table public.assets add column sector text
  check (sector is null or (char_length(sector) between 1 and 60 and sector = btrim(sector)
         and sector !~ E'[\\x01-\\x1F\\x7F-\\x9F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'
         and sector !~ E'^[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]|[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]$'));
alter table public.assets add column category_id text;

-- ---------------------------------------------------------------------------
-- 2. asset_categories
-- ---------------------------------------------------------------------------
create table public.asset_categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100 and id !~ E'[\\x01-\\x1F\\x7F-\\x9F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'),
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name)
    and name !~ E'[\\x01-\\x1F\\x7F-\\x9F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]'
    and name !~ E'^[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]|[\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]$'),
  -- กุญแจชื่อไม่สนตัวพิมพ์ ใช้กับ unique แบบ deferrable (สลับชื่อสองหมวดในการบันทึกครั้งเดียวได้)
  name_key text generated always as (lower(name)) stored,
  target_bps integer check (target_bps is null or (target_bps between 0 and 10000)),
  sort_order integer not null default 0 check (sort_order between 0 and 1000),
  created_at timestamptz not null default now()
    check (created_at >= timestamptz '1900-01-01 00:00:00+00' and created_at < timestamptz '3000-01-01 00:00:00+00'),
  primary key (user_id, id),
  constraint asset_categories_name_uniq unique (user_id, name_key) deferrable initially deferred
);

alter table public.assets
  add constraint assets_category_fk foreign key (user_id, category_id)
  references public.asset_categories (user_id, id) on delete set null (category_id);
create index assets_user_category_idx on public.assets (user_id, category_id) where category_id is not null;

-- เพดาน 50 หมวดต่อผู้ใช้ (ตรวจระดับคำสั่งเหมือน private.enforce_invest_limits)
create function private.enforce_category_limit() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid;
  v_n bigint;
begin
  for v_user in select distinct user_id from new_rows loop
    perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text)); -- กันสองคำสั่งที่เขียนพร้อมกันผ่านเพดานทั้งคู่ (นับหลังได้ล็อก เห็นข้อมูลของคำสั่งที่ commit ก่อน)
    select count(*) into v_n from public.asset_categories where user_id = v_user;
    if v_n > 50 then
      raise exception 'จำนวนหมวดเกินเพดาน (50 หมวดต่อผู้ใช้)' using errcode = '54000';
    end if;
  end loop;
  return null;
end
$$;
create trigger asset_categories_limit_trg after insert on public.asset_categories
  referencing new table as new_rows for each statement execute function private.enforce_category_limit();

-- เป้ารวม = 100% (deferred: ตรวจตอน commit) · ข้าม role ผู้ดูแลเหมือนด่านเดิมทุกตัว (ลบผู้ใช้ทั้งบัญชีทำงานด้วย role เหล่านี้)
-- **คำเตือนสำหรับอนาคต:** การข้าม role ผู้ดูแลหมายความว่า security definer function ที่แก้หมวดแค่บางส่วนจะข้ามด่านนี้โดยไม่ตั้งใจ ต้องเขียนให้ชุดหมวดครบและรวม 100% เสมอ
create function private.categories_target_check() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid;
  v_n integer;
  v_set integer;
  v_sum bigint;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return null;
  end if;
  v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  -- ล็อกต่อผู้ใช้ก่อนนับ: ธุรกรรมที่ commit ทีหลังเห็นผลของที่ commit ก่อน (READ COMMITTED) จึงไม่ผ่านด่านพร้อมกันทั้งคู่
  perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text));
  select count(*), count(target_bps), coalesce(sum(target_bps), 0) into v_n, v_set, v_sum
    from public.asset_categories where user_id = v_user;
  if v_set > 0 and (v_set <> v_n or v_sum <> 10000) then
    raise exception 'เป้ารวมของทุกหมวดต้องเท่ากับ 100%% (ตั้งเป้าให้ครบทุกหมวด)' using errcode = '23514';
  end if;
  return null;
end
$$;
create constraint trigger asset_categories_target_trg
  after insert or update or delete on public.asset_categories
  deferrable initially deferred for each row execute function private.categories_target_check();

-- RLS: แพทเทิร์นเดียวกับ assets/trades (เจ้าของแถว + ด่านเปลี่ยนรหัส + ล็อกขณะนำเข้า)
alter table public.asset_categories enable row level security;
create policy asset_categories_own on public.asset_categories as permissive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy asset_categories_gate on public.asset_categories as restrictive for all to authenticated
  using ((select private.can_use_data())) with check ((select private.can_use_data()));
create policy asset_categories_import_lock_ins on public.asset_categories as restrictive for insert to authenticated
  with check ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
create policy asset_categories_import_lock_upd on public.asset_categories as restrictive for update to authenticated
  using ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on')
  with check ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
create policy asset_categories_import_lock_del on public.asset_categories as restrictive for delete to authenticated
  using ((not (select private.import_session_exists())) or coalesce(current_setting('app.import_ledger', true), '') = 'on');
revoke all on public.asset_categories from public, anon, authenticated;
grant select, insert, update, delete on public.asset_categories to authenticated;

-- ---------------------------------------------------------------------------
-- 3. save_categories: บันทึกหมวด + การจัดหมวด/sector ของสินทรัพย์ในธุรกรรมเดียว (security invoker: RLS บังคับใช้)
--    p_categories = [{id,name,targetBps,sortOrder}] ทั้งชุด (ที่ไม่อยู่ในชุด = ถูกลบ · สินทรัพย์ในหมวดที่ถูกลบกลับเป็น null)
--    p_assignments = [{assetId, categoryId?, sector?}] เฉพาะ key ที่ส่งมาเท่านั้นที่เปลี่ยน
-- ---------------------------------------------------------------------------
create function public.save_categories(p_categories jsonb, p_assignments jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_c jsonb;
  v_a jsonb;
  v_n integer;
  v_assign jsonb := coalesce(p_assignments, '[]'::jsonb);
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if private.import_session_exists() then
    raise exception 'กำลังนำเข้าข้อมูล ทำรายการนี้ไม่ได้ในตอนนี้' using errcode = '55000';
  end if;
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_typeof(v_assign) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(p_categories) > 50 or jsonb_array_length(v_assign) > 200
     or pg_column_size(p_categories) > 65536 or pg_column_size(v_assign) > 65536 then
    raise exception 'ข้อมูลมากเกินกำหนด' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_categories) x
              where jsonb_typeof(x) is distinct from 'object'
                 or coalesce(x->>'targetBps', '0') !~ '^[0-9]{1,5}$'
                 or coalesce(x->>'sortOrder', '0') !~ '^[0-9]{1,4}$')
     or exists (select 1 from jsonb_array_elements(v_assign) x where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  -- กันสองแท็บบันทึกพร้อมกัน แม้ผู้ใช้ยังไม่มีหมวดเลย (แบบเดียวกับ import_ledger_investments)
  perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text));
  delete from public.asset_categories c
   where c.user_id = v_user
     and c.id not in (select x->>'id' from jsonb_array_elements(p_categories) x);
  for v_c in select * from jsonb_array_elements(p_categories) loop
    insert into public.asset_categories (id, name, target_bps, sort_order)
    values (v_c->>'id', v_c->>'name', (v_c->>'targetBps')::integer, coalesce((v_c->>'sortOrder')::integer, 0))
    on conflict (user_id, id) do update
      set name = excluded.name, target_bps = excluded.target_bps, sort_order = excluded.sort_order;
  end loop;
  for v_a in select * from jsonb_array_elements(v_assign) loop
    update public.assets a set
      category_id = case when v_a ? 'categoryId' then v_a->>'categoryId' else a.category_id end,
      sector = case when v_a ? 'sector' then nullif(v_a->>'sector', '') else a.sector end
     where a.user_id = v_user and a.id = v_a->>'assetId';
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'ไม่พบสินทรัพย์ที่จะจัดหมวด' using errcode = '23503';
    end if;
  end loop;
  return jsonb_build_object('categories', jsonb_array_length(p_categories), 'assignments', jsonb_array_length(v_assign));
end
$$;
revoke all on function public.save_categories(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_categories(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ล้างข้อมูล/ยกเลิกนำเข้าต้องล้างหมวดด้วย (asset_categories ไม่ผูกกับ accounts จึงไม่ถูก cascade)
--    นิยามเดิมทุกบรรทัดคงไว้ (ดึงจากฐานข้อมูลจริง 21 พ.ย. 2569) เพิ่มเฉพาะบรรทัดลบหมวด · ลายเซ็น/สิทธิ์ไม่เปลี่ยน (create or replace)
-- ---------------------------------------------------------------------------
create or replace function public.reset_my_ledger(p_password text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
  v_recent integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'ต้องเรียกแบบเขียนได้ (POST) เท่านั้น' using errcode = '25006';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform private.assert_password_cooled(v_user);
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  delete from private.delete_attempts where user_id = v_user and at < now() - interval '1 day';
  select count(*) into v_recent from private.delete_attempts
   where user_id = v_user and at > now() - interval '15 minutes';
  if v_recent >= 5 then
    raise exception 'ลองผิดหลายครั้งเกินไป ลองใหม่ภายหลัง' using errcode = '53400';
  end if;
  insert into private.delete_attempts (user_id) values (v_user);
  select u.encrypted_password into v_hash from auth.users u where u.id = v_user;
  if v_hash is null or p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    return false;
  end if;
  delete from public.entries where user_id = v_user;
  delete from public.bills where user_id = v_user;
  delete from public.asset_categories where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return true;
end
$$;

create or replace function public.reset_my_ledger_step(p_password text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if not private.deletion_gate(p_password) then
    return 'wrong';
  end if;
  if private.delete_entry_batch(v_user) then
    return 'more';
  end if;
  delete from public.bills where user_id = v_user;
  delete from public.asset_categories where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;

create or replace function public.import_ledger_abort() returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'ต้องเรียกแบบเขียนได้ (POST) เท่านั้น' using errcode = '25006';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if not exists (select 1 from private.import_sessions where user_id = v_user) then
    return 'none';
  end if;
  if private.delete_entry_batch(v_user) then
    return 'more';
  end if;
  delete from public.bills where user_id = v_user;
  delete from public.asset_categories where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;

-- ---------------------------------------------------------------------------
-- 5. import_ledger_investments: นำเข้า categories + assets.sector/categoryId (ไฟล์สำรองรุ่นเก่าไม่มีหมวด = นำเข้าได้เหมือนเดิม)
--    นิยามเดิมคงไว้ทุกข้อ (ดึงจากฐานข้อมูลจริง 21 พ.ย. 2569) เพิ่มเฉพาะส่วนหมวด
-- ---------------------------------------------------------------------------
create or replace function public.import_ledger_investments(p_data jsonb) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_categories integer := 0;
  v_assets integer;
  v_prices integer;
  v_trades integer;
  v_fx_rates integer := 0;
  v_fx_exchanges integer := 0;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(coalesce(p_data->'categories', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'assets', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'prices', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'trades', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'fxRates', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'fxExchanges', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(coalesce(p_data->'categories', '[]'::jsonb)) > 50
     or jsonb_array_length(coalesce(p_data->'assets', '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_data->'prices', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'trades', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'fxRates', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'fxExchanges', '[]'::jsonb)) > 10000 then
    raise exception 'ข้อมูลลงทุนมากเกินเพดาน (หมวดไม่เกิน 50 · สินทรัพย์ไม่เกิน 200 · รายการ ราคา อัตรา และการแลกเงินอย่างละไม่เกิน 10,000)' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(
         coalesce(p_data->'categories', '[]'::jsonb) || coalesce(p_data->'assets', '[]'::jsonb) || coalesce(p_data->'prices', '[]'::jsonb)
         || coalesce(p_data->'trades', '[]'::jsonb) || coalesce(p_data->'fxRates', '[]'::jsonb) || coalesce(p_data->'fxExchanges', '[]'::jsonb)) x
        where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง (แต่ละแถวต้องเป็นวัตถุ)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text)); -- ล็อกเดียวกับ save_categories และ trigger หมวด
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ นำเข้าข้อมูลลงทุนไม่ได้' using errcode = '55000';
  end if;
  if exists (select 1 from public.assets where user_id = v_user)
     or exists (select 1 from public.asset_categories where user_id = v_user)
     or exists (select 1 from public.fx_rates where user_id = v_user)
     or exists (select 1 from public.fx_exchanges where user_id = v_user) then
    raise exception 'มีข้อมูลลงทุนอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;
  insert into public.asset_categories (user_id, id, name, target_bps, sort_order)
  select v_user, e->>'id', e->>'name', (e->>'targetBps')::integer, coalesce((e->>'sortOrder')::integer, 0)
    from jsonb_array_elements(coalesce(p_data->'categories', '[]'::jsonb)) e;
  get diagnostics v_categories = row_count;
  insert into public.assets (user_id, id, name, kind, account_id, archived, instrument_currency, ticker, exchange, sector, category_id)
  select v_user, e->>'id', e->>'name', coalesce(e->>'kind', 'fund'), e->>'accountId', coalesce((e->>'archived')::boolean, false),
         coalesce(e->>'currency', 'THB'), e->>'ticker', e->>'exchange', nullif(e->>'sector', ''), nullif(e->>'categoryId', '')
    from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb)) e;
  get diagnostics v_assets = row_count;
  insert into public.asset_prices (user_id, asset_id, date, price_micro)
  select v_user, e->>'assetId', (e->>'date')::date, (e->>'priceMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'prices', '[]'::jsonb)) e;
  get diagnostics v_prices = row_count;
  perform set_config('app.invest_import', 'on', true);
  insert into public.trades (user_id, id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id, fx_rate_micro)
  select v_user, e->>'id', e->>'assetId', e->>'kind', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()),
         e->>'units', (e->>'priceMicro')::bigint, (e->>'amount')::bigint,
         coalesce((e->>'fee')::bigint, 0), coalesce((e->>'withholding')::bigint, 0), coalesce(e->>'memo', ''), e->>'entryId',
         (e->>'fxRateMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'trades', '[]'::jsonb)) e;
  get diagnostics v_trades = row_count;
  insert into public.fx_rates (user_id, account_id, date, rate_micro)
  select v_user, e->>'accountId', (e->>'date')::date, (e->>'rateMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'fxRates', '[]'::jsonb)) e;
  get diagnostics v_fx_rates = row_count;
  insert into public.fx_exchanges (user_id, id, date, created_at, direction, thb_satang, usd_cents, rate_micro, memo, entry_id)
  select v_user, e->>'id', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()), e->>'direction',
         (e->>'thbSatang')::bigint, (e->>'usdCents')::bigint, (e->>'rateMicro')::bigint, coalesce(e->>'memo', ''), e->>'entryId'
    from jsonb_array_elements(coalesce(p_data->'fxExchanges', '[]'::jsonb)) e;
  get diagnostics v_fx_exchanges = row_count;
  perform set_config('app.invest_import', '', true);
  if exists (
    select 1 from public.fx_exchanges x
     where x.user_id = v_user
       and not exists (
         select 1 from public.entries e
          where e.user_id = x.user_id and e.id = x.entry_id and e.date = x.date
            and (select count(*) from public.lines l where l.user_id = e.user_id and l.entry_id = e.id) = 4
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'asset' and a.currency = 'THB'
                    and l.amount = case when x.direction = 'thb_to_usd' then -x.thb_satang else x.thb_satang end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'equity' and a.currency = 'THB'
                    and l.amount = case when x.direction = 'thb_to_usd' then x.thb_satang else -x.thb_satang end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'asset' and a.currency = 'USD' and a.kind = 'investment'
                    and l.amount = case when x.direction = 'thb_to_usd' then x.usd_cents else -x.usd_cents end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'equity' and a.currency = 'USD'
                    and l.amount = case when x.direction = 'thb_to_usd' then -x.usd_cents else x.usd_cents end) = 1)
  ) then
    raise exception 'รายการแลกเงินที่นำเข้าไม่ตรงกับรายการในสมุดบัญชีที่ผูกอยู่ (วันที่ จำนวน หรือบัญชีไม่ตรง)' using errcode = '23514';
  end if;
  v_out := jsonb_build_object('assets', v_assets, 'prices', v_prices, 'trades', v_trades);
  if v_categories > 0 then v_out := v_out || jsonb_build_object('categories', v_categories); end if;
  if v_fx_rates > 0 then v_out := v_out || jsonb_build_object('fxRates', v_fx_rates); end if;
  if v_fx_exchanges > 0 then v_out := v_out || jsonb_build_object('fxExchanges', v_fx_exchanges); end if;
  return v_out;
end
$$;
