-- ทดสอบ merge_settings: รวมค่าตั้งค่าฝั่งฐานข้อมูล (แก้ช่องแข่งเขียน), ลบคีย์, สิทธิ์, ไม่รั่วข้ามผู้ใช้, เพดานขนาด
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261112000100_merge_settings** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขทั้งหมดสมมติ)

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlerrm; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  v jsonb;
  n integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-ms@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-ms@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-ms@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  -- uc ไม่เปลี่ยนรหัส (ใช้ข้อมูลไม่ได้)

  perform pg_temp.login(ua);

  -- T1 ยังไม่มีแถว: สร้างจาก patch
  v := public.merge_settings('{"payDay": 25}'::jsonb);
  if v is distinct from '{"payDay": 25}'::jsonb then raise exception 'FAIL: T1 ผลรวมครั้งแรกไม่ตรง (%)', v; end if;
  select count(*) into n from public.settings where user_id = ua;
  if n <> 1 then raise exception 'FAIL: T1 ไม่มีแถว settings (%)', n; end if;

  -- T2 patch คีย์อื่น: คีย์เดิมต้องอยู่ (นี่คือเหตุผลของ RPC: ไม่เขียนทับค่าที่อีกแท็บเพิ่งบันทึก)
  v := public.merge_settings('{"monthlyBudget": 3000000}'::jsonb);
  if v is distinct from '{"payDay": 25, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T2 คีย์เดิมหาย/ไม่รวม (%)', v; end if;

  -- T3 patch คีย์เดิม: ค่าใหม่ชนะ · คีย์อื่นคงอยู่
  v := public.merge_settings('{"payDay": 28}'::jsonb);
  if v is distinct from '{"payDay": 28, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T3 ค่าใหม่ไม่ชนะ (%)', v; end if;

  -- T4 ค่าซ้อนในคีย์ถูกแทนทั้งก้อน (ไม่รวมลึก)
  v := public.merge_settings('{"retirementAssetIds": ["a1", "a2"]}'::jsonb);
  v := public.merge_settings('{"retirementAssetIds": ["a3"]}'::jsonb);
  if v -> 'retirementAssetIds' is distinct from '["a3"]'::jsonb then raise exception 'FAIL: T4 ค่าซ้อนไม่ถูกแทนทั้งก้อน (%)', v; end if;

  -- T5 p_remove ลบเฉพาะคีย์ที่ระบุ
  v := public.merge_settings('{}'::jsonb, array['retirementAssetIds']);
  if v is distinct from '{"payDay": 28, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T5 ลบคีย์ผิด (%)', v; end if;

  -- T6 คีย์อยู่ทั้ง patch และ remove: ลบชนะ · ลบคีย์ที่ไม่มีอยู่ไม่ error
  v := public.merge_settings('{"payDay": 1, "monthlyBudget": 5}'::jsonb, array['payDay', 'noSuchKey']);
  if v is distinct from '{"monthlyBudget": 5}'::jsonb then raise exception 'FAIL: T6 ลบไม่ชนะ/คีย์ไม่มีทำ error (%)', v; end if;

  -- T7 p_remove เป็น null = ไม่ลบอะไร
  v := public.merge_settings('{"payDay": 10}'::jsonb, null);
  if v is distinct from '{"payDay": 10, "monthlyBudget": 5}'::jsonb then raise exception 'FAIL: T7 remove null ผิด (%)', v; end if;

  -- T8 patch ไม่ใช่ object = ปฏิเสธ (22023) และค่าเดิมไม่เปลี่ยน
  r := pg_temp.fails($$ select public.merge_settings('[1]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T8 patch เป็นอาร์เรย์ผ่าน'; end if;
  r := pg_temp.fails($$ select public.merge_settings('"x"'::jsonb) $$);
  if r is null then raise exception 'FAIL: T8 patch เป็นข้อความผ่าน'; end if;
  r := pg_temp.fails($$ select public.merge_settings('null'::jsonb) $$);
  if r is null then raise exception 'FAIL: T8 patch เป็น null ผ่าน'; end if;
  r := pg_temp.fails($$ select public.merge_settings(null) $$);
  if r is null then raise exception 'FAIL: T8 patch เป็น SQL null ผ่าน'; end if;
  select value into v from public.settings where user_id = ua;
  if v is distinct from '{"payDay": 10, "monthlyBudget": 5}'::jsonb then raise exception 'FAIL: T8 ค่าเดิมเปลี่ยนหลังถูกปฏิเสธ (%)', v; end if;

  -- T9 ลบเกิน 20 คีย์ = ปฏิเสธ
  r := pg_temp.fails($$ select public.merge_settings('{}'::jsonb, array(select 'k' || g from generate_series(1, 21) g)) $$);
  if r is null then raise exception 'FAIL: T9 ลบ 21 คีย์ผ่าน'; end if;

  -- T10 เพดานขนาด 16 KB ของตารางยังบังคับ (ค่าใหญ่ถูกปฏิเสธ ค่าเดิมคงอยู่)
  r := pg_temp.fails($$ select public.merge_settings(jsonb_build_object('big', repeat('x', 17000))) $$);
  if r is null then raise exception 'FAIL: T10 ค่าใหญ่เกิน 16 KB ผ่าน'; end if;
  select value into v from public.settings where user_id = ua;
  if v is distinct from '{"payDay": 10, "monthlyBudget": 5}'::jsonb then raise exception 'FAIL: T10 ค่าเดิมเปลี่ยนหลังถูกปฏิเสธ (%)', v; end if;

  -- T11 ผู้ใช้ b: ไม่เห็นและไม่แก้ค่าของ a
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  select count(*) into n from public.settings;
  if n <> 0 then raise exception 'FAIL: T11 b เห็นแถว settings ของ a (%)', n; end if;
  v := public.merge_settings('{"payDay": 15}'::jsonb);
  if v is distinct from '{"payDay": 15}'::jsonb then raise exception 'FAIL: T11 ค่าของ b ปนค่าของ a (%)', v; end if;
  perform pg_temp.logout();
  select value into v from public.settings where user_id = ua;
  if v is distinct from '{"payDay": 10, "monthlyBudget": 5}'::jsonb then raise exception 'FAIL: T11 ค่าของ a เปลี่ยนจากการเรียกของ b (%)', v; end if;

  -- T12 ผู้ใช้ที่ยังไม่เปลี่ยนรหัส (c) ใช้ไม่ได้ (42501) และไม่เกิดแถว
  perform pg_temp.login(uc);
  r := pg_temp.fails($$ select public.merge_settings('{"payDay": 3}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T12 c ที่ยังไม่เปลี่ยนรหัสผ่านใช้ได้'; end if;
  perform pg_temp.logout();
  select count(*) into n from public.settings where user_id = uc;
  if n <> 0 then raise exception 'FAIL: T12 เกิดแถว settings ของ c (%)', n; end if;

  -- T13 ไม่ล็อกอิน (anon) เรียกไม่ได้
  execute 'set local role anon';
  r := pg_temp.fails($$ select public.merge_settings('{"payDay": 4}'::jsonb) $$);
  execute 'reset role';
  if r is null then raise exception 'FAIL: T13 anon เรียก merge_settings ได้'; end if;

  -- T14 ไม่มี role ที่นอกเหนือ authenticated/service ได้สิทธิ์ execute (public ถูกเพิกถอน)
  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'public' and routine_name = 'merge_settings' and grantee in ('PUBLIC', 'anon');
  if n <> 0 then raise exception 'FAIL: T14 anon/public ยังมีสิทธิ์ execute (%)', n; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
