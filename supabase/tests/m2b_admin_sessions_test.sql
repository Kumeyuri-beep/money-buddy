-- ทดสอบ M2-B2: ฟังก์ชันเพิกถอน session สำหรับสคริปต์ผู้ดูแล (service_role เท่านั้น)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108000400 แล้ว
-- จบด้วย raise exception เพื่อ rollback ทั้งหมด:  TESTS_PASSED = ผ่าน · FAIL: ... = ไม่ผ่าน
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.fails(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end
$$;
grant execute on function pg_temp.fails(text) to public;

do $test$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  v_int integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-adm@users.money-buddy.internal', 'x', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-adm@users.money-buddy.internal', 'x', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into auth.sessions (id, user_id) values (gen_random_uuid(), ua), (gen_random_uuid(), ua), (gen_random_uuid(), ub);

  -- T1 anon / authenticated เรียกไม่ได้ ทั้งนับและเพิกถอน
  execute 'set local role anon';
  r := pg_temp.fails(format($$ select public.admin_session_count('%s') $$, ua));
  if r is null then raise exception 'FAIL: T1 anon นับ session ได้'; end if;
  r := pg_temp.fails(format($$ select public.admin_revoke_sessions('%s') $$, ua));
  if r is null then raise exception 'FAIL: T1 anon เพิกถอน session ได้'; end if;
  execute 'reset role';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  r := pg_temp.fails(format($$ select public.admin_session_count('%s') $$, ua));
  if r is null then raise exception 'FAIL: T1 authenticated นับ session ของคนอื่นได้'; end if;
  r := pg_temp.fails(format($$ select public.admin_revoke_sessions('%s') $$, ua));
  if r is null then raise exception 'FAIL: T1 authenticated เพิกถอน session ของคนอื่นได้'; end if;
  execute 'reset role';

  -- T2 service_role นับและเพิกถอนได้ · กระทบเฉพาะผู้ใช้ที่ระบุ
  execute 'set local role service_role';
  select public.admin_session_count(ua) into v_int;
  if v_int <> 2 then raise exception 'FAIL: T2 นับ session ของ A ได้ % (ควร 2)', v_int; end if;
  select public.admin_revoke_sessions(ua) into v_int;
  if v_int <> 2 then raise exception 'FAIL: T2 เพิกถอน session ของ A ได้ % (ควร 2)', v_int; end if;
  select public.admin_session_count(ua) into v_int;
  if v_int <> 0 then raise exception 'FAIL: T2 หลังเพิกถอน A ยังเหลือ session %', v_int; end if;
  select public.admin_session_count(ub) into v_int;
  if v_int <> 1 then raise exception 'FAIL: T2 เพิกถอนของ A กระทบ B (เหลือ %)', v_int; end if;
  select public.admin_revoke_sessions(gen_random_uuid()) into v_int;
  if v_int <> 0 then raise exception 'FAIL: T2 ผู้ใช้ที่ไม่มีอยู่ต้องได้ 0'; end if;
  execute 'reset role';

  -- T3 แคตตาล็อก: ไม่มี PUBLIC/anon/authenticated execute
  select count(*) into v_int from pg_proc p
   where p.proname in ('admin_revoke_sessions', 'admin_session_count')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_int <> 0 then raise exception 'FAIL: T3 anon/authenticated มีสิทธิ์เรียกฟังก์ชันผู้ดูแล'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$test$;
