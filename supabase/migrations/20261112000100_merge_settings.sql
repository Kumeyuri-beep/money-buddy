-- merge_settings: แก้ช่องแข่งเขียน settings (เปิดสองแท็บแล้วบันทึกเหลื่อมกัน)
-- เดิมหน้าเว็บ "อ่านทั้งก้อนแล้วเขียนทั้งก้อน" ทำให้การบันทึกค่าตั้งค่าหนึ่งอาจเขียนทับค่าอื่นที่อีกแท็บเพิ่งบันทึก
-- ตอนนี้รวมค่าฝั่งฐานข้อมูลในคำสั่งเดียว (แถวถูกล็อกระหว่าง upsert) · เปลี่ยนเฉพาะคีย์ที่ส่งมา คีย์ที่ไม่ส่งคงของเดิม
-- migration แบบ "เพิ่ม" เท่านั้น: create or replace function + grant (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์)
--
-- p_patch  = object ของคีย์ที่จะตั้ง/เปลี่ยน (ตัดชั้นบนสุดเท่านั้น ค่าซ้อนในคีย์ถูกแทนทั้งก้อน)
-- p_remove = รายชื่อคีย์ที่จะลบ (ลบก่อน แล้วค่อยรวม p_patch · ถ้าคีย์อยู่ทั้งสองที่ ลบชนะ)
-- คืนค่า settings.value ทั้งก้อนหลังรวม
-- ความปลอดภัย: security invoker (RLS ของ settings ยังคุมอยู่) · ต้องล็อกอิน + เปลี่ยนรหัสผ่านแล้ว (private.can_use_data) · เพดานขนาด 16 KB ของตารางยังบังคับ
create or replace function public.merge_settings(p_patch jsonb, p_remove text[] default '{}')
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_remove text[] := coalesce(p_remove, '{}');
  v_patch jsonb;
  v_value jsonb;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'รูปแบบค่าตั้งค่าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if cardinality(v_remove) > 20 then
    raise exception 'ลบค่าตั้งค่าได้ครั้งละไม่เกิน 20 คีย์' using errcode = '22023';
  end if;
  v_patch := p_patch - v_remove;
  insert into public.settings as s (user_id, value)
  values (v_user, v_patch)
  on conflict (user_id) do update set value = (s.value - v_remove) || v_patch
  returning s.value into v_value;
  return v_value;
end
$$;

revoke all on function public.merge_settings(jsonb, text[]) from public, anon, authenticated;
grant execute on function public.merge_settings(jsonb, text[]) to authenticated;
