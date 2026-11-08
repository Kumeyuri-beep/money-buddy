-- M2-C2: ล้างข้อมูลสมุดบัญชีของ "ตัวเอง" ทั้งหมด (ปุ่ม "ล้างข้อมูลทั้งหมด" ที่ผู้ใช้ยืนยันแล้ว)
-- เหตุผล: trigger ห้ามลบรายการยอดยกมา (system) โดยผู้ใช้ จึงลบด้วยคำสั่งตรงๆ ไม่ได้
-- ฟังก์ชันนี้ SECURITY DEFINER (รันเป็นเจ้าของฟังก์ชัน -> ผ่าน guard) แต่แตะเฉพาะแถวของ auth.uid() เท่านั้น
-- ไม่ลบบัญชีผู้ใช้/profiles (ยังล็อกอินและความยินยอมคงอยู่) · เรียกได้เฉพาะ authenticated ที่เปลี่ยนรหัสแล้ว
-- ต้องเรียกแบบเขียนได้ (POST) เหมือน delete_my_account (กันเรียกผ่าน GET)

create function public.reset_my_ledger() returns void
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
  -- ลำดับตาม FK: รายการ (บรรทัด cascade) -> บิล -> บัญชี -> ค่าตั้งค่า
  delete from public.entries where user_id = v_user;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
end
$$;

revoke all on function public.reset_my_ledger() from public, anon, authenticated;
grant execute on function public.reset_my_ledger() to authenticated;
