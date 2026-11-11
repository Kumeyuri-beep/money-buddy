-- นำเข้า/ส่งออกไฟล์สำรอง: รู้จักป้ายบัญชี (accounts.kind) และข้อมูลลงทุน (พอร์ตลงทุน ต้องเสร็จก่อน P3)
-- แผน docs/plans/2026-11-11-invest-portfolio-dca.md · **ฉบับร่าง (DRAFT) รอเจ้าของอนุมัติ · ต้องใส่หลัง 20261111000100_invest_schema**
--
-- เปลี่ยน 3 อย่าง (ฟังก์ชันเดิมคงลายเซ็น/สิทธิ์/ด่านเดิมทุกข้อ เปลี่ยนเฉพาะบรรทัดเพิ่มบัญชี):
--  1) import_ledger (ครั้งเดียว) และ import_ledger_begin (แบ่งก้อน): เพิ่มคอลัมน์ kind ตอนเพิ่มบัญชี (ไม่มี = 'normal')
--     ถ้าไม่ทำ บัญชีลงทุนที่นำเข้าจะกลายเป็นบัญชีทั่วไปและถูกนับเป็นเงินสดเงียบๆ (ผลตรวจ money-auditor/security-auditor)
--     ค่า kind แปลกถูก check ของตารางปฏิเสธ · ตัวคัดลอกฟังก์ชันสร้างจากไฟล์ 20261108001100 และ 20261109000200 โดยสคริปต์
--  2) import_ledger_investments(p_data): นำเข้า assets / asset_prices / trades ในธุรกรรมเดียว (อะตอมมิก) เรียก "หลัง" นำเข้าสมุดเสร็จ
--     (trades.entry_id ต้องชี้ Entry ที่มีอยู่แล้ว) · ปฏิเสธถ้ามีเซสชันนำเข้าค้างอยู่ หรือมีข้อมูลลงทุนอยู่แล้ว (ไม่ทับ)
--     SECURITY INVOKER: RLS/ด่านเปลี่ยนรหัส/เพดานแถว (assets 200, trades/prices 10,000)/ตรวจบัญชีลงทุนมีผลเต็ม · ใส่แบบชุดเดียวต่อตาราง
--     (เพดานแถวนับระดับคำสั่ง) · ล้มกลางทาง = ย้อนกลับทั้งก้อน เรียกซ้ำได้

-- 1a) import_ledger (ครั้งเดียว) · คัดลอกจาก 20261108001100 เปลี่ยนเฉพาะการเพิ่มบัญชี (kind)
create or replace function public.import_ledger(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_accounts integer := 0;
  v_bills integer := 0;
  v_entries integer := 0;
  v_lines integer;
  v_max_lines integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'accounts') is distinct from 'array'
     or jsonb_typeof(p_data->'entries') is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'bills', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'settings', '{}'::jsonb)) is distinct from 'object' then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(p_data->'accounts') > 2000
     or jsonb_array_length(p_data->'entries') > 1500
     or jsonb_array_length(coalesce(p_data->'bills', '[]'::jsonb)) > 2000 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (รายการไม่เกิน 1,500)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_data->'entries') e where jsonb_typeof(e->'lines') is distinct from 'array') then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง (lines)' using errcode = '22023';
  end if;
  select coalesce(sum(jsonb_array_length(e->'lines')), 0), coalesce(max(jsonb_array_length(e->'lines')), 0)
    into v_lines, v_max_lines
    from jsonb_array_elements(p_data->'entries') e;
  if v_lines > 20000 or v_max_lines > 200 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (บรรทัดต่อรายการไม่เกิน 200 รวมไม่เกิน 20,000)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user)
     or exists (select 1 from public.bills where user_id = v_user)
     or exists (select 1 from public.settings where user_id = v_user) then
    raise exception 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  perform set_config('app.setup_ledger', 'on', true);
  perform set_config('app.import_ledger', 'on', true);

  for v_item in select * from jsonb_array_elements(p_data->'accounts') loop
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order, kind)
    values (
      v_user, v_item->>'id', v_item->>'type', v_item->>'name', v_item->>'currency',
      coalesce((v_item->>'archived')::boolean, false), (v_item->>'sortOrder')::integer,
      coalesce(v_item->>'kind', 'normal')
    );
    v_accounts := v_accounts + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_data->'bills', '[]'::jsonb)) loop
    insert into public.bills (user_id, id, name, amount, due_day, wallet_id, category_id, last_paid_month, start_month, archived)
    values (
      v_user, v_item->>'id', v_item->>'name', (v_item->>'amount')::bigint, (v_item->>'dueDay')::smallint,
      v_item->>'walletId', v_item->>'categoryId', v_item->>'lastPaidMonth', v_item->>'startMonth',
      coalesce((v_item->>'archived')::boolean, false)
    );
    v_bills := v_bills + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(p_data->'entries') loop
    perform private.insert_entry(v_item);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  if p_data->'settings' is not null and p_data->'settings' <> '{}'::jsonb then
    insert into public.settings (user_id, value) values (v_user, p_data->'settings');
  end if;

  return jsonb_build_object('accounts', v_accounts, 'bills', v_bills, 'entries', v_entries);
end
$$;

revoke all on function public.import_ledger(jsonb) from public, anon, authenticated;
grant execute on function public.import_ledger(jsonb) to authenticated;

-- 1b) import_ledger_begin (แบ่งก้อน) · คัดลอกจาก 20261109000200 เปลี่ยนเฉพาะการเพิ่มบัญชี (kind)
create or replace function public.import_ledger_begin(p_data jsonb, p_total_entries integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_accounts integer := 0;
  v_bills integer := 0;
  v_entries integer := 0;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'accounts') is distinct from 'array'
     or jsonb_typeof(p_data->'entries') is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'bills', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'settings', '{}'::jsonb)) is distinct from 'object' then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_total_entries is null or p_total_entries < 1 or p_total_entries > 10000
     or jsonb_array_length(p_data->'entries') > p_total_entries then
    raise exception 'จำนวนรายการทั้งหมดไม่ถูกต้อง (1-10,000)' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'accounts') < 1 then
    raise exception 'ต้องมีอย่างน้อย 1 บัญชี' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'accounts') > 2000 or jsonb_array_length(coalesce(p_data->'bills', '[]'::jsonb)) > 2000 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (บัญชี/บิลไม่เกิน 2,000)' using errcode = '22023';
  end if;
  perform private.check_import_entries(p_data->'entries');

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user)
     or exists (select 1 from public.bills where user_id = v_user)
     or exists (select 1 from public.settings where user_id = v_user)
     or private.import_session_exists() then
    raise exception 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  perform private.import_session_open(p_total_entries);

  perform set_config('app.setup_ledger', 'on', true);
  perform set_config('app.import_ledger', 'on', true);

  for v_item in select * from jsonb_array_elements(p_data->'accounts') loop
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order, kind)
    values (
      v_user, v_item->>'id', v_item->>'type', v_item->>'name', v_item->>'currency',
      coalesce((v_item->>'archived')::boolean, false), (v_item->>'sortOrder')::integer,
      coalesce(v_item->>'kind', 'normal')
    );
    v_accounts := v_accounts + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_data->'bills', '[]'::jsonb)) loop
    insert into public.bills (user_id, id, name, amount, due_day, wallet_id, category_id, last_paid_month, start_month, archived)
    values (
      v_user, v_item->>'id', v_item->>'name', (v_item->>'amount')::bigint, (v_item->>'dueDay')::smallint,
      v_item->>'walletId', v_item->>'categoryId', v_item->>'lastPaidMonth', v_item->>'startMonth',
      coalesce((v_item->>'archived')::boolean, false)
    );
    v_bills := v_bills + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(p_data->'entries') loop
    perform private.insert_entry(v_item);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  if p_data->'settings' is not null and p_data->'settings' <> '{}'::jsonb then
    insert into public.settings (user_id, value) values (v_user, p_data->'settings');
  end if;

  -- ก้อนแรกครบทั้งไฟล์พอดี = ปิดเซสชันทันที
  return jsonb_build_object(
    'accounts', v_accounts, 'bills', v_bills, 'entries', v_entries,
    'done', case when v_entries > 0 then private.import_session_advance(v_entries) else false end
  );
end
$$;

-- 2) นำเข้าข้อมูลลงทุน
create function public.import_ledger_investments(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_assets integer;
  v_prices integer;
  v_trades integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(coalesce(p_data->'assets', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'prices', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'trades', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(coalesce(p_data->'assets', '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_data->'prices', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'trades', '[]'::jsonb)) > 10000 then
    raise exception 'ข้อมูลลงทุนมากเกินเพดาน (สินทรัพย์ไม่เกิน 200 · รายการและราคาไม่เกิน 10,000)' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb) || coalesce(p_data->'prices', '[]'::jsonb) || coalesce(p_data->'trades', '[]'::jsonb)) x
        where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง (แต่ละแถวต้องเป็นวัตถุ)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ นำเข้าข้อมูลลงทุนไม่ได้' using errcode = '55000';
  end if;
  if exists (select 1 from public.assets where user_id = v_user) then
    raise exception 'มีข้อมูลลงทุนอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  insert into public.assets (user_id, id, name, kind, account_id, archived)
  select v_user, e->>'id', e->>'name', coalesce(e->>'kind', 'fund'), e->>'accountId', coalesce((e->>'archived')::boolean, false)
    from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb)) e;
  get diagnostics v_assets = row_count;

  insert into public.asset_prices (user_id, asset_id, date, price_micro)
  select v_user, e->>'assetId', (e->>'date')::date, (e->>'priceMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'prices', '[]'::jsonb)) e;
  get diagnostics v_prices = row_count;

  insert into public.trades (user_id, id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id)
  select v_user, e->>'id', e->>'assetId', e->>'kind', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()),
         e->>'units', (e->>'priceMicro')::bigint, (e->>'amount')::bigint,
         coalesce((e->>'fee')::bigint, 0), coalesce((e->>'withholding')::bigint, 0), coalesce(e->>'memo', ''), e->>'entryId'
    from jsonb_array_elements(coalesce(p_data->'trades', '[]'::jsonb)) e;
  get diagnostics v_trades = row_count;

  return jsonb_build_object('assets', v_assets, 'prices', v_prices, 'trades', v_trades);
end
$$;

revoke all on function public.import_ledger_investments(jsonb) from public, anon, authenticated;
grant execute on function public.import_ledger_investments(jsonb) to authenticated;
