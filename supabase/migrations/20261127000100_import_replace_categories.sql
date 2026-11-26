-- นำเข้าไฟล์สำรองเมื่อมีหมวดเดิมค้าง (เจ้าของอนุมัติแผน 27 พ.ย. 2569 · docs/plans/2026-11-26-import-categories-guard.md)
-- **ยังไม่ได้ใส่ฐานข้อมูล** · มีคำสั่ง delete จึงต้องรอเจ้าของอนุมัติก่อนใส่ · มี grant/revoke จึงต้องรันเทสต์ SQL ครบทุกไฟล์หลังใส่
--   (1) ฟังก์ชันใหม่ import_ledger_investments_replacing_categories: ลบหมวดเดิมของผู้ที่กำลังนำเข้า + นำเข้าข้อมูลลงทุนจากไฟล์ ในธุรกรรมเดียว
--       ล้มตรงไหน (รวมด่านเป้ารวม 100% ตอน commit) = ย้อนกลับทั้งหมด หมวดเดิมกลับครบ
--   (2) import_ledger_abort: เอาการลบ asset_categories ออก (ระหว่างเซสชันนำเข้าเขียนหมวดไม่ได้ หมวดที่เห็นจึงเป็นของเดิมเสมอ ห้ามลบ)
--       นิยามอื่นทุกบรรทัดตรงกับที่อยู่ในฐานข้อมูลจริง (อ่านด้วย pg_get_functiondef 27 พ.ย. 2569) · reset_my_ledger* ยังลบหมวดเหมือนเดิม

create function public.import_ledger_investments_replacing_categories(p_data jsonb, p_expected_categories integer) returns jsonb
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
  return public.import_ledger_investments(p_data);
end
$$;
revoke all on function public.import_ledger_investments_replacing_categories(jsonb, integer) from public, anon, authenticated;
grant execute on function public.import_ledger_investments_replacing_categories(jsonb, integer) to authenticated;

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
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;
