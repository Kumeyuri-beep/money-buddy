-- merge_settings_if: ใช้ SQLSTATE PT409 (PostgREST ตอบ HTTP 409) แทน 40001 เพราะเทสต์จริงพบว่า 40001 ถูกลองซ้ำอัตโนมัติจนค้างราว 60 วินาที
-- ชนิดเดียวกับเดิม: create or replace · ไม่ drop · ไม่เปลี่ยนสัญญา/สิทธิ์
create or replace function public.merge_settings_if(p_patch jsonb, p_remove text[] default '{}', p_expect jsonb default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_remove text[] := coalesce(p_remove, '{}');
  v_expect jsonb := coalesce(p_expect, '{}'::jsonb);
  v_patch jsonb;
  v_cur jsonb;
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

  perform pg_advisory_xact_lock(hashtextextended('merge_settings_if:' || v_user::text, 0));

  select s.value into v_cur from public.settings s where s.user_id = v_user;
  v_cur := coalesce(v_cur, '{}'::jsonb);
  if exists (
    select 1 from jsonb_each(v_expect) e
    where coalesce(v_cur -> e.key, 'null'::jsonb) is distinct from e.value
  ) then
    raise exception 'ค่าตั้งค่าถูกแก้จากที่อื่น' using errcode = 'PT409';
  end if;

  insert into public.settings as s (user_id, value)
  values (v_user, v_patch)
  on conflict (user_id) do update set value = (s.value - v_remove) || v_patch
  returning s.value into v_value;
  return v_value;
end
$$;
