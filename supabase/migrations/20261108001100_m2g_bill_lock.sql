-- M2-G: ล็อก bills.last_paid_month (R15 "ทุกเส้นทาง") · เจ้าของสั่ง 9 พ.ย. 2569 ต้องเสร็จก่อนเชิญผู้ใช้จริง
-- เดิม: ผู้ใช้เรียก REST PATCH /bills ตั้ง last_paid_month เป็น "จ่ายแล้ว" โดยไม่มีรายการจ่ายได้ หรือล้างค่าเพื่อจ่ายซ้ำรอบเดิม
-- ใหม่: เปลี่ยนค่านี้ได้เฉพาะ
--   1) เส้นทางจ่ายบิล (trigger entries_bill_link หลังเพิ่มรายการจ่าย) และยกเลิกการจ่าย (trigger entries_guard ตอนลบรายการจ่าย)
--      สองทางนี้ตั้งตัวแปร app.bill_paid_path ครอบคำสั่งอัปเดตเท่านั้น
--   2) ฟังก์ชันนำเข้า import_ledger (ตั้ง app.import_ledger ก่อนเพิ่มบิล)
--   3) เพิ่มบิลที่ตั้งค่านี้ไว้ได้ก็ต่อเมื่อมีรายการจ่ายที่ผูกกับบิลนั้นและรอบนั้นอยู่จริง (ใช้กับ "เลิกทำการลบบิล" ที่ใส่บิลกลับเข้ามา)
--   4) บทบาทระบบ (postgres, supabase_admin, service_role) ซ่อมบำรุงได้
-- ตัวแปร app.* ตั้งได้เฉพาะภายในฟังก์ชันของเราเท่านั้น (ผู้ใช้ตั้งผ่าน REST ไม่ได้) · ห้ามให้ฟังก์ชัน public ตั้ง app.* ตามค่าที่ผู้ใช้ส่งมา

create or replace function private.bills_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.last_paid_month is not null and new.last_paid_month > private.current_month() then
    raise exception 'lastPaidMonth เกินเดือนปัจจุบัน' using errcode = '23514';
  end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(current_setting('app.import_ledger', true), '') = 'on'
     or coalesce(current_setting('app.bill_paid_path', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.last_paid_month is not null and not exists (
      select 1 from public.entries e
       where e.user_id = new.user_id and e.bill_id = new.id and e.bill_cycle = new.last_paid_month and e.source = 'recurring'
    ) then
      raise exception 'สถานะจ่ายของบิลตั้งตรงๆ ไม่ได้ ต้องจ่ายผ่านรายการจ่ายบิล' using errcode = '42501';
    end if;
  elsif new.last_paid_month is distinct from old.last_paid_month then
    raise exception 'สถานะจ่ายของบิลแก้ตรงๆ ไม่ได้ ต้องจ่ายหรือยกเลิกผ่านรายการจ่ายบิล' using errcode = '42501';
  end if;
  return new;
end
$$;

-- จ่ายบิล: ครอบคำสั่งอัปเดตด้วย app.bill_paid_path (นอกนั้นเหมือนเดิมทุกข้อ)
create or replace function private.entries_bill_link() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_archived boolean;
  v_found boolean;
begin
  if new.bill_id is null then
    return null;
  end if;
  if coalesce(current_setting('app.import_ledger', true), '') = 'on' then
    if new.bill_cycle > private.current_month() then
      raise exception 'จ่ายล่วงหน้าเกินเดือนปัจจุบันไม่ได้' using errcode = '23514';
    end if;
    return null;
  end if;
  select b.last_paid_month, b.archived, true into v_paid, v_archived, v_found
    from public.bills b where b.user_id = new.user_id and b.id = new.bill_id for update;
  if not coalesce(v_found, false) then
    raise exception 'ไม่พบบิลที่ผูก' using errcode = '23503';
  end if;
  if v_archived then
    raise exception 'บิลถูกเก็บถาวรแล้ว จ่ายไม่ได้' using errcode = '23514';
  end if;
  if new.bill_before is distinct from v_paid then
    raise exception 'สถานะบิลเปลี่ยนไปแล้ว (lastPaidMonth ไม่ตรง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001';
  end if;
  if new.bill_cycle <= coalesce(v_paid, '') then
    raise exception 'รอบนี้จ่ายแล้ว' using errcode = '23514';
  end if;
  if new.bill_cycle > private.current_month() then
    raise exception 'จ่ายล่วงหน้าเกินเดือนปัจจุบันไม่ได้' using errcode = '23514';
  end if;
  perform set_config('app.bill_paid_path', 'on', true);
  update public.bills set last_paid_month = new.bill_cycle where user_id = new.user_id and id = new.bill_id;
  perform set_config('app.bill_paid_path', '', true);
  return null;
end
$$;

-- ยกเลิกการจ่าย: ครอบคำสั่งอัปเดตด้วย app.bill_paid_path
create or replace function private.entries_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_found boolean;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source = 'system' and coalesce(current_setting('app.setup_ledger', true), '') <> 'on' then
      raise exception 'รายการยอดยกมา (system) สร้างได้เฉพาะตอนตั้งค่าเริ่มต้น' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.source in ('system', 'recurring') then
      raise exception 'รายการประเภท % แก้ไขไม่ได้', old.source using errcode = '42501';
    end if;
    if new.source in ('system', 'recurring') or new.bill_id is not null then
      raise exception 'เปลี่ยนรายการเป็นประเภท system/recurring หรือผูกบิลภายหลังไม่ได้' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.source = 'system' then
    raise exception 'รายการยอดยกมาลบไม่ได้' using errcode = '42501';
  end if;
  if old.bill_id is not null then
    select b.last_paid_month, true into v_paid, v_found
      from public.bills b where b.user_id = old.user_id and b.id = old.bill_id for update;
    if v_found then
      if v_paid is distinct from old.bill_cycle then
        raise exception 'ยกเลิกการจ่ายได้เฉพาะรอบล่าสุดของบิล' using errcode = '23514';
      end if;
      perform set_config('app.bill_paid_path', 'on', true);
      update public.bills set last_paid_month = old.bill_before
       where user_id = old.user_id and id = old.bill_id;
      perform set_config('app.bill_paid_path', '', true);
    end if;
  end if;
  return old;
end
$$;

-- นำเข้า: ตั้ง app.import_ledger ก่อนเพิ่มบิล (บิลที่นำเข้าพก last_paid_month มาจากไฟล์) · นอกนั้นเหมือน 20261108001000
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
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order)
    values (
      v_user, v_item->>'id', v_item->>'type', v_item->>'name', v_item->>'currency',
      coalesce((v_item->>'archived')::boolean, false), (v_item->>'sortOrder')::integer
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
