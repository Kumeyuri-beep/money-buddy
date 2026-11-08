-- ทดสอบ M2-D: import_ledger นำเข้าทั้งก้อนในธุรกรรมเดียว ไม่ทับ ไม่ซ้ำ ย้อนกลับทั้งก้อนเมื่อผิด และเส้นทางจ่ายบิลปกติยังตรวจเหมือนเดิม
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108000900 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน
-- ไม่ใช้ข้อมูลการเงินจริง

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
  r text;
  n integer;
  v jsonb;
  v_paid text;
  good jsonb := '{
    "accounts":[
      {"id":"w1","type":"asset","name":"w1","currency":"THB","sortOrder":1},
      {"id":"food","type":"expense","name":"food","currency":"THB"},
      {"id":"open","type":"equity","name":"open","currency":"THB"}],
    "bills":[{"id":"b1","name":"net","amount":59900,"dueDay":5,"walletId":"w1","categoryId":"food","lastPaidMonth":"2026-11","startMonth":"2026-10"}],
    "entries":[
      {"id":"sys","date":"2026-11-01","memo":"open","source":"system","createdAt":"2026-11-01T00:00:00.000Z","lines":[{"accountId":"w1","amount":100000},{"accountId":"open","amount":-100000}]},
      {"id":"e1","date":"2026-11-02","memo":"x","source":"manual","createdAt":"2026-11-02T03:00:00.000Z","lines":[{"accountId":"food","amount":5000},{"accountId":"w1","amount":-5000}]},
      {"id":"pay1","date":"2026-11-05","memo":"net","source":"recurring","bill":{"id":"b1","cycle":"2026-11"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}],
    "settings":{"payDay":25}
  }';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-imp@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-imp@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  -- T1 anon เรียกไม่ได้
  execute 'set local role anon';
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[],"entries":[]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T1 anon นำเข้าได้'; end if;
  execute 'reset role';

  -- T2 นำเข้าสำเร็จ: จำนวนตรง · lastPaidMonth จากไฟล์คงอยู่ (รวมรายการ system และ recurring) · ตั้งค่าครบ
  perform pg_temp.login(ua);
  v := public.import_ledger(good);
  perform pg_temp.settle();
  if v <> '{"accounts":3,"bills":1,"entries":3}'::jsonb then raise exception 'FAIL: T2 จำนวนที่นำเข้าไม่ตรง %', v; end if;
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T2 lastPaidMonth ไม่คงตามไฟล์ (%)', v_paid; end if;
  select count(*) into n from public.entries where source = 'system';
  if n <> 1 then raise exception 'FAIL: T2 รายการ system หาย'; end if;
  select count(*) into n from public.entries where bill_id = 'b1' and bill_cycle = '2026-11';
  if n <> 1 then raise exception 'FAIL: T2 ลิงก์บิลหาย'; end if;
  select (value->>'payDay')::int into n from public.settings;
  if n <> 25 then raise exception 'FAIL: T2 ตั้งค่าไม่ครบ'; end if;
  select coalesce(sum(amount), 0) into n from public.lines where account_id = 'w1';
  if n <> 100000 - 5000 - 59900 then raise exception 'FAIL: T2 ยอด w1 ไม่ตรง (%)', n; end if;
  perform pg_temp.logout();

  -- T3 นำเข้าซ้ำถูกปฏิเสธ ไม่ซ้ำซ้อน ไม่แก้ของเดิม
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[],"entries":[]}'::jsonb) $$);
  if r is null or r not like '%มีข้อมูลอยู่แล้ว%' then raise exception 'FAIL: T3 นำเข้าซ้ำไม่ถูกปฏิเสธ (%)', r; end if;
  select count(*) into n from public.entries;
  if n <> 3 then raise exception 'FAIL: T3 รายการเปลี่ยนไป (%)', n; end if;
  perform pg_temp.logout();

  -- T4 B เห็นแต่ของตัวเอง (ว่าง) และนำเข้าของตัวเองได้ · ของ A ไม่ถูกแตะ
  perform pg_temp.login(ub);
  select count(*) into n from public.entries;
  if n <> 0 then raise exception 'FAIL: T4 B เห็นข้อมูลของ A'; end if;
  perform public.import_ledger(good);
  perform pg_temp.settle();
  select count(*) into n from public.entries;
  if n <> 3 then raise exception 'FAIL: T4 B นำเข้าไม่ครบ (%)', n; end if;
  perform pg_temp.logout();
  perform pg_temp.login(ua);
  select count(*) into n from public.entries;
  if n <> 3 then raise exception 'FAIL: T4 ข้อมูลของ A เปลี่ยน (%)', n; end if;
  perform pg_temp.logout();

  -- T5 ไม่สมดุล = ย้อนกลับทั้งก้อน (ไม่เหลือบัญชี/บิล/รายการค้าง)
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (gen_random_uuid(), 'c-imp@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-3', extensions.gen_salt('bf')) where email = 'c-imp@users.money-buddy.internal';
  perform pg_temp.login((select id from auth.users where email = 'c-imp@users.money-buddy.internal'));
  r := pg_temp.fails($$ select public.import_ledger(jsonb_set('{"accounts":[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}],"bills":[],"entries":[{"id":"bad","date":"2026-11-01","memo":"","source":"manual","lines":[{"accountId":"w1","amount":100},{"accountId":"open","amount":-99}]}]}'::jsonb, '{settings}', '{}')) $$);
  if r is null then raise exception 'FAIL: T5 รายการไม่สมดุลถูกนำเข้า'; end if;
  select (select count(*) from public.accounts) + (select count(*) from public.entries) + (select count(*) from public.bills) into n;
  if n <> 0 then raise exception 'FAIL: T5 ล้มแล้วยังเหลือแถวค้าง (%)', n; end if;

  -- T6 บัญชีไม่มีจริง / lastPaidMonth อนาคต (R15) = ถูกปฏิเสธทั้งก้อน
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[{"id":"w1","type":"asset","name":"w1","currency":"THB"}],"bills":[{"id":"b","name":"n","amount":1,"dueDay":1,"lastPaidMonth":"2999-01"}],"entries":[]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 lastPaidMonth อนาคตถูกนำเข้า'; end if;
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[{"id":"w1","type":"asset","name":"w1","currency":"THB"}],"bills":[],"entries":[{"id":"e","date":"2026-11-01","memo":"","source":"manual","lines":[{"accountId":"w1","amount":1},{"accountId":"ไม่มี","amount":-1}]}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 บัญชีที่ไม่มีถูกนำเข้า'; end if;
  select (select count(*) from public.accounts) + (select count(*) from public.bills) into n;
  if n <> 0 then raise exception 'FAIL: T6 ล้มแล้วยังเหลือแถวค้าง (%)', n; end if;

  -- T7 รูปแบบผิด / เกินเพดาน
  r := pg_temp.fails($$ select public.import_ledger('[]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T7 รูปแบบผิดถูกรับ'; end if;
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":"x","entries":[]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T7 accounts ไม่ใช่อาร์เรย์ถูกรับ'; end if;
  perform pg_temp.logout();

  -- T8 เส้นทางจ่ายบิลปกติยังตรวจเหมือนเดิม: ผู้ใช้ A (นำเข้าแล้ว lastPaidMonth=2026-11) จ่ายรอบ 2026-11 ซ้ำ ต้องถูกปฏิเสธ
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay2","date":"2026-11-06","memo":"x","source":"recurring","bill":{"id":"b1","cycle":"2026-11","before":"2026-10"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T8 จ่ายรอบเดิมซ้ำได้หลังนำเข้า'; end if;
  perform pg_temp.logout();

  -- T9 แคตตาล็อก
  if has_function_privilege('anon', 'public.import_ledger(jsonb)', 'execute') then raise exception 'FAIL: T9 anon มีสิทธิ์'; end if;
  if not has_function_privilege('authenticated', 'public.import_ledger(jsonb)', 'execute') then raise exception 'FAIL: T9 authenticated ไม่มีสิทธิ์'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
