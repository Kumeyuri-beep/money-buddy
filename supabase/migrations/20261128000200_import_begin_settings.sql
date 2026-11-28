-- แก้บั๊ก: นำเข้าแบบแบ่งก้อนที่ไฟล์มีค่าตั้งค่า ถูก RLS ปฏิเสธ (พบ 28 พ.ย. 2569 โดย money-auditor)
-- ใส่ฐานข้อมูลแล้ว 28 พ.ย. 2569 (เจ้าของอนุมัติ) · เทสต์ SQL หลังใส่ผ่านครบ 32/32 ไฟล์
--
-- สาเหตุ: import_ledger_begin เปิดเซสชันนำเข้าก่อน แล้วปิดตัวแปร app.import_ledger ก่อน insert ลง settings
--   policy settings_import_lock_ins (restrictive) ยอมให้ insert ขณะมีเซสชันเฉพาะเมื่อ app.import_ledger = 'on' → 42501 ย้อนกลับทั้งก้อน
-- ทางแก้: ย้ายการ insert ตั้งค่าขึ้นมาก่อนบรรทัดปิดตัวแปร · บรรทัดอื่นคงตามนิยามล่าสุด (20261111000200) ทุกบรรทัด
--   ลายเซ็น สิทธิ์ และ security invoker คงเดิม (create or replace ไม่เปลี่ยน grant) · ไม่แตะตาราง policy หรือข้อมูล

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

  -- ต้องอยู่ก่อนปิดตัวแปร: เซสชันนำเข้าเปิดอยู่ RLS ยอมให้เขียนเฉพาะทางนำเข้า
  if p_data->'settings' is not null and p_data->'settings' <> '{}'::jsonb then
    insert into public.settings (user_id, value) values (v_user, p_data->'settings');
  end if;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  -- ก้อนแรกครบทั้งไฟล์พอดี = ปิดเซสชันทันที
  return jsonb_build_object(
    'accounts', v_accounts, 'bills', v_bills, 'entries', v_entries,
    'done', case when v_entries > 0 then private.import_session_advance(v_entries) else false end
  );
end
$$;
