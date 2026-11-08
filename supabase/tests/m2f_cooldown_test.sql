-- ทดสอบ M2-F: cooldown 24 ชั่วโมงหลังเปลี่ยนรหัสผ่าน ห้ามลบบัญชี/ล้างข้อมูล (บังคับฝั่งเซิร์ฟเวอร์)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108001400 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

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
  r text;
  ok boolean;
  n integer;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-cd@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  -- เปลี่ยนรหัสจริง (trigger ตั้ง password_changed_at = now())
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();

  -- T1 เพิ่งเปลี่ยนรหัส: ทั้งล้างข้อมูลและลบบัญชีถูกปฏิเสธ แม้รหัสถูก · ไม่นับเป็นการลองรหัสผิด · ข้อมูลไม่หาย
  r := pg_temp.fails($$ select public.reset_my_ledger('new-password-1') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T1 ล้างข้อมูลหลังเปลี่ยนรหัสได้ (%)', r; end if;
  r := pg_temp.fails($$ select public.delete_my_account('new-password-1') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T1 ลบบัญชีหลังเปลี่ยนรหัสได้ (%)', r; end if;
  select count(*) into n from public.entries;
  if n <> 1 then raise exception 'FAIL: T1 ข้อมูลหาย (%)', n; end if;
  perform pg_temp.logout();
  select count(*) into n from private.delete_attempts where user_id = ua;
  if n <> 0 then raise exception 'FAIL: T1 cooldown ถูกนับเป็นการลองรหัส (%)', n; end if;

  -- T2 ผ่านไป 25 ชั่วโมง: รหัสผิดได้ false (นับครั้ง) · รหัสถูกล้างได้
  update public.profiles set password_changed_at = now() - interval '25 hours' where user_id = ua;
  perform pg_temp.login(ua);
  select public.reset_my_ledger('wrong-password-9') into ok;
  if ok then raise exception 'FAIL: T2 รหัสผิดแต่ล้างได้'; end if;
  select public.reset_my_ledger('new-password-1') into ok;
  if not ok then raise exception 'FAIL: T2 พ้น cooldown แล้วล้างไม่ได้'; end if;
  select count(*) into n from public.entries;
  if n <> 0 then raise exception 'FAIL: T2 ล้างแล้วยังเหลือข้อมูล (%)', n; end if;
  perform pg_temp.logout();

  -- T3 เปลี่ยนรหัสอีกครั้ง = เริ่มนับ 24 ชั่วโมงใหม่ (ผู้ถือ session ขโมยเปลี่ยนรหัสแล้วลบทันทีไม่ได้)
  update auth.users set encrypted_password = extensions.crypt('thief-password-2', extensions.gen_salt('bf')) where id = ua;
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.delete_my_account('thief-password-2') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T3 เปลี่ยนรหัสแล้วลบบัญชีได้ทันที (%)', r; end if;
  perform pg_temp.logout();
  if not exists (select 1 from auth.users where id = ua) then raise exception 'FAIL: T3 บัญชีถูกลบ'; end if;

  -- T4 พ้น cooldown ลบบัญชีได้จริง
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id = ua;
  perform pg_temp.login(ua);
  select public.delete_my_account('thief-password-2') into ok;
  if not ok then raise exception 'FAIL: T4 พ้น cooldown แล้วลบบัญชีไม่ได้'; end if;
  perform pg_temp.logout();
  if exists (select 1 from auth.users where id = ua) then raise exception 'FAIL: T4 บัญชียังอยู่'; end if;

  -- T5 ฟังก์ชันตรวจ cooldown เรียกตรงไม่ได้
  if has_function_privilege('authenticated', 'private.assert_password_cooled(uuid)', 'execute')
     or has_function_privilege('anon', 'private.assert_password_cooled(uuid)', 'execute') then
    raise exception 'FAIL: T5 ผู้ใช้เรียก assert_password_cooled ได้';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
