-- M2-G รอบ 2 (ตามผล money-auditor): เพิ่มบิล (INSERT) ต้องให้สถานะจ่ายตรงกับรายการจ่ายที่ผูกอยู่พอดี
--  - last_paid_month ต้องเท่ากับ "รอบล่าสุด" ของรายการจ่ายที่ผูกกับบิลนี้ · ไม่มีรายการจ่ายเลย = ต้องเป็นว่าง
--  - กันกรณีลบบิลที่จ่ายแล้วเพิ่มกลับด้วยค่าว่าง/รอบเก่า จนบิลดูเหมือนยังไม่จ่ายทั้งที่มีรายการจ่ายอยู่
--    (ส่วน "จ่ายซ้ำรอบเดิม" ถูกกันที่ดัชนี entries_bill_cycle_once_idx อยู่แล้ว ไม่ขึ้นกับตาราง bills)
--  - ข้อความภาษาธรรมดา: บิลที่จ่ายไว้ก่อนมีการผูกรายการ (ไฟล์เก่า) เลิกทำการลบไม่ได้ ให้สร้างบิลใหม่

create or replace function private.bills_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_max text;
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
