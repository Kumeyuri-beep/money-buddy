-- ทดสอบ merge_settings_if: เขียนเมื่อค่าที่คาดไว้ยังเหมือนเดิม (ปิดช่องเขียนทับข้ามแท็บ), ไม่เขียนเมื่อขัดแย้ง, สิทธิ์, ไม่รั่วข้ามผู้ใช้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261112000100_merge_settings, 20261113000100_settings_size_check และ 20261113000200_merge_settings_if, 20261113000300_merge_settings_if_lock, 20261113000400_merge_settings_if_conflict_code และ 20261113000500_merge_settings_if_rowlock** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขทั้งหมดสมมติ)

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlerrm; end $$;
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.state_of(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  st text;
  v jsonb;
  n integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-msi@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-msi@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-msi@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  -- uc ไม่เปลี่ยนรหัส (ใช้ข้อมูลไม่ได้)

  perform pg_temp.login(ua);

  -- T1 ยังไม่มีแถว + คาดว่า "ไม่มีคีย์" (null) = สร้างได้
  v := public.merge_settings_if('{"payDay": 25}'::jsonb, '{}', '{"payDay": null}'::jsonb);
  if v is distinct from '{"payDay": 25}'::jsonb then raise exception 'FAIL: T1 สร้างแถวแรกไม่ได้ (%)', v; end if;

  -- T2 คาดค่าตรง = เขียนได้ และคีย์อื่นคงอยู่
  v := public.merge_settings_if('{"monthlyBudget": 3000000}'::jsonb, '{}', '{"monthlyBudget": null}'::jsonb);
  if v is distinct from '{"payDay": 25, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T2 รวมไม่ถูก (%)', v; end if;
  v := public.merge_settings_if('{"payDay": 28}'::jsonb, '{}', '{"payDay": 25}'::jsonb);
  if v is distinct from '{"payDay": 28, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T2 คาดค่าตรงแล้วเขียนไม่ได้ (%)', v; end if;

  -- T3 คาดค่าเก่า (อีกแท็บเพิ่งเปลี่ยน) = ขัดแย้ง PT409 และค่าไม่เปลี่ยน
  st := pg_temp.state_of($$ select public.merge_settings_if('{"payDay": 1}'::jsonb, '{}', '{"payDay": 25}'::jsonb) $$);
  if st is distinct from 'PT409' then raise exception 'FAIL: T3 ค่าที่คาดผิดต้องได้ PT409 (ได้ %)', st; end if;
  select value into v from public.settings where user_id = ua;
  if v is distinct from '{"payDay": 28, "monthlyBudget": 3000000}'::jsonb then raise exception 'FAIL: T3 ค่าเปลี่ยนทั้งที่ขัดแย้ง (%)', v; end if;

  -- T4 คาดว่าไม่มีคีย์ (null) แต่มีอยู่ = ขัดแย้ง · คาดว่ามีค่าแต่ไม่มีคีย์ = ขัดแย้ง
  st := pg_temp.state_of($$ select public.merge_settings_if('{"payDay": 1}'::jsonb, '{}', '{"payDay": null}'::jsonb) $$);
  if st is distinct from 'PT409' then raise exception 'FAIL: T4 คาดว่าไม่มีแต่มี ต้องได้ PT409 (ได้ %)', st; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{"dcaPlans": []}'::jsonb, '{}', '{"dcaPlans": [1]}'::jsonb) $$);
  if st is distinct from 'PT409' then raise exception 'FAIL: T4 คาดว่ามีแต่ไม่มี ต้องได้ PT409 (ได้ %)', st; end if;

  -- T5 ค่าอาร์เรย์/ซ้อนเทียบแบบเท่ากันของ jsonb (ลำดับคีย์ไม่สำคัญ ลำดับสมาชิกอาร์เรย์สำคัญ)
  v := public.merge_settings_if('{"retirementAssetIds": ["a1", "a2"]}'::jsonb, '{}', '{"retirementAssetIds": null}'::jsonb);
  v := public.merge_settings_if('{"retirementAssetIds": ["a1", "a2", "a3"]}'::jsonb, '{}', '{"retirementAssetIds": ["a1", "a2"]}'::jsonb);
  if v -> 'retirementAssetIds' is distinct from '["a1", "a2", "a3"]'::jsonb then raise exception 'FAIL: T5 เขียนอาร์เรย์ไม่ได้ (%)', v; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{"retirementAssetIds": ["x"]}'::jsonb, '{}', '{"retirementAssetIds": ["a2", "a1", "a3"]}'::jsonb) $$);
  if st is distinct from 'PT409' then raise exception 'FAIL: T5 ลำดับอาร์เรย์ต่างต้องขัดแย้ง (ได้ %)', st; end if;

  -- T6 ตรวจเฉพาะคีย์ที่ระบุ: คีย์อื่นเปลี่ยนไม่ทำให้ขัดแย้ง (แท็บอื่นแก้ monthlyBudget ไม่กวนการแก้ payDay)
  v := public.merge_settings('{"monthlyBudget": 4000000}'::jsonb);
  v := public.merge_settings_if('{"payDay": 29}'::jsonb, '{}', '{"payDay": 28}'::jsonb);
  if v is distinct from '{"payDay": 29, "monthlyBudget": 4000000, "retirementAssetIds": ["a1", "a2", "a3"]}'::jsonb then raise exception 'FAIL: T6 คีย์อื่นเปลี่ยนแล้วกวน/คีย์อื่นหาย (%)', v; end if;

  -- T7 p_remove + p_expect: ลบคีย์ที่คาดไว้ได้ · ลบแล้วคีย์ที่ลบหาย
  v := public.merge_settings_if('{}'::jsonb, array['retirementAssetIds'], '{"retirementAssetIds": ["a1", "a2", "a3"]}'::jsonb);
  if v ? 'retirementAssetIds' then raise exception 'FAIL: T7 ลบไม่หาย (%)', v; end if;

  -- T8 p_expect = null (ไม่ตรวจ) ทำงานเหมือน merge_settings
  v := public.merge_settings_if('{"payDay": 3}'::jsonb, '{}', null);
  if v -> 'payDay' is distinct from '3'::jsonb then raise exception 'FAIL: T8 expect null ผิด (%)', v; end if;

  -- T9 รูปแบบผิด: patch/expect ไม่ใช่ object, ลบเกิน 20 คีย์
  st := pg_temp.state_of($$ select public.merge_settings_if('[1]'::jsonb) $$);
  if st is distinct from '22023' then raise exception 'FAIL: T9 patch เป็นอาร์เรย์ (ได้ %)', st; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{}'::jsonb, '{}', '[1]'::jsonb) $$);
  if st is distinct from '22023' then raise exception 'FAIL: T9 expect เป็นอาร์เรย์ (ได้ %)', st; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{}'::jsonb, '{}', '"x"'::jsonb) $$);
  if st is distinct from '22023' then raise exception 'FAIL: T9 expect เป็นข้อความ (ได้ %)', st; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{}'::jsonb, array(select 'k' || g from generate_series(1, 21) g)) $$);
  if st is distinct from '22023' then raise exception 'FAIL: T9 ลบ 21 คีย์ (ได้ %)', st; end if;
  st := pg_temp.state_of($$ select public.merge_settings_if('{}'::jsonb, '{}', (select jsonb_object_agg('k' || g, null) from generate_series(1, 21) g)) $$);
  if st is distinct from '22023' then raise exception 'FAIL: T9 expect 21 คีย์ (ได้ %)', st; end if;

  -- T10 เพดานขนาดยังบังคับ (ค่าเดิมคงอยู่)
  select value into v from public.settings where user_id = ua;
  r := pg_temp.fails($$ select public.merge_settings_if(jsonb_build_object('big', repeat('x', 17000))) $$);
  if r is null or r not like '%settings_value_size_check%' then raise exception 'FAIL: T10 ค่าเกิน 16 KB ต้องถูกปฏิเสธด้วย settings_value_size_check (%)', r; end if;
  if (select value from public.settings where user_id = ua) is distinct from v then raise exception 'FAIL: T10 ค่าเดิมเปลี่ยนหลังถูกปฏิเสธ'; end if;

  -- T11 ผู้ใช้ b: ไม่เห็นและไม่ปนค่าของ a · คาดว่ามีค่า a ในแถวของ b = ขัดแย้ง (แถวของ b ยังไม่มี) ไม่สร้างแถว
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  st := pg_temp.state_of($$ select public.merge_settings_if('{"payDay": 7}'::jsonb, '{}', '{"payDay": 3}'::jsonb) $$);
  if st is distinct from 'PT409' then raise exception 'FAIL: T11 b คาดค่าของ a ต้องขัดแย้ง (ได้ %)', st; end if;
  select count(*) into n from public.settings;
  if n <> 0 then raise exception 'FAIL: T11 b เห็นหรือสร้างแถว settings (%)', n; end if;
  v := public.merge_settings_if('{"payDay": 7}'::jsonb, '{}', '{"payDay": null}'::jsonb);
  if v is distinct from '{"payDay": 7}'::jsonb then raise exception 'FAIL: T11 ค่าของ b ปนค่าของ a (%)', v; end if;
  perform pg_temp.logout();
  select value into v from public.settings where user_id = ua;
  if v -> 'payDay' is distinct from '3'::jsonb then raise exception 'FAIL: T11 ค่าของ a เปลี่ยนจากการเรียกของ b (%)', v; end if;

  -- T12 ผู้ใช้ที่ยังไม่เปลี่ยนรหัส (c) ใช้ไม่ได้ (42501) และไม่เกิดแถว
  perform pg_temp.login(uc);
  st := pg_temp.state_of($$ select public.merge_settings_if('{"payDay": 3}'::jsonb) $$);
  if st is distinct from '42501' then raise exception 'FAIL: T12 c ที่ยังไม่เปลี่ยนรหัสผ่านต้องได้ 42501 (ได้ %)', st; end if;
  perform pg_temp.logout();
  select count(*) into n from public.settings where user_id = uc;
  if n <> 0 then raise exception 'FAIL: T12 เกิดแถว settings ของ c (%)', n; end if;

  -- T13 ไม่ล็อกอิน (anon) เรียกไม่ได้ · ไม่มีสิทธิ์ execute ของ public/anon
  execute 'set local role anon';
  st := pg_temp.state_of($$ select public.merge_settings_if('{"payDay": 4}'::jsonb) $$);
  execute 'reset role';
  if st is null then raise exception 'FAIL: T13 anon เรียก merge_settings_if ได้'; end if;
  select (has_function_privilege('anon', 'public.merge_settings_if(jsonb,text[],jsonb)', 'execute')::int + has_function_privilege('public', 'public.merge_settings_if(jsonb,text[],jsonb)', 'execute')::int) into n;
  if n <> 0 then raise exception 'FAIL: T13 anon/public ยังมีสิทธิ์ execute (%)', n; end if;

  -- T14 merge_settings เดิมยังทำงานเหมือนเดิม (ไม่ถูกกระทบ)
  perform pg_temp.login(ua);
  v := public.merge_settings('{"payDay": 9}'::jsonb);
  if v -> 'payDay' is distinct from '9'::jsonb then raise exception 'FAIL: T14 merge_settings เดิมผิด (%)', v; end if;
  perform pg_temp.logout();

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
