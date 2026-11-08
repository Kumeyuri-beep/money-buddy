-- M2-G รอบ 3 (ตามผล security-auditor): ห้ามเปลี่ยนรหัสบิล (id) ด้วย UPDATE
-- ช่องเดิม: PATCH /bills?id=eq.X {id:'Y'} (last_paid_month ไม่เปลี่ยนจึงผ่าน) ได้บิล Y ที่ "จ่ายแล้ว" โดยรายการจ่ายยังชี้ไป X
--   แล้วลบรายการจ่ายของ X (หาบิลไม่เจอจึงไม่คืนค่า) หรือเพิ่มบิล X กลับโดยใช้รายการเดิมเป็นหลักฐาน
-- แก้: UPDATE ที่เปลี่ยน id หรือ user_id ถูกปฏิเสธ (ยกเว้นบทบาทระบบ) · แอปไม่เคยเปลี่ยน id บิล
-- คำเตือนสำหรับ migration อนาคต: ห้ามสร้างฟังก์ชัน SECURITY DEFINER ที่ INSERT/UPDATE ตาราง bills หรือ entries ตามค่าที่ผู้ใช้ส่งมา
--   (รันเป็น postgres จึงข้ามการล็อกทั้งหมดในไฟล์ M2-G)

create or replace function private.bills_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_max text;
begin
  if new.last_paid_month is not null and new.last_paid_month > private.current_month() then
    raise exception 'lastPaidMonth เกินเดือนปัจจุบัน' using errcode = '23514';
  end if;
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.user_id is distinct from old.user_id) then
    raise exception 'เปลี่ยนรหัสบิลไม่ได้' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.import_ledger', true), '') = 'on'
     or coalesce(current_setting('app.bill_paid_path', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select max(e.bill_cycle) into v_max
      from public.entries e
     where e.user_id = new.user_id and e.bill_id = new.id and e.source = 'recurring';
    if new.last_paid_month is distinct from v_max then
      raise exception 'เพิ่มบิลนี้ไม่ได้ เพราะสถานะจ่ายไม่ตรงกับรายการจ่ายที่ผูกกับบิล (บิลที่จ่ายไว้ก่อนมีการผูกรายการ กู้คืนด้วยการเลิกทำไม่ได้ ให้สร้างบิลใหม่)' using errcode = '42501';
    end if;
  elsif new.last_paid_month is distinct from old.last_paid_month then
    raise exception 'สถานะจ่ายของบิลแก้ตรงๆ ไม่ได้ ต้องจ่ายหรือยกเลิกผ่านรายการจ่ายบิล' using errcode = '42501';
  end if;
  return new;
end
$$;
