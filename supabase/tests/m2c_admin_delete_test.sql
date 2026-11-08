-- ทดสอบ M2-C2: ลบข้อมูลผู้ใช้ด้วยบทบาทระบบได้ (ไม่ติด permission denied for schema private) และไม่มีบทบาทใดข้ามการตรวจสมดุลได้
-- ใช้ service_role แทน supabase_auth_admin (ตั้ง role หลังตัวจริงไม่ได้ใน SQL Editor) ทั้งสองไม่มีสิทธิ์ใน schema private เหมือนกัน
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108000800 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  r text;
  n integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'del-test@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  insert into auth.sessions (id, user_id) values (md5(ua::text)::uuid, ua);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated', 'session_id', md5(ua::text)::uuid, 'is_anonymous', false)::text, true);
  perform public.setup_ledger('[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"}]'::jsonb,
    '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]},{"id":"e1","date":"2026-11-02","memo":"x","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}]'::jsonb);
  perform pg_temp.settle();

  -- T1 ผู้ใช้ทั่วไปยังถูกตรวจสมดุลตอนลบ/เพิ่มบรรทัด
  r := pg_temp.fails($$ delete from public.lines where entry_id = 'e1' and idx = 1 $$);
  if r is null then raise exception 'FAIL: T1 ผู้ใช้ทั่วไปลบบรรทัดให้ไม่สมดุลได้'; end if;
  r := pg_temp.fails($$ insert into public.lines (entry_id, idx, account_id, amount) values ('e1', 3, 'food', 5) $$);
  if r is null then raise exception 'FAIL: T1 ผู้ใช้ทั่วไปเพิ่มบรรทัดให้ไม่สมดุลได้'; end if;
  execute 'reset role';

  -- T2 บทบาทระบบก็ลบบรรทัดเดียวของ Entry (ให้ไม่สมดุล) ไม่ได้ ล้มตอนตรวจ (ไม่มีช่องข้าม)
  execute 'set local role service_role';
  r := pg_temp.fails($$ delete from public.lines where user_id = '$$ || ua || $$' and entry_id = 'e1' and idx = 1 $$);
  execute 'reset role';
  if r is null then raise exception 'FAIL: T2 service_role ลบบรรทัดให้ Entry ไม่สมดุลได้'; end if;

  -- T3 บทบาทระบบลบทั้ง Entry/บิล/บัญชี (รวมยอดยกมา) ได้ ไม่ติดสิทธิ์ schema private
  execute 'set local role service_role';
  delete from public.entries where user_id = ua;
  set constraints all immediate;
  delete from public.bills where user_id = ua;
  delete from public.accounts where user_id = ua;
  execute 'reset role';
  select count(*) into n from public.lines where user_id = ua;
  if n <> 0 then raise exception 'FAIL: T3 ยังเหลือบรรทัด %', n; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
