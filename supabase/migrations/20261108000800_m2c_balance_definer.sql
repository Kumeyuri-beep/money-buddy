-- M2-C2 (ตามผล security-auditor): แทนที่ช่องข้ามของ migration 0700 ด้วยการแก้ที่ต้นเหตุ
-- ให้ private.check_entry_balance รันด้วยสิทธิ์เจ้าของฟังก์ชัน (SECURITY DEFINER, search_path ว่าง) แทนสิทธิ์ผู้ลบ
-- -> supabase_auth_admin/service_role ลบ cascade ได้โดยไม่ต้องมีสิทธิ์ใน schema private
-- -> ไม่มีบทบาทใดข้ามการตรวจสมดุลได้อีก (service_role ลบบรรทัดเดียวของ Entry แล้วค้างไม่สมดุล = ล้มตอน commit)
-- ปลอดภัย: trigger ใช้ user_id จากแถวที่ถูกแก้เอง ไม่รับค่าจากผู้เรียก และฟังก์ชันตรวจอย่างเดียว ไม่เขียนข้อมูล

create or replace function private.check_entry_balance() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'entries' then
    perform private.assert_entry_balanced(new.user_id, new.id);
  elsif tg_op = 'DELETE' then
    perform private.assert_entry_balanced(old.user_id, old.entry_id);
  else
    perform private.assert_entry_balanced(new.user_id, new.entry_id);
    if tg_op = 'UPDATE' and old.entry_id <> new.entry_id then
      perform private.assert_entry_balanced(old.user_id, old.entry_id);
    end if;
  end if;
  return null;
end
$$;
