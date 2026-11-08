-- ทดสอบ M2-A (RLS, สมดุลบัญชีคู่, R15, ธงเปลี่ยนรหัส, session, ลบบัญชี, สิทธิ์)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration ทั้ง 3 ไฟล์แล้ว
-- ไฟล์นี้ไม่ทิ้งข้อมูลใดไว้: สร้างผู้ใช้ทดสอบในธุรกรรมเดียว แล้วจบด้วย raise exception เพื่อ rollback ทั้งหมด
--   ผ่านทั้งหมด -> ข้อความ error ขึ้นต้นด้วย  TESTS_PASSED
--   ไม่ผ่าน     -> ข้อความ error ขึ้นต้นด้วย  FAIL:  แล้วตามด้วยชื่อข้อทดสอบ
-- ไม่ใช้ข้อมูลการเงินจริง

-- constraint trigger ของ M2-A เป็นแบบ deferred (ตรวจตอน commit) แต่ธุรกรรมทดสอบไม่เคย commit
-- จึงสั่งให้ตรวจทันที แล้วกลับเป็น deferred เหมือนเดิม
create function pg_temp.settle() returns void
language plpgsql as $$
begin
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end
$$;

-- รันคำสั่ง: ไม่ error = คืน null (ข้อทดสอบ "ควร error" ไม่ผ่าน) · error = คืนข้อความ error
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

-- จำลองคำขอของผู้ใช้ที่ล็อกอิน (JWT มี session_id จริงในตาราง auth.sessions)
create function pg_temp.login(p_user uuid, p_anon boolean default false) returns void
language plpgsql as $$
declare
  v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', p_anon)::text, true);
  execute 'set local role authenticated';
end
$$;

-- ล็อกอินด้วย JWT เดิมโดยไม่สร้าง session ใหม่ (ใช้ทดสอบ session ที่ถูกเพิกถอน)
create function pg_temp.login_existing(p_user uuid) returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', md5(p_user::text)::uuid, 'is_anonymous', false)::text, true);
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

-- ฟังก์ชันใหม่ไม่ให้ PUBLIC เรียกโดยปริยายแล้ว (migration ที่ 3) ตัวช่วยเหล่านี้ถูกเรียกขณะเป็น role authenticated/anon
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $test$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  v_int integer;
  v_text text;
  v_bool boolean;
  maxi constant bigint := 9007199254740991;
  acc jsonb := '[
    {"id":"w1","type":"asset","name":"w1","currency":"THB","sortOrder":1},
    {"id":"w2","type":"asset","name":"w2","currency":"THB","sortOrder":2},
    {"id":"food","type":"expense","name":"food","currency":"THB"},
    {"id":"salary","type":"income","name":"salary","currency":"THB"},
    {"id":"open","type":"equity","name":"open","currency":"THB"},
    {"id":"usd","type":"asset","name":"usd","currency":"USD"},
    {"id":"fx","type":"equity","name":"fx","currency":"USD"}
  ]';
begin
  -- ---------- เตรียมผู้ใช้ (สร้างผ่านตาราง auth.users โดยตรง ใน rollback) ----------
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-test@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-test@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- T1 trigger สร้าง profiles อัตโนมัติ และธงเป็น true
  select count(*) into v_int from public.profiles where user_id in (ua, ub) and must_change_password;
  if v_int <> 2 then raise exception 'FAIL: T1 profiles ไม่ถูกสร้าง/ธงไม่เป็น true (%)', v_int; end if;

  -- T2 ยังไม่เปลี่ยนรหัส: อ่าน/เขียนตารางข้อมูลและเรียก RPC ไม่ได้
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('x','asset','x','THB') $$);
  if r is null then raise exception 'FAIL: T2 เขียนข้อมูลได้ทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T2 อ่านข้อมูลได้ทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  r := pg_temp.fails($$ select public.setup_ledger('[]'::jsonb, '[]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T2 setup_ledger ผ่านทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  r := pg_temp.fails($$ select public.record_consent() $$);
  if r is null then raise exception 'FAIL: T2 record_consent ผ่านทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  perform pg_temp.logout();

  -- T3 ผู้ใช้ที่ไม่มีแถว profiles เข้าไม่ได้ (ปิดไว้ก่อน)
  delete from public.profiles where user_id = ub;
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('x','asset','x','THB') $$);
  if r is null then raise exception 'FAIL: T3 ผู้ใช้ไม่มี profiles เขียนข้อมูลได้'; end if;
  perform pg_temp.logout();
  insert into public.profiles (user_id) values (ub);

  -- T4 เปลี่ยนรหัสจริง -> trigger เคลียร์ธง · อัปเดต hash เป็นค่าเดิมไม่เคลียร์
  update auth.users set encrypted_password = encrypted_password where id = ua;
  select must_change_password into v_bool from public.profiles where user_id = ua;
  if v_bool is not true then raise exception 'FAIL: T4 ธงถูกเคลียร์ทั้งที่รหัสไม่เปลี่ยน'; end if;
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  select count(*) into v_int from public.profiles where user_id in (ua, ub) and not must_change_password and password_changed_at is not null;
  if v_int <> 2 then raise exception 'FAIL: T4 ธงไม่ถูกเคลียร์หลังเปลี่ยนรหัส'; end if;

  -- T5 ผู้ใช้เขียน profiles เองไม่ได้ · ยินยอมผ่าน RPC ตั้งเวลาฝั่งเซิร์ฟเวอร์
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ update public.profiles set must_change_password = false $$);
  if r is null then raise exception 'FAIL: T5 ผู้ใช้แก้ profiles เองได้'; end if;
  perform public.record_consent();
  perform pg_temp.logout();
  select count(*) into v_int from public.profiles where user_id = ua and consented_at is not null;
  if v_int <> 1 then raise exception 'FAIL: T5 record_consent ไม่ตั้งเวลา'; end if;

  -- T6 anon ไม่มีสิทธิ์ใดๆ (ตารางและ RPC ทุกตัว)
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  r := pg_temp.fails($$ select count(*) from public.accounts $$);
  if r is null then raise exception 'FAIL: T6 anon อ่าน accounts ได้'; end if;
  r := pg_temp.fails($$ select count(*) from public.profiles $$);
  if r is null then raise exception 'FAIL: T6 anon อ่าน profiles ได้'; end if;
  r := pg_temp.fails($$ select public.create_entry('{}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก create_entry ได้'; end if;
  r := pg_temp.fails($$ select public.update_entry('{}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก update_entry ได้'; end if;
  r := pg_temp.fails($$ select public.setup_ledger('[]'::jsonb, '[]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก setup_ledger ได้'; end if;
  r := pg_temp.fails($$ select public.record_consent() $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก record_consent ได้'; end if;
  r := pg_temp.fails($$ select public.delete_my_account('x') $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก delete_my_account ได้'; end if;
  execute 'reset role';

  -- ---------- ผู้ใช้ A ตั้งค่าบัญชีและใช้งาน ----------
  perform pg_temp.login(ua);

  -- T7 setup_ledger พร้อมยอดยกมา (source system) สมดุล
  perform public.setup_ledger(acc, jsonb_build_array(jsonb_build_object(
    'id','e-open','date','2026-11-01','memo','ยอดยกมา','source','system',
    'lines', jsonb_build_array(jsonb_build_object('accountId','w1','amount',100000), jsonb_build_object('accountId','open','amount',-100000)))));
  perform pg_temp.settle();
  select count(*) into v_int from public.accounts;
  if v_int <> 7 then raise exception 'FAIL: T7 setup_ledger จำนวนบัญชี (%)', v_int; end if;
  r := pg_temp.fails($$ select public.setup_ledger('[]'::jsonb, '[]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T7 setup_ledger ซ้ำได้'; end if;

  -- T8 เพิ่มรายการปกติ (รายจ่าย)
  perform public.create_entry('{"id":"e1","date":"2026-11-02","memo":"ข้าว","source":"manual","lines":[{"accountId":"food","amount":6500},{"accountId":"w1","amount":-6500}]}'::jsonb);
  perform pg_temp.settle();

  -- T9 R16: ไม่สมดุล / บรรทัดเดียว / ยอด 0 / ทศนิยม / เกินช่วง / ข้ามสกุลเงินไม่มีบัญชีพัก / วันที่ไม่มีจริง / บัญชีไม่มี
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad1","date":"2026-11-02","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-99}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9a รายการไม่สมดุลผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad2","date":"2026-11-02","lines":[{"accountId":"food","amount":100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9b บรรทัดเดียวผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad3","date":"2026-11-02","lines":[{"accountId":"food","amount":0},{"accountId":"w1","amount":0}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9c ยอด 0 ผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad4","date":"2026-11-02","lines":[{"accountId":"food","amount":1.5},{"accountId":"w1","amount":-1.5}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9d ทศนิยมผ่าน'; end if;
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"bad5","date":"2026-11-02","lines":[{"accountId":"food","amount":%s},{"accountId":"w1","amount":-%s}]}'::jsonb) $$, maxi + 1, maxi + 1));
  if r is null then raise exception 'FAIL: T9e ยอดเกิน 2^53-1 ผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad6","date":"2026-11-02","lines":[{"accountId":"usd","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9f ข้ามสกุลเงินโดยไม่มีบัญชีพักผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad7","date":"2026-02-31","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9g วันที่ไม่มีจริงผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad8","date":"2026-11-02","lines":[{"accountId":"nope","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9h บัญชีไม่มีอยู่ผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"bad9","date":"2026-11-02","lines":[{"accountId":"food","amount":0},{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T9i บรรทัดยอด 0 ปนกับบรรทัดปกติผ่าน'; end if;

  -- T10 ขอบ: ยอด 2^53-1 หักกลบ ผ่าน · ±1 สตางค์ผ่าน · ข้ามสกุลเงินผ่านบัญชีพักผ่าน · ผลรวมฝั่งเดบิตเกินช่วงถูกปฏิเสธ
  perform public.create_entry(format('{"id":"edge1","date":"2026-11-02","lines":[{"accountId":"food","amount":%s},{"accountId":"w1","amount":-%s}]}', maxi, maxi)::jsonb);
  perform public.create_entry('{"id":"one","date":"2026-11-02","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb);
  perform public.create_entry('{"id":"fx2","date":"2026-11-02","lines":[{"accountId":"w1","amount":-3500},{"accountId":"open","amount":3500},{"accountId":"usd","amount":100},{"accountId":"fx","amount":-100}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"big","date":"2026-11-02","lines":[{"accountId":"food","amount":%s},{"accountId":"w1","amount":-%s},{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$, maxi, maxi));
  if r is null then raise exception 'FAIL: T10 ผลรวมฝั่งเดบิตเกิน 2^53-1 (หักกลบข้ามบรรทัด) ผ่าน'; end if;

  -- T10b วันที่ขอบ: ปีอธิกสุรทิน ปลายช่วง ปีไม่อธิกสุรทิน
  perform public.create_entry('{"id":"leap","date":"2028-02-29","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb);
  perform public.create_entry('{"id":"d1900","date":"1900-01-01","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb);
  perform public.create_entry('{"id":"d2999","date":"2999-12-31","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($$ select public.create_entry('{"id":"nl","date":"2027-02-29","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T10b 29 ก.พ. ปีไม่อธิกสุรทินผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"d3000","date":"3000-01-01","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T10b วันที่เกินช่วง 2999 ผ่าน'; end if;

  -- T10c ข้อจำกัดของฟิลด์
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('c1','asset','x','thb') $$);
  if r is null then raise exception 'FAIL: T10c currency ตัวพิมพ์เล็กผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('c2','bogus','x','THB') $$);
  if r is null then raise exception 'FAIL: T10c ชนิดบัญชีแปลกผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('','asset','x','THB') $$);
  if r is null then raise exception 'FAIL: T10c id ว่างผ่าน'; end if;
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"longmemo","date":"2026-11-02","memo":"%s","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$, repeat('x', 2001)));
  if r is null then raise exception 'FAIL: T10c memo ยาวเกิน 2000 ผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"badcycle","date":"2026-11-02","source":"recurring","bill":{"id":"b","cycle":"2026-13"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T10c รอบบิล 2026-13 ผ่าน'; end if;

  -- T10d รายการ system สร้างได้เฉพาะใน setup_ledger (ผ่าน RPC และการเขียนตรง)
  r := pg_temp.fails($$ select public.create_entry('{"id":"sys2","date":"2026-11-01","source":"system","lines":[{"accountId":"w1","amount":5},{"accountId":"open","amount":-5}]}'::jsonb) $$);
  if r is null or r not like '%สร้างได้เฉพาะตอนตั้งค่าเริ่มต้น%' then raise exception 'FAIL: T10d create_entry source system ไม่ถูกปฏิเสธด้วยเหตุผลที่ถูก (%)', r; end if;
  r := pg_temp.fails($$ insert into public.entries (id, date, source) values ('sys3','2026-11-01','system') $$);
  if r is null or r not like '%สร้างได้เฉพาะตอนตั้งค่าเริ่มต้น%' then raise exception 'FAIL: T10d insert source system ตรงๆ ไม่ถูกปฏิเสธด้วยเหตุผลที่ถูก (%)', r; end if;

  -- T11 แก้ไขรายการ: สำเร็จ · ทำให้ไม่สมดุลแล้วต้องไม่เปลี่ยนอะไร
  perform public.update_entry('{"id":"e1","date":"2026-11-03","memo":"ข้าวมันไก่","lines":[{"accountId":"food","amount":7000},{"accountId":"w1","amount":-7000}]}'::jsonb);
  perform pg_temp.settle();
  select count(*) into v_int from public.entries where id = 'e1' and memo = 'ข้าวมันไก่';
  if v_int <> 1 then raise exception 'FAIL: T11 update_entry ไม่เปลี่ยน memo'; end if;
  r := pg_temp.fails($$ select public.update_entry('{"id":"e1","date":"2026-11-03","memo":"x","lines":[{"accountId":"food","amount":7000},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T11 update_entry ไม่สมดุลผ่าน'; end if;
  select count(*) into v_int from public.entries where id = 'e1' and memo = 'ข้าวมันไก่';
  if v_int <> 1 then raise exception 'FAIL: T11 update ไม่สมดุลแล้วข้อมูลเปลี่ยน'; end if;

  -- T12 รายการ system (ยอดยกมา): แก้/ลบ/เพิ่มบรรทัด/ย้ายบรรทัด/เปลี่ยน source ตรงๆ ไม่ได้
  r := pg_temp.fails($$ select public.update_entry('{"id":"e-open","date":"2026-11-01","lines":[{"accountId":"w1","amount":5},{"accountId":"open","amount":-5}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T12a แก้ system ผ่าน'; end if;
  r := pg_temp.fails($$ delete from public.entries where id = 'e-open' $$);
  if r is null then raise exception 'FAIL: T12b ลบ system ผ่าน'; end if;
  r := pg_temp.fails($$ update public.lines set amount = amount + 1 where entry_id = 'e-open' and idx = 1 $$);
  if r is null then raise exception 'FAIL: T12c แก้บรรทัด system ตรงๆ ผ่าน'; end if;
  r := pg_temp.fails($$ update public.entries set source = 'manual' where id = 'e-open' $$);
  if r is null then raise exception 'FAIL: T12d เปลี่ยน source ของ system ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.lines (entry_id, idx, account_id, amount) values ('e-open', 3, 'food', 500) $$);
  if r is null then raise exception 'FAIL: T12e เพิ่มบรรทัดเข้า system ตรงๆ ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.lines (entry_id, idx, account_id, amount) values ('e-open', 3, 'food', 500), ('e-open', 4, 'w1', -500) $$);
  if r is null then raise exception 'FAIL: T12f เพิ่มบรรทัดคู่สมดุลเข้า system ตรงๆ ผ่าน'; end if;
  r := pg_temp.fails($$ update public.lines set entry_id = 'e-open', idx = 9 where entry_id = 'e1' and idx = 1 $$);
  if r is null then raise exception 'FAIL: T12g ย้ายบรรทัดเข้า system ผ่าน'; end if;
  select count(*) into v_int from public.lines where entry_id = 'e-open';
  if v_int <> 2 then raise exception 'FAIL: T12 จำนวนบรรทัดของยอดยกมาเปลี่ยน (%)', v_int; end if;

  -- T13 R15 บิล: lastPaidMonth เกินเดือนปัจจุบัน / ฟิลด์ผิดรูป ไม่ได้
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('bx','x',100,5,'2999-01') $$);
  if r is null then raise exception 'FAIL: T13a last_paid_month อนาคตผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day) values ('bx','x',100,0) $$);
  if r is null then raise exception 'FAIL: T13b due_day 0 ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day) values ('bx','x',100,32) $$);
  if r is null then raise exception 'FAIL: T13b due_day 32 ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day) values ('bx','x',0,5) $$);
  if r is null then raise exception 'FAIL: T13c amount 0 ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day) values ('bx','x',-5,5) $$);
  if r is null then raise exception 'FAIL: T13c amount ติดลบผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, start_month) values ('bx','x',100,5,'2026-00') $$);
  if r is null then raise exception 'FAIL: T13d start_month 2026-00 ผ่าน'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, wallet_id) values ('bx','x',100,5,'ghost') $$);
  if r is null then raise exception 'FAIL: T13e wallet_id ที่ไม่มีบัญชีผ่าน'; end if;
  insert into public.bills (id, name, amount, due_day, wallet_id, category_id, start_month)
  values ('bill1','ค่าเน็ต',59900,5,'w1','food',private.current_month());

  -- T14 จ่ายบิล: ผูกบิล+รอบ -> ตั้ง lastPaidMonth ให้ในธุรกรรมเดียว
  perform public.create_entry(format('{"id":"pay1","date":"2026-11-04","memo":"ค่าเน็ต","source":"recurring","bill":{"id":"bill1","cycle":"%s"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}', private.current_month())::jsonb);
  perform pg_temp.settle();
  select last_paid_month into v_text from public.bills where id = 'bill1';
  if v_text is distinct from private.current_month() then raise exception 'FAIL: T14 จ่ายบิลแล้ว lastPaidMonth ไม่ถูกตั้ง (%)', v_text; end if;

  -- T15 จ่ายซ้ำ / before ไม่ตรง / ล่วงหน้า / บิลไม่มี / bill กับ source ไม่ใช่ recurring
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"pay2","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"%s","before":"2020-01"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$, private.current_month()));
  if r is null then raise exception 'FAIL: T15a before ไม่ตรงผ่าน'; end if;
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"pay3","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"2999-12","before":"%s"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$, private.current_month()));
  if r is null then raise exception 'FAIL: T15b จ่ายล่วงหน้าผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay4","date":"2026-11-04","source":"recurring","bill":{"id":"ghost","cycle":"2026-01"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T15c บิลไม่มีอยู่ผ่าน'; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay5","date":"2026-11-04","source":"manual","bill":{"id":"bill1","cycle":"2026-01"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T15d bill กับ source manual ผ่าน'; end if;

  -- T16 รายการจ่ายบิลแก้ไม่ได้ · ลบ = ยกเลิกการจ่าย คืน lastPaidMonth ในธุรกรรมเดียว
  r := pg_temp.fails($$ select public.update_entry('{"id":"pay1","date":"2026-11-04","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T16a แก้รายการจ่ายบิลผ่าน'; end if;
  delete from public.entries where id = 'pay1';
  perform pg_temp.settle();
  select last_paid_month into v_text from public.bills where id = 'bill1';
  if v_text is not null then raise exception 'FAIL: T16b ยกเลิกการจ่ายแล้ว lastPaidMonth ไม่ถูกคืน (%)', v_text; end if;

  -- T17 ยกเลิกได้เฉพาะรอบล่าสุด
  update public.bills set start_month = '2026-09' where id = 'bill1';
  perform public.create_entry('{"id":"payA","date":"2026-09-05","source":"recurring","bill":{"id":"bill1","cycle":"2026-09"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb);
  perform public.create_entry('{"id":"payB","date":"2026-10-05","source":"recurring","bill":{"id":"bill1","cycle":"2026-10","before":"2026-09"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($$ delete from public.entries where id = 'payA' $$);
  if r is null then raise exception 'FAIL: T17a ยกเลิกรอบเก่า (ไม่ใช่รอบล่าสุด) ผ่าน'; end if;
  delete from public.entries where id = 'payB';
  perform pg_temp.settle();
  select last_paid_month into v_text from public.bills where id = 'bill1';
  if v_text is distinct from '2026-09' then raise exception 'FAIL: T17b คืนค่าเป็น before ไม่ถูก (%)', v_text; end if;

  -- T17c จ่ายซ้ำรอบเดียวกันไม่ได้แม้ถอย lastPaidMonth ผ่านการเขียนตรง (unique index)
  update public.bills set last_paid_month = null where id = 'bill1';
  r := pg_temp.fails($$ select public.create_entry('{"id":"payA2","date":"2026-09-06","source":"recurring","bill":{"id":"bill1","cycle":"2026-09"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T17c จ่ายรอบเดิมซ้ำหลังถอย last_paid_month ผ่าน'; end if;
  update public.bills set last_paid_month = '2026-09' where id = 'bill1';

  -- T18 TRUNCATE ไม่มีสิทธิ์
  r := pg_temp.fails($$ truncate public.entries $$);
  if r is null then raise exception 'FAIL: T18 authenticated TRUNCATE ได้'; end if;

  -- T19 เปลี่ยนสกุลเงินของบัญชีที่มีรายการแล้วไม่ได้ · ลบบัญชีที่มีรายการไม่ได้
  r := pg_temp.fails($$ update public.accounts set currency = 'USD' where id = 'w1' $$);
  if r is null then raise exception 'FAIL: T19a เปลี่ยนสกุลเงินบัญชีที่มีรายการผ่าน'; end if;
  r := pg_temp.fails($$ delete from public.accounts where id = 'w1' $$);
  if r is null then raise exception 'FAIL: T19b ลบบัญชีที่มีรายการผ่าน'; end if;

  -- T20 settings: ต้องเป็นอ็อบเจ็กต์
  r := pg_temp.fails($$ insert into public.settings (value) values ('[1]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T20 settings ที่ไม่ใช่อ็อบเจ็กต์ผ่าน'; end if;
  insert into public.settings (value) values ('{"payDay":25}'::jsonb);
  perform pg_temp.logout();

  -- T21 session ที่ถูกเพิกถอน (เช่น หลัง reset รหัส/logout) ใช้ token เดิมอ่านและเขียนไม่ได้ทันที
  delete from auth.sessions where user_id = ua;
  perform pg_temp.login_existing(ua);
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T21 session ที่ถูกเพิกถอนยังอ่านข้อมูลได้ (%)', v_int; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"late","date":"2026-11-02","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T21 session ที่ถูกเพิกถอนยังเขียนได้'; end if;
  perform pg_temp.logout();

  -- T22 ผู้ใช้ anonymous ใช้ข้อมูลไม่ได้
  perform pg_temp.login(ua, true);
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T22 anonymous อ่านข้อมูลได้ (%)', v_int; end if;
  perform pg_temp.logout();
  perform pg_temp.login(ua);
  select count(*) into v_int from public.accounts;
  if v_int <> 7 then raise exception 'FAIL: T22 ล็อกอินใหม่แล้วอ่านข้อมูลไม่ได้ (%)', v_int; end if;
  perform pg_temp.logout();

  -- T22b session ที่หมดอายุ (not_after) ใช้ไม่ได้
  update auth.sessions set not_after = now() - interval '1 minute' where user_id = ua;
  perform pg_temp.login_existing(ua);
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T22b session ที่หมดอายุยังอ่านข้อมูลได้ (%)', v_int; end if;
  perform pg_temp.logout();
  update auth.sessions set not_after = null where user_id = ua;

  -- T23 ผู้ใช้ B ต้องมองไม่เห็นและแตะข้อมูลของ A ไม่ได้
  perform pg_temp.login(ub);
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T23 B เห็นบัญชีของ A (%)', v_int; end if;
  select count(*) into v_int from public.entries;
  if v_int <> 0 then raise exception 'FAIL: T23 B เห็นรายการของ A (%)', v_int; end if;
  select count(*) into v_int from public.lines;
  if v_int <> 0 then raise exception 'FAIL: T23 B เห็นบรรทัดของ A (%)', v_int; end if;
  select count(*) into v_int from public.bills;
  if v_int <> 0 then raise exception 'FAIL: T23 B เห็นบิลของ A (%)', v_int; end if;
  select count(*) into v_int from public.settings;
  if v_int <> 0 then raise exception 'FAIL: T23 B เห็น settings ของ A (%)', v_int; end if;
  select count(*) into v_int from public.profiles;
  if v_int <> 1 then raise exception 'FAIL: T23 B เห็น profiles ของคนอื่น (%)', v_int; end if;
  r := pg_temp.fails($$ select public.create_entry('{"id":"steal","date":"2026-11-02","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T23 B สร้างรายการอ้างบัญชีของ A ได้'; end if;
  r := pg_temp.fails($$ select public.update_entry('{"id":"e1","date":"2026-11-03","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T23 B แก้รายการของ A ได้'; end if;
  delete from public.entries where id = 'e1';
  get diagnostics v_int = row_count;
  if v_int <> 0 then raise exception 'FAIL: T23 B ลบรายการของ A ได้'; end if;
  r := pg_temp.fails(format($$ insert into public.accounts (user_id, id, type, name, currency) values ('%s','zz','asset','zz','THB') $$, ua));
  if r is null then raise exception 'FAIL: T23 B เขียนข้อมูลในชื่อ A ได้'; end if;

  -- T24 delete_my_account: ผิด 5 ครั้งคืน false แล้วถูกล็อก (แม้ใส่รหัสถูก) · ข้อมูลของ B ยังอยู่
  -- T24-0 เรียกแบบอ่านอย่างเดียว (เช่น GET) ถูกปฏิเสธ ไม่ให้เดารหัสโดยตัวนับไม่ขยับ
  r := pg_temp.fails($$ select set_config('transaction_read_only', 'on', true), public.delete_my_account('wrong-password') $$);
  if r is null or r not like '%เขียนได้%' then raise exception 'FAIL: T24-0 เรียกแบบอ่านอย่างเดียวไม่ถูกปฏิเสธด้วยเหตุผลที่ถูก (%)', r; end if;
  for v_int in 1..5 loop
    select public.delete_my_account('wrong-password') into v_bool;
    if v_bool is distinct from false then raise exception 'FAIL: T24a รหัสผิดต้องคืน false (ครั้งที่ %)', v_int; end if;
  end loop;
  r := pg_temp.fails($$ select public.delete_my_account('new-password-2') $$);
  if r is null then raise exception 'FAIL: T24b ผิด 5 ครั้งแล้วยังลบได้ (ไม่ล็อก)'; end if;
  perform pg_temp.logout();
  select count(*) into v_int from auth.users where id = ub;
  if v_int <> 1 then raise exception 'FAIL: T24c บัญชี B ถูกลบ'; end if;

  -- T25 ลบบัญชี A ด้วยรหัสถูก: คืน true ผู้ใช้และข้อมูลทุกตารางหมด (รวมรายการ system/recurring)
  perform pg_temp.login(ua);
  select public.delete_my_account('wrong-password') into v_bool;
  if v_bool is distinct from false then raise exception 'FAIL: T25a รหัสผิดต้องคืน false'; end if;
  select public.delete_my_account('new-password-1') into v_bool;
  if v_bool is distinct from true then raise exception 'FAIL: T25b รหัสถูกต้องคืน true'; end if;
  perform pg_temp.settle();
  perform pg_temp.logout();
  select (select count(*) from public.accounts where user_id = ua)
       + (select count(*) from public.entries where user_id = ua)
       + (select count(*) from public.lines where user_id = ua)
       + (select count(*) from public.bills where user_id = ua)
       + (select count(*) from public.settings where user_id = ua)
       + (select count(*) from public.profiles where user_id = ua)
       + (select count(*) from auth.users where id = ua) into v_int;
  if v_int <> 0 then raise exception 'FAIL: T25c ลบบัญชีแล้วข้อมูลยังเหลือ (%)', v_int; end if;

  -- T26 เจ้าของลบผู้ใช้ผ่าน Dashboard/Admin API (role postgres ตรงๆ ไม่ผ่าน RPC) ได้แม้มีรายการ system/recurring
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (uc, 'c-test@users.money-buddy.internal', extensions.crypt('pw-c-12345', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('pw-c-new-12345', extensions.gen_salt('bf')) where id = uc;
  perform pg_temp.login(uc);
  perform public.setup_ledger(acc, jsonb_build_array(jsonb_build_object(
    'id','c-open','date','2026-11-01','source','system',
    'lines', jsonb_build_array(jsonb_build_object('accountId','w1','amount',500), jsonb_build_object('accountId','open','amount',-500)))));
  insert into public.bills (id, name, amount, due_day) values ('cb','x',100,5);
  perform public.create_entry(format('{"id":"c-pay","date":"2026-11-04","source":"recurring","bill":{"id":"cb","cycle":"%s"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}', private.current_month())::jsonb);
  perform pg_temp.settle();
  perform pg_temp.logout();
  delete from auth.users where id = uc;
  perform pg_temp.settle();
  select (select count(*) from public.accounts where user_id = uc)
       + (select count(*) from public.entries where user_id = uc)
       + (select count(*) from public.lines where user_id = uc)
       + (select count(*) from public.bills where user_id = uc)
       + (select count(*) from public.profiles where user_id = uc) into v_int;
  if v_int <> 0 then raise exception 'FAIL: T26 เจ้าของลบผู้ใช้ (role postgres) แล้วข้อมูลยังเหลือ (%)', v_int; end if;

  -- T27 ผู้ใช้ B ที่ยังต้องเปลี่ยนรหัส ลบบัญชีด้วย RPC ไม่ได้
  update public.profiles set must_change_password = true where user_id = ub;
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ select public.delete_my_account('new-password-2') $$);
  if r is null then raise exception 'FAIL: T27 ลบบัญชีทั้งที่ยังไม่เปลี่ยนรหัสผ่าน'; end if;
  perform pg_temp.logout();

  -- T28 สิทธิ์ในแคตตาล็อก: ทุกตารางใน public เปิด RLS · anon ไม่มีสิทธิ์ตาราง/ฟังก์ชันใดใน public, private · authenticated ไม่มี TRUNCATE
  select count(*) into v_int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_int <> 0 then raise exception 'FAIL: T28a มีตารางใน public ที่ไม่เปิด RLS (%)', v_int; end if;
  select count(*) into v_int from information_schema.role_table_grants
   where grantee in ('anon', 'PUBLIC') and table_schema in ('public', 'private');
  if v_int <> 0 then raise exception 'FAIL: T28b anon/PUBLIC มีสิทธิ์ตาราง (%)', v_int; end if;
  select count(*) into v_int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute');
  if v_int <> 0 then raise exception 'FAIL: T28c anon เรียกฟังก์ชันได้ (%)', v_int; end if;
  select count(*) into v_int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege('authenticated', c.oid, 'TRUNCATE');
  if v_int <> 0 then raise exception 'FAIL: T28d authenticated มีสิทธิ์ TRUNCATE (%)', v_int; end if;
  select count(*) into v_int from pg_publication_tables where schemaname in ('public', 'private');
  if v_int <> 0 then raise exception 'FAIL: T28e มีตารางเปิด Realtime (publication) (%)', v_int; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$test$;
