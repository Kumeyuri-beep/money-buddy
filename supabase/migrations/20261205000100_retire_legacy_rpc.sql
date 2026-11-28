-- ถอนทางเรียกฟังก์ชันรุ่นเก่า (ไม่มีตัวตรวจผู้ใช้ที่ตั้งใจ) ออกจาก API (เจ้าของอนุมัติให้ "เตรียม" 28 พ.ย. 2569)
-- **ห้ามใส่ก่อน 5 ธันวาคม ค.ศ. 2026 (5 ธ.ค. 2569) และต้องรอเจ้าของอนุมัติ**
--
-- ทำไมไม่ใช้ revoke ตรงๆ: ตัวห่อ *_as เป็น security invoker จึงเรียกฟังก์ชันเดิมด้วยสิทธิ์ของผู้ใช้ ถอนสิทธิ์แล้วตัวห่อจะพังไปด้วย
-- และห้ามเปลี่ยนตัวห่อเป็น security definer (ฟังก์ชันเดิมหลายตัวพึ่ง RLS)
-- วิธี: ย้ายฟังก์ชันเดิมไป schema private (PostgREST ไม่เปิดให้เรียก) แล้วให้ตัวห่อเรียกที่ใหม่ · เนื้อฟังก์ชัน ชนิดความปลอดภัย และสิทธิ์เดิมติดไปกับฟังก์ชัน
-- ผลต่อผู้ใช้: แท็บที่เปิดค้างจากเว็บรุ่นเก่า (ก่อน #297) จะตั้งต้น นำเข้า ล้าง หรือลบบัญชีไม่ได้จนกว่าจะรีเฟรช
-- ลำดับ: (1) เว็บที่ใช้งานจริงมี #297 แล้ว (2) ใส่ migration (3) เทสต์ SQL ครบทุกไฟล์ จาก branch ของ PR นี้ (4) live-contract บน branch (5) merge (6) live-contract บน main
--   ระหว่างขั้น 2 ถึง 5 เทสต์บน main จะล้ม (ยังเรียกชื่อเดิม) · ห้าม merge ก่อนใส่ · ห้ามใช้ supabase db push ก่อนวันที่กำหนด (จะใส่ไฟล์นี้ทันที)
--   ก่อนใส่ ดูใน Dashboard ว่า schema private ไม่อยู่ใน Exposed schemas
-- ย้อนกลับ: alter function private.<ชื่อ>(...) set schema public แล้ว create or replace ตัวห่อให้เรียก public.<ชื่อ> ตาม 20261128000100

alter function public.setup_ledger(jsonb, jsonb) set schema private;
alter function public.import_ledger(jsonb) set schema private;
alter function public.import_ledger_begin(jsonb, integer) set schema private;
alter function public.import_ledger_append(jsonb) set schema private;
alter function public.import_ledger_abort() set schema private;
alter function public.import_ledger_investments(jsonb) set schema private;
alter function public.import_ledger_investments_replacing_categories(jsonb, integer) set schema private;
alter function public.reset_my_ledger_step(text) set schema private;
alter function public.delete_my_account_step(text) set schema private;
alter function public.reset_my_ledger(text) set schema private;
alter function public.delete_my_account(text) set schema private;

-- ฟังก์ชันที่เรียกกันเองด้วยชื่อเต็ม (นิยามเดียวกับ 20261127000100 เปลี่ยนแค่ schema)
create or replace function private.import_ledger_investments_replacing_categories(p_data jsonb, p_expected_categories integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_have integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  -- ลำดับล็อกเดียวกับ import_ledger_investments (ล็อกซ้ำในธุรกรรมเดียวได้)
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  perform pg_advisory_xact_lock(hashtext('categories:' || v_user::text));
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ นำเข้าข้อมูลลงทุนไม่ได้' using errcode = '55000';
  end if;
  -- จำนวนที่ผู้ใช้เห็นตอนกดยืนยันต้องตรงกับของจริง (ไม่ตรง = มีการแก้หมวดจากที่อื่น ไม่ลบอะไร)
  select count(*) into v_have from public.asset_categories where user_id = v_user;
  if p_expected_categories is null or v_have <> p_expected_categories then
    raise exception 'หมวดเปลี่ยนไปแล้ว โหลดใหม่แล้วลองอีกครั้ง' using errcode = 'PT409';
  end if;
  delete from public.asset_categories where user_id = v_user;
  -- ฟังก์ชันเดิมตรวจรูปแบบ เพดาน และ "ไม่ทับข้อมูลเดิม" เอง · โยน error = การลบข้างบนย้อนกลับด้วย
  return private.import_ledger_investments(p_data);
end
$$;

-- ตัวห่อ (นิยามเดียวกับ 20261128000100 เปลี่ยนแค่ปลายทางที่เรียก) · create or replace คงสิทธิ์เดิม
create or replace function public.setup_ledger_as(p_expected_user uuid, p_accounts jsonb, p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.setup_ledger(p_accounts, p_entries);
end
$$;

create or replace function public.import_ledger_as(p_expected_user uuid, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger(p_data);
end
$$;

create or replace function public.import_ledger_begin_as(p_expected_user uuid, p_data jsonb, p_total_entries integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger_begin(p_data, p_total_entries);
end
$$;

create or replace function public.import_ledger_append_as(p_expected_user uuid, p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger_append(p_entries);
end
$$;

create or replace function public.import_ledger_abort_as(p_expected_user uuid) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger_abort();
end
$$;

create or replace function public.import_ledger_investments_as(p_expected_user uuid, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger_investments(p_data);
end
$$;

create or replace function public.import_ledger_investments_replacing_categories_as(p_expected_user uuid, p_data jsonb, p_expected_categories integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.import_ledger_investments_replacing_categories(p_data, p_expected_categories);
end
$$;

create or replace function public.reset_my_ledger_step_as(p_expected_user uuid, p_password text) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.reset_my_ledger_step(p_password);
end
$$;

create or replace function public.delete_my_account_step_as(p_expected_user uuid, p_password text) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return private.delete_my_account_step(p_password);
end
$$;
