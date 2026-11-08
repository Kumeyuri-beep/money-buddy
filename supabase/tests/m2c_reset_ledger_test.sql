-- ทดสอบ M2-C2: reset_my_ledger ล้างเฉพาะข้อมูลของตัวเอง (รวมยอดยกมา) ไม่กระทบผู้อื่น/โปรไฟล์ และ anon เรียกไม่ได้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108000500 และ 20261108000600 แล้ว
-- จบด้วย raise exception เพื่อ rollback ทั้งหมด:  TESTS_PASSED = ผ่าน · FAIL: ... = ไม่ผ่าน
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.settle() returns void
language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end
$$;

create function pg_temp.fails(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  perform pg_temp.settle();
  return null;
exception when others then
  return sqlerrm;
end
$$;

create function pg_temp.login(p_user uuid) returns void
language plpgsql as $$
declare
  v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end
$$;

create function pg_temp.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $test$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  n integer;
  ok boolean;
  acc jsonb := '[
    {"id":"w1","type":"asset","name":"w1","currency":"THB","sortOrder":1},
    {"id":"food","type":"expense","name":"food","currency":"THB"},
    {"id":"open","type":"equity","name":"open","currency":"THB"}
  ]';
  ent jsonb := '[
    {"id":"sys","date":"2026-11-01","memo":"open","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]},
    {"id":"e1","date":"2026-11-02","memo":"x","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}
  ]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-rst@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-rst@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  insert into public.bills (id, name, amount, due_day) values ('b1', 'net', 100, 5);
  insert into public.settings (value) values ('{"payDay":25}');
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.logout();

  -- T1 ลบรายการยอดยกมาตรงๆ ไม่ได้ (ยืนยันเหตุผลที่ต้องมีฟังก์ชันนี้)
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ delete from public.entries where id = 'sys' $$);
  if r is null then raise exception 'FAIL: T1 ลบ system entry ตรงๆ ได้'; end if;
  perform pg_temp.logout();

  -- T2 anon เรียกไม่ได้
  execute 'set local role anon';
  r := pg_temp.fails($$ select public.reset_my_ledger('x') $$);
  if r is null then raise exception 'FAIL: T2 anon เรียก reset_my_ledger ได้'; end if;
  execute 'reset role';

  -- T3 A ล้างของตัวเองหมด (บัญชี รายการ บรรทัด บิล ตั้งค่า) · ยังมี profile
  perform pg_temp.login(ua);
  select public.reset_my_ledger('wrong-password-9') into ok;
  if ok then raise exception 'FAIL: T3 รหัสผิดแต่ล้างได้'; end if;
  select count(*) into n from public.entries;
  if n <> 2 then raise exception 'FAIL: T3 รหัสผิดแต่ข้อมูลหาย (%)', n; end if;
  select public.reset_my_ledger('new-password-1') into ok;
  if not ok then raise exception 'FAIL: T3 รหัสถูกแต่ล้างไม่ได้'; end if;
  perform pg_temp.settle();
  select (select count(*) from public.accounts) + (select count(*) from public.entries) + (select count(*) from public.lines)
       + (select count(*) from public.bills) + (select count(*) from public.settings) into n;
  if n <> 0 then raise exception 'FAIL: T3 หลังล้าง A ยังเหลือแถว %', n; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: T3 profile ของ A ต้องยังอยู่ (%)', n; end if;
  perform pg_temp.logout();

  -- T4 ของ B ไม่ถูกแตะ
  perform pg_temp.login(ub);
  select count(*) into n from public.entries;
  if n <> 2 then raise exception 'FAIL: T4 ข้อมูลของ B ถูกกระทบ (entries %)', n; end if;
  select count(*) into n from public.accounts;
  if n <> 3 then raise exception 'FAIL: T4 บัญชีของ B ถูกกระทบ (%)', n; end if;
  perform pg_temp.logout();

  -- T5 ล้างแล้วตั้งต้นใหม่ได้
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  select count(*) into n from public.entries;
  if n <> 2 then raise exception 'FAIL: T5 ตั้งต้นใหม่หลังล้างไม่ได้ (%)', n; end if;
  perform pg_temp.logout();

  -- T6 ยังไม่เปลี่ยนรหัส = เรียกไม่ได้
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (gen_random_uuid(), 'c-rst@users.money-buddy.internal', 'x', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  perform pg_temp.login((select id from auth.users where email = 'c-rst@users.money-buddy.internal'));
  r := pg_temp.fails($$ select public.reset_my_ledger('x') $$);
  if r is null then raise exception 'FAIL: T6 ผู้ใช้ที่ยังไม่เปลี่ยนรหัสเรียกได้'; end if;
  perform pg_temp.logout();

  -- T7 แคตตาล็อก: anon/PUBLIC ไม่มีสิทธิ์ · authenticated มี
  if has_function_privilege('anon', 'public.reset_my_ledger(text)', 'execute') then
    raise exception 'FAIL: T7 anon มีสิทธิ์ execute';
  end if;
  if not has_function_privilege('authenticated', 'public.reset_my_ledger(text)', 'execute') then
    raise exception 'FAIL: T7 authenticated ไม่มีสิทธิ์ execute';
  end if;

  -- T8 จ่ายบิลที่เก็บถาวรไม่ได้ (entries_bill_link)
  perform pg_temp.login(ub);
  insert into public.bills (id, name, amount, due_day, archived) values ('barch', 'old', 100, 5, true);
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay-arch","date":"2026-11-04","memo":"x","source":"recurring","bill":{"id":"barch","cycle":"2026-11"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null or r not like '%เก็บถาวร%' then raise exception 'FAIL: T8 จ่ายบิลที่เก็บถาวรได้ (%)', r; end if;
  perform pg_temp.logout();

  -- T9 ลองรหัสผิด 5 ครั้งแล้วครั้งที่ 6 ถูกจำกัด
  perform pg_temp.login(ub);
  for i in 1..5 loop
    select public.reset_my_ledger('wrong-' || i) into ok;
    if ok then raise exception 'FAIL: T9 รหัสผิดแต่ล้างได้'; end if;
  end loop;
  r := pg_temp.fails($$ select public.reset_my_ledger('new-password-2') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T9 ไม่ถูกจำกัดการลอง (%)', r; end if;
  select count(*) into n from public.entries;
  if n <> 2 then raise exception 'FAIL: T9 ข้อมูลของ B ถูกกระทบ (%)', n; end if;
  perform pg_temp.logout();

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$test$;
