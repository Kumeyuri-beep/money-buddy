-- ทดสอบ: record_consent(p_version) บันทึกเวอร์ชันนโยบายที่ยอมรับ
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108001500 และ 20261109000100 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.fails(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  v_at timestamptz;
  v_at2 timestamptz;
  v_ver text;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-cv@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-cv@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- T1 ยังไม่เปลี่ยนรหัส = บันทึกไม่ได้
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.record_consent('2026-11-09') $$);
  if r is null then raise exception 'FAIL: T1 ยังไม่เปลี่ยนรหัสแต่ยอมรับนโยบายได้'; end if;
  perform pg_temp.logout();

  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  -- T2 เวอร์ชันที่ไม่อยู่ในรายการ/ว่าง/ข้อความอิสระ = ปฏิเสธ
  perform pg_temp.login(ua);
  foreach r in array array['2099-01-01', 'hacked', '', '2026-11-09; drop table x'] loop
    if pg_temp.fails(format('select public.record_consent(%L)', r)) is null then raise exception 'FAIL: T2 รับเวอร์ชัน %', r; end if;
  end loop;
  if pg_temp.fails($$ select public.record_consent(null) $$) is null then raise exception 'FAIL: T2 รับเวอร์ชัน null'; end if;
  select consented_at, consented_version into v_at, v_ver from public.profiles;
  if v_at is not null or v_ver is not null then raise exception 'FAIL: T2 ถูกปฏิเสธแล้วแต่มีการบันทึก'; end if;

  -- T3 เวอร์ชันถูกต้อง: ตั้งเวลา+เวอร์ชัน · เรียกซ้ำเวอร์ชันเดิมไม่เปลี่ยนเวลา
  perform public.record_consent('2026-11-09');
  select consented_at, consented_version into v_at, v_ver from public.profiles;
  if v_at is null or v_ver is distinct from '2026-11-09' then raise exception 'FAIL: T3 ไม่ได้บันทึก (% %)', v_at, v_ver; end if;
  perform public.record_consent('2026-11-09');
  select consented_at into v_at2 from public.profiles;
  if v_at2 is distinct from v_at then raise exception 'FAIL: T3 เรียกซ้ำเวอร์ชันเดิมแล้วเวลาเปลี่ยน'; end if;

  -- T4 เปลี่ยนเวอร์ชันในตาราง (ผู้ดูแลเพิ่มเวอร์ชันใหม่) = ยอมรับใหม่ ตั้งเวลาใหม่ · เวอร์ชันเก่ายังอยู่ในประวัติของผู้ใช้อื่นไม่กระทบ
  perform pg_temp.logout();
  update private.policy_versions set is_current = false where is_current;
  insert into private.policy_versions (version, is_current) values ('2026-12-01', true);
  -- now() คงที่ในธุรกรรมเดียว: ย้อนเวลายอมรับเดิมไปก่อน แล้วดูว่าเวอร์ชันใหม่ตั้งเวลาใหม่
  update public.profiles set consented_at = now() - interval '1 day' where user_id = ua;
  select consented_at into v_at from public.profiles where user_id = ua;
  perform pg_temp.login(ua);
  perform public.record_consent('2026-12-01');
  select consented_at, consented_version into v_at2, v_ver from public.profiles;
  if v_ver is distinct from '2026-12-01' or v_at2 <= v_at then raise exception 'FAIL: T4 ยอมรับเวอร์ชันใหม่แล้วไม่อัปเดต (% %)', v_ver, v_at2; end if;
  -- T4b ฉบับเก่า (ไม่ใช่ฉบับปัจจุบันแล้ว) ยอมรับไม่ได้ · เวอร์ชันของผู้ใช้ไม่เปลี่ยน
  if pg_temp.fails($$ select public.record_consent('2026-11-09') $$) is null then raise exception 'FAIL: T4b ยอมรับฉบับที่ไม่ใช่ฉบับปัจจุบันได้'; end if;
  select consented_version into v_ver from public.profiles;
  if v_ver is distinct from '2026-12-01' then raise exception 'FAIL: T4b ถูกปฏิเสธแล้วแต่เวอร์ชันเปลี่ยน (%)', v_ver; end if;
  perform pg_temp.logout();
  -- ฉบับปัจจุบันมีได้แถวเดียว
  if pg_temp.fails($$ insert into private.policy_versions (version, is_current) values ('2027-01-01', true) $$) is null then
    raise exception 'FAIL: T4b ตั้งฉบับปัจจุบันได้สองแถว';
  end if;

  -- T5ผู้ใช้ B ไม่ได้รับผลกระทบ (ยังไม่ยอมรับ)
  perform pg_temp.login(ub);
  select consented_at, consented_version into v_at, v_ver from public.profiles;
  if v_at is not null or v_ver is not null then raise exception 'FAIL: T5 การยอมรับของ A กระทบ B'; end if;
  -- ผู้ใช้แก้ consented_version ตรงๆ ไม่ได้
  if pg_temp.fails($$ update public.profiles set consented_version = '2026-11-09', consented_at = now() $$) is null then
    raise exception 'FAIL: T5 ผู้ใช้แก้โปรไฟล์ตรงๆ ได้';
  end if;
  perform pg_temp.logout();

  -- T6 anon เรียกไม่ได้ · ผู้ใช้อ่านตารางรายการเวอร์ชันตรงๆ ไม่ได้ · ฟังก์ชันเก่าแบบไม่มีพารามิเตอร์หายไปแล้ว
  execute 'set local role anon';
  if pg_temp.fails($$ select public.record_consent('2026-11-09') $$) is null then raise exception 'FAIL: T6 anon เรียกได้'; end if;
  execute 'reset role';
  perform pg_temp.login(ub);
  if pg_temp.fails($$ select * from private.policy_versions $$) is null then raise exception 'FAIL: T6 ผู้ใช้อ่านรายการเวอร์ชันได้'; end if;
  perform pg_temp.logout();
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_consent' and p.pronargs = 0) then
    raise exception 'FAIL: T6 ยังมี record_consent() แบบเดิม';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
