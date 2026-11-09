-- ทดสอบ: ล้างข้อมูล/ลบบัญชีแบบเป็นชุด (reset_my_ledger_step / delete_my_account_step)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261109000400 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

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

-- สร้างข้อมูลจำนวนมากแบบเร็ว (ในฐานะผู้ดูแล): n รายการ รายการละ 2 บรรทัด สมดุล
create function pg_temp.seed(p_user uuid, p_prefix text, p_n integer) returns void language plpgsql as $$
begin
  insert into public.accounts (user_id, id, type, name, currency) values (p_user, 'w1', 'asset', 'w1', 'THB'), (p_user, 'food', 'expense', 'food', 'THB');
  insert into public.entries (user_id, id, date, memo, source) select p_user, p_prefix || i, date '2026-11-02', '', 'manual' from generate_series(1, p_n) i;
  insert into public.lines (user_id, entry_id, idx, account_id, amount)
    select p_user, p_prefix || i, j, case when j = 1 then 'food' else 'w1' end, case when j = 1 then 1 else -1 end from generate_series(1, p_n) i, generate_series(1, 2) j;
  insert into public.bills (user_id, id, name, amount, due_day) values (p_user, 'bill-' || p_prefix, 'b', 100, 5);
  insert into public.settings (user_id, value) values (p_user, '{"payDay":25}'::jsonb);
end $$;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  n integer;
  steps integer;
  v_attempts integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-bd@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-bd@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-bd@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- T1 ยังไม่เปลี่ยนรหัส = ทุกฟังก์ชันปฏิเสธ
  perform pg_temp.login(ua);
  if pg_temp.fails($$ select public.reset_my_ledger_step('old-password-1') $$) is null then raise exception 'FAIL: T1 reset'; end if;
  if pg_temp.fails($$ select public.delete_my_account_step('old-password-1') $$) is null then raise exception 'FAIL: T1 delete'; end if;
  perform pg_temp.logout();
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update auth.users set encrypted_password = extensions.crypt('new-password-3', extensions.gen_salt('bf')) where id = uc;

  -- T2 cooldown 24 ชม. ยังบังคับ (เพิ่งเปลี่ยนรหัส) ทั้งสองฟังก์ชัน · ไม่นับเป็นการลองรหัส
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.reset_my_ledger_step('new-password-1') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T2 reset ไม่ติด cooldown (%)', r; end if;
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password-1') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T2 delete ไม่ติด cooldown (%)', r; end if;
  perform pg_temp.logout();
  select count(*) into v_attempts from private.delete_attempts where user_id = ua;
  if v_attempts <> 0 then raise exception 'FAIL: T2 cooldown ถูกนับเป็นการลองรหัส (%)', v_attempts; end if;

  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub, uc);
  perform pg_temp.seed(ua, 'a', 1200);
  perform pg_temp.seed(ub, 'b', 30);
  perform pg_temp.seed(uc, 'c', 1200);
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);

  -- T3 รหัสผิด = 'wrong' ไม่ลบอะไรเลย · นับเฉพาะรหัสผิด · ถูกจำกัดเมื่อผิดครบ 5 ครั้ง (แม้ใส่รหัสถูกหลังจากนั้น)
  perform pg_temp.login(ua);
  for i in 1..5 loop
    if public.reset_my_ledger_step('wrong-' || i) <> 'wrong' then raise exception 'FAIL: T3 รหัสผิดไม่คืน wrong (ครั้ง %)', i; end if;
  end loop;
  select count(*) into n from public.entries; if n <> 1200 then raise exception 'FAIL: T3 รหัสผิดแต่ข้อมูลหาย (%)', n; end if;
  r := pg_temp.fails($$ select public.reset_my_ledger_step('new-password-1') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T3 ไม่ถูกจำกัดการลองหลังผิด 5 ครั้ง (%)', r; end if;
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password-1') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T3 delete ไม่ถูกจำกัด (%)', r; end if;
  perform pg_temp.logout();
  -- ล้างตัวนับเพื่อทดสอบต่อ (ผู้ดูแลเท่านั้นทำได้)
  delete from private.delete_attempts where user_id = ua;

  -- T4 รหัสถูก: ล้างเป็นชุดละ 500 → more, more, done (1,200 = 500 + 500 + 200) · ล้างเซสชันนำเข้าค้างด้วย · ข้อมูลผู้ใช้อื่นไม่ถูกแตะ
  perform pg_temp.login(ua);
  steps := 0;
  loop
    r := public.reset_my_ledger_step('new-password-1');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' then raise exception 'FAIL: T4 ผลไม่คาด % (ชุดที่ %)', r, steps; end if;
    if steps > 10 then raise exception 'FAIL: T4 วนไม่จบ'; end if;
    select count(*) into n from public.entries;
    if steps = 1 and n <> 700 then raise exception 'FAIL: T4 หลังชุดแรกเหลือ % <> 700', n; end if;
    if steps = 2 and n <> 200 then raise exception 'FAIL: T4 หลังชุดสองเหลือ % <> 200', n; end if;
  end loop;
  if steps <> 3 then raise exception 'FAIL: T4 จำนวนชุด % <> 3', steps; end if;
  perform pg_temp.settle();
  select (select count(*) from public.entries) + (select count(*) from public.lines) + (select count(*) from public.accounts) + (select count(*) from public.bills) + (select count(*) from public.settings) into n;
  if n <> 0 then raise exception 'FAIL: T4 ล้างแล้วยังเหลือแถว (%)', n; end if;
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: T4 profile ต้องยังอยู่'; end if;
  perform pg_temp.logout();
  if exists (select 1 from private.import_sessions where user_id = ua) then raise exception 'FAIL: T4 เซสชันนำเข้าค้างไม่ถูกล้าง'; end if;
  perform pg_temp.login(ub);
  select count(*) into n from public.entries; if n <> 30 then raise exception 'FAIL: T4 ข้อมูลของ B ถูกกระทบ (%)', n; end if;
  perform pg_temp.logout();

  -- T5 ล้างสมุดว่างซ้ำ: done ทันที ไม่ error (วนซ้ำหลังเน็ตหลุดได้)
  perform pg_temp.login(ua);
  if public.reset_my_ledger_step('new-password-1') <> 'done' then raise exception 'FAIL: T5 สมุดว่างต้องได้ done'; end if;
  perform pg_temp.logout();

  -- T6 ลบบัญชีเป็นชุด: C มี 1,200 รายการ → more, more, done · ผู้ใช้ C หายจาก auth.users · B ยังอยู่
  perform pg_temp.login(uc);
  steps := 0;
  loop
    r := public.delete_my_account_step('new-password-3');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' then raise exception 'FAIL: T6 ผลไม่คาด % (ชุดที่ %)', r, steps; end if;
    if steps > 10 then raise exception 'FAIL: T6 วนไม่จบ'; end if;
  end loop;
  if steps <> 3 then raise exception 'FAIL: T6 จำนวนชุด % <> 3', steps; end if;
  perform pg_temp.logout();
  perform pg_temp.settle();
  select (select count(*) from public.entries where user_id = uc) + (select count(*) from public.lines where user_id = uc) + (select count(*) from public.accounts where user_id = uc) + (select count(*) from public.profiles where user_id = uc) + (select count(*) from auth.users where id = uc) into n;
  if n <> 0 then raise exception 'FAIL: T6 ลบบัญชีแล้วยังเหลือ (%)', n; end if;
  if not exists (select 1 from auth.users where id = ub) then raise exception 'FAIL: T6 บัญชี B ถูกลบ'; end if;

  -- T7 รหัสผิดตอนลบบัญชี = 'wrong' บัญชีไม่ถูกลบ
  perform pg_temp.login(ub);
  if public.delete_my_account_step('wrong-x') <> 'wrong' then raise exception 'FAIL: T7 รหัสผิดไม่คืน wrong'; end if;
  perform pg_temp.logout();
  if not exists (select 1 from auth.users where id = ub) then raise exception 'FAIL: T7 รหัสผิดแต่บัญชีถูกลบ'; end if;

  -- T8 เรียกแบบอ่านอย่างเดียว (GET) ถูกปฏิเสธ · anon เรียกไม่ได้ · ผู้ใช้เรียกฟังก์ชันตัวช่วย private ตรงๆ ไม่ได้
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ select set_config('transaction_read_only', 'on', true), public.reset_my_ledger_step('new-password-2') $$);
  if r is null or r not like '%เขียนได้%' then raise exception 'FAIL: T8 เรียกแบบอ่านอย่างเดียวไม่ถูกปฏิเสธด้วยเหตุผลที่ถูก (%)', r; end if;
  if pg_temp.fails($$ select private.deletion_gate('new-password-2') $$) is null then raise exception 'FAIL: T8 ผู้ใช้เรียก private.deletion_gate ตรงๆ ได้'; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  if pg_temp.fails($$ select public.reset_my_ledger_step('x') $$) is null then raise exception 'FAIL: T8 anon เรียก reset step ได้'; end if;
  if pg_temp.fails($$ select public.delete_my_account_step('x') $$) is null then raise exception 'FAIL: T8 anon เรียก delete step ได้'; end if;
  execute 'reset role';

  -- T9 ฟังก์ชันเดิมยังอยู่และใช้ได้ (เว็บที่ยังไม่อัปเดตเรียกอยู่): ลายเซ็นและสิทธิ์
  if not has_function_privilege('authenticated', 'public.reset_my_ledger(text)', 'execute') then raise exception 'FAIL: T9 reset_my_ledger เดิมหาย'; end if;
  if not has_function_privilege('authenticated', 'public.delete_my_account(text)', 'execute') then raise exception 'FAIL: T9 delete_my_account เดิมหาย'; end if;
  if has_function_privilege('anon', 'public.reset_my_ledger_step(text)', 'execute') or has_function_privilege('anon', 'public.delete_my_account_step(text)', 'execute') then raise exception 'FAIL: T9 anon มีสิทธิ์'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
