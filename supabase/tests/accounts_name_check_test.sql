-- ทดสอบ migration 20261114000200: constraint accounts_name_no_invisible (ห้ามอักขระควบคุม/มองไม่เห็นในชื่อบัญชี)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261114000200_accounts_name_check** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
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
grant execute on function pg_temp.settle(), pg_temp.state_of(text), pg_temp.login(uuid), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  st text;
  bad text[] := array[
    'ชื่อ' || chr(8203) || 'หมวด',           -- U+200B ศูนย์ความกว้าง
    'ชื่อ' || chr(8206) || 'หมวด',           -- U+200E ตัวกำกับทิศ
    'ชื่อ' || chr(8238) || 'หมวด',           -- U+202E กลับทิศข้อความ
    'ชื่อ' || chr(8288) || 'หมวด',           -- U+2060
    'ชื่อ' || chr(8297) || 'หมวด',           -- U+2069
    'ชื่อ' || chr(65279) || 'หมวด',          -- U+FEFF BOM
    'ชื่อ' || chr(7) || 'หมวด',              -- C0 (bell)
    'ชื่อ' || chr(10) || 'หมวด',             -- ขึ้นบรรทัดใหม่
    'ชื่อ' || chr(9) || 'หมวด',              -- แท็บ
    'ชื่อ' || chr(127) || 'หมวด',            -- DEL
    'ชื่อ' || chr(133) || 'หมวด'             -- C1 (NEL)
  ];
  good text[] := array['อาหาร', 'ค่า กาแฟ (ร้านหน้า) #1', 'Cafe-Latte_2', 'เงินเดือน 50% / โบนัส', 'หมวด 😀 อีโมจิ', 'ก' || chr(3633) || chr(3656)];
  i integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-chk@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;

  -- T1 constraint มีอยู่และผ่านการตรวจแล้ว (validated)
  if not exists (select 1 from pg_constraint where conname = 'accounts_name_no_invisible' and conrelid = 'public.accounts'::regclass and convalidated) then
    raise exception 'FAIL: T1 ไม่มี constraint accounts_name_no_invisible หรือยังไม่ validated';
  end if;

  perform pg_temp.login(ua);
  -- T2 ชื่อปกติ (ไทย/อังกฤษ/สัญลักษณ์/อีโมจิ/สระวรรณยุกต์) ผ่านทั้ง insert และ update name
  for i in 1 .. array_length(good, 1) loop
    insert into public.accounts (id, type, name, currency, kind) values ('good-' || i, 'expense', good[i], 'THB', 'normal');
  end loop;
  update public.accounts set name = 'ชื่อใหม่ปกติ' where id = 'good-1';

  -- T3 ชื่อที่มีอักขระควบคุม/มองไม่เห็น/กลับทิศ ถูกปฏิเสธ (23514) ทั้ง insert และ update name ทุกแบบ
  for i in 1 .. array_length(bad, 1) loop
    st := pg_temp.state_of(format('insert into public.accounts (id, type, name, currency, kind) values (%L, %L, %L, %L, %L)', 'bad-' || i, 'expense', bad[i], 'THB', 'normal'));
    if st is distinct from '23514' then raise exception 'FAIL: T3 insert ชื่อแบบที่ % ต้อง 23514 ได้ %', i, st; end if;
    st := pg_temp.state_of(format('update public.accounts set name = %L where id = %L', bad[i], 'good-2'));
    if st is distinct from '23514' then raise exception 'FAIL: T3 update ชื่อแบบที่ % ต้อง 23514 ได้ %', i, st; end if;
  end loop;
  if (select name from public.accounts where id = 'good-2') is distinct from 'ค่า กาแฟ (ร้านหน้า) #1' then raise exception 'FAIL: T3 update ที่ถูกปฏิเสธเปลี่ยนค่า'; end if;

  -- T4 ฟังก์ชันที่สร้างบัญชี (setup_ledger) ก็ถูกกันด้วย constraint เดียวกัน
  st := pg_temp.state_of(format($q$select public.setup_ledger(%L::jsonb, '[]'::jsonb)$q$, json_build_array(json_build_object('id', 'w9', 'type', 'asset', 'name', 'กระเป๋า' || chr(8238) || 'กลับทิศ', 'currency', 'THB'))::text));
  if st is null then raise exception 'FAIL: T4 setup_ledger ยอมรับชื่อกลับทิศ'; end if;
  if exists (select 1 from public.accounts where id = 'w9') then raise exception 'FAIL: T4 บัญชีที่ชื่อกลับทิศถูกสร้างผ่าน setup_ledger'; end if;

  perform pg_temp.logout();
  raise exception 'TESTS_PASSED';
end
$t$;
