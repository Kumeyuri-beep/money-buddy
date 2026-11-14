-- ซ่อน/เปิดกลับหมวดรายรับ-รายจ่าย (ฟีดแบ็กใช้งานจริง ข้อ 2 · เจ้าของสั่ง 14 พ.ย. 2569)
-- ผู้ใช้แก้ public.accounts ได้เฉพาะคอลัมน์ name (migration 20261113000600) จึงแก้ archived ตรงๆ ไม่ได้ → ทำผ่านฟังก์ชันนี้ที่ตรวจเจ้าของและชนิดบัญชีเอง
-- migration แบบ "เพิ่ม" เท่านั้น: create or replace function + grant (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ · สิทธิ์ตารางไม่เปลี่ยน)
--
-- p_id       = รหัสหมวด (บัญชี income/expense ของผู้ใช้เอง ชนิด normal)
-- p_archived = true ซ่อน (ไม่แสดงในฟอร์มบันทึกรายการ รายการเก่ายังอ้างถึงและแสดงชื่อเดิม) · false เปิดกลับ
-- ข้อห้าม: หมวดผลการลงทุนที่ระบบสร้าง (inv-gain, inv-loss, inv-dividend, inv-wht) ซ่อนไม่ได้ · ซ่อนแล้วต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวดต่อประเภท (ไม่งั้นฟอร์มบันทึกไม่ได้)
-- ความปลอดภัย: security definer (จำเป็นเพราะผู้ใช้ไม่มีสิทธิ์ update คอลัมน์ archived) แต่เขียนเฉพาะแถวของ auth.uid() ตัวเองเท่านั้น · ต้องเปลี่ยนรหัสผ่านแล้ว (private.can_use_data) · search_path ว่าง
-- ล็อกแถวหมวดประเภทเดียวกันทั้งหมดของผู้ใช้ก่อนนับ (กันสองแท็บซ่อนคนละหมวดพร้อมกันจนเหลือ 0)
create or replace function public.set_category_archived(p_id text, p_archived boolean)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_type text;
  v_visible integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if p_id is null or p_archived is null then
    raise exception 'ข้อมูลไม่ครบ' using errcode = '22023';
  end if;
  if p_id in ('inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht') then
    raise exception 'ซ่อนหมวดผลการลงทุนที่ระบบสร้างไม่ได้' using errcode = '42501';
  end if;

  select a.type into v_type
  from public.accounts a
  where a.user_id = v_user and a.id = p_id and a.type in ('income', 'expense') and a.kind = 'normal';
  if v_type is null then
    raise exception 'ไม่พบหมวดนี้' using errcode = 'P0002';
  end if;

  -- ล็อกหมวดประเภทเดียวกันของผู้ใช้ (เรียงตามรหัสกัน deadlock) แล้วค่อยนับ
  perform 1 from public.accounts a
  where a.user_id = v_user and a.type = v_type and a.kind = 'normal'
  order by a.id for update;

  if p_archived then
    select count(*) into v_visible
    from public.accounts a
    where a.user_id = v_user and a.type = v_type and a.kind = 'normal' and a.currency = 'THB'
      and not a.archived and a.id <> p_id
      and a.id not in ('inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht');
    if v_visible < 1 then
      raise exception 'ต้องเหลือหมวดที่ใช้งานอย่างน้อย 1 หมวด' using errcode = '23514';
    end if;
  end if;

  update public.accounts set archived = p_archived where user_id = v_user and id = p_id;
  return true;
end
$$;

revoke all on function public.set_category_archived(text, boolean) from public, anon, authenticated;
grant execute on function public.set_category_archived(text, boolean) to authenticated;
