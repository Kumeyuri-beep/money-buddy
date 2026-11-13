-- merge_settings_if: รวมค่าตั้งค่าแบบ "เขียนเมื่อค่าที่คาดไว้ยังเหมือนเดิม" (compare-and-set) ปิดช่องเขียนทับข้ามแท็บของค่าที่เป็นอาร์เรย์
-- (แผน DCA, ป้ายภาษี, รายชื่อสินทรัพย์เกษียณ) และฟอร์มค่าตั้งค่า: merge_settings เดิมรวมเฉพาะ "คีย์ที่ไม่ส่ง" แต่คีย์เดียวกันยังแท็บหลังชนะ
-- migration แบบ "เพิ่ม" เท่านั้น: create or replace function + grant (ไม่มี drop/delete/แก้คอลัมน์) · ไม่แก้ merge_settings เดิม
--
-- p_patch  = object ของคีย์ที่จะตั้ง (เหมือน merge_settings)
-- p_remove = รายชื่อคีย์ที่จะลบ (ลบชนะ patch)
-- p_expect = object ของ "ค่าปัจจุบันที่คาดไว้" ของบางคีย์ (ค่า JSON null = คาดว่ายังไม่มีคีย์นั้น) · null = ไม่ตรวจ (เท่ากับ merge_settings)
--            ถ้าค่าจริงของคีย์ใดต่างจากที่คาด → error 40001 (serialization_failure) ไม่เขียนอะไร · เว็บอ่านค่าล่าสุดแล้วคำนวณใหม่แล้วลองซ้ำ
-- ตรวจและเขียนในคำสั่งเดียว (insert ... on conflict do update ... where ค่าตรง) แถวถูกล็อกระหว่างเขียน จึงไม่มีช่วงอ่านแล้วเขียน
-- ความปลอดภัย: security invoker (RLS ของ settings คุมอยู่) · ต้องล็อกอิน + เปลี่ยนรหัสผ่านแล้ว (private.can_use_data) · execute เฉพาะ authenticated · เพดานขนาดของตารางยังบังคับ
create or replace function public.merge_settings_if(p_patch jsonb, p_remove text[] default '{}', p_expect jsonb default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_remove text[] := coalesce(p_remove, '{}');
  v_expect jsonb := coalesce(p_expect, '{}'::jsonb);
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
  if jsonb_typeof(v_expect) is distinct from 'object' then
    raise exception 'รูปแบบค่าที่คาดไว้ไม่ถูกต้อง' using errcode = '22023';
  end if;
  if cardinality(v_remove) > 20 then
    raise exception 'ลบค่าตั้งค่าได้ครั้งละไม่เกิน 20 คีย์' using errcode = '22023';
  end if;
  v_patch := p_patch - v_remove;

  -- ยังไม่มีแถว: ค่าปัจจุบันคือ "ไม่มีคีย์ใดเลย" ถ้าคาดว่ามีค่าอยู่ = ขัดแย้ง (ไม่สร้างแถว)
  if not exists (select 1 from public.settings where user_id = v_user)
     and exists (select 1 from jsonb_each(v_expect) e where e.value <> 'null'::jsonb) then
    raise exception 'ค่าตั้งค่าถูกแก้จากที่อื่น' using errcode = '40001';
  end if;

  insert into public.settings as s (user_id, value)
  values (v_user, v_patch)
  on conflict (user_id) do update
    set value = (s.value - v_remove) || v_patch
    where not exists (
      select 1 from jsonb_each(v_expect) e
      where coalesce(s.value -> e.key, 'null'::jsonb) is distinct from e.value
    )
  returning s.value into v_value;

  if v_value is null then
    -- แถวมีอยู่แต่ค่าจริงต่างจากที่คาด (หรือมีคนแทรกแถวระหว่างตรวจกับเขียน)
    raise exception 'ค่าตั้งค่าถูกแก้จากที่อื่น' using errcode = '40001';
  end if;
  return v_value;
end
$$;

revoke all on function public.merge_settings_if(jsonb, text[], jsonb) from public, anon, authenticated;
grant execute on function public.merge_settings_if(jsonb, text[], jsonb) to authenticated;
