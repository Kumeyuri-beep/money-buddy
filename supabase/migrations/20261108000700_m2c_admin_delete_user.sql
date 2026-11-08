-- M2-C2: ลบผู้ใช้ที่มีข้อมูลผ่าน Auth Admin API / Dashboard ล้มด้วย 500 (พบจากชุดทดสอบจริง 9 พ.ย. 2569)
-- สาเหตุ: ลบ auth.users ทำให้ cascade ลบ entries/lines แล้ว constraint trigger ตรวจสมดุล (SECURITY INVOKER) ทำงานด้วยสิทธิ์ของผู้ลบ
--   (supabase_auth_admin) ซึ่งไม่มีสิทธิ์ใช้ schema private -> "permission denied for schema private"
--   (delete_my_account ไม่โดนเพราะเป็น SECURITY DEFINER) กระทบการลบบัญชีโดยเจ้าของผ่าน Dashboard ด้วย
-- แก้: ข้ามการตรวจสมดุลเมื่อเป็นการ "ลบ" โดยบทบาทระบบ (ไม่มีผลกับผู้ใช้ทั่วไป: authenticated/anon ยังถูกตรวจเหมือนเดิม)
--   การลบแถวเพื่อให้ Entry ไม่สมดุลทำโดยผู้ใช้ไม่ได้ (guard ห้ามแก้บรรทัด system/recurring และ trigger ตรวจตอน commit)

create or replace function private.check_entry_balance() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_user in ('supabase_auth_admin', 'supabase_admin', 'service_role') then
    return null;
  end if;
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
