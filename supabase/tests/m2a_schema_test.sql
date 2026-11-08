-- ทดสอบ M2-A (RLS, สมดุลบัญชีคู่, R15, ธงเปลี่ยนรหัส, ลบบัญชี)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration แล้ว
-- ไฟล์นี้ไม่ทิ้งข้อมูลใดไว้: สร้างผู้ใช้ทดสอบในธุรกรรมเดียว แล้วจบด้วย raise exception เพื่อ rollback ทั้งหมด
--   ผ่านทั้งหมด -> ข้อความ error ขึ้นต้นด้วย  TESTS_PASSED
--   ไม่ผ่าน     -> ข้อความ error ขึ้นต้นด้วย  FAIL:  แล้วตามด้วยชื่อข้อทดสอบ
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.settle() returns void
language plpgsql as $
begin
  -- constraint trigger ของ M2-A เป็นแบบ deferred (ตรวจตอน commit) แต่ธุรกรรมทดสอบไม่เคย commit
  -- จึงสั่งให้ตรวจทันที แล้วกลับเป็น deferred เหมือนเดิม
  execute 'set constraints all immediate';
  execute 'set constraints all deferred';
end
$;

create function pg_temp.fails(p_sql text) returns text
language plpgsql as $
begin
  execute p_sql;
  perform pg_temp.settle();
  return null;                       -- ไม่ error = ข้อทดสอบ "ควร error" ไม่ผ่าน
exception when others then
  return sqlerrm;
end
$;

create function pg_temp.login(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

do $test$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  n integer := 0;
  r text;
  v_int integer;
  v_text text;
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
  -- ---------- เตรียมผู้ใช้ A, B (สร้างผ่านตาราง auth.users โดยตรง ใน rollback) ----------
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-test@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-test@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- T1 trigger สร้าง profiles อัตโนมัติ และธงเป็น true
  select count(*) into v_int from public.profiles where user_id in (ua, ub) and must_change_password;
  if v_int <> 2 then raise exception 'FAIL: T1 profiles ไม่ถูกสร้าง/ธงไม่เป็น true (%)', v_int; end if;

  -- T2 ยังไม่เปลี่ยนรหัส: อ่าน/เขียนตารางข้อมูลไม่ได้ (restrictive policy)
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('x','asset','x','THB') $$);
  if r is null then raise exception 'FAIL: T2 เขียนข้อมูลได้ทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T2 อ่านข้อมูลได้ทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  r := pg_temp.fails($$ select public.setup_ledger('[]'::jsonb, '[]'::jsonb) $$);
  if r is null then raise exception 'FAIL: T2 setup_ledger ผ่านทั้งที่ยังไม่เปลี่ยนรหัส'; end if;
  perform pg_temp.logout();

  -- T3 ผู้ใช้ที่ไม่มีแถว profiles (เช่น ถูกสร้างก่อนมี trigger) เข้าไม่ได้ (ปิดไว้ก่อน)
  delete from public.profiles where user_id = ub;
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency) values ('x','asset','x','THB') $$);
  if r is null then raise exception 'FAIL: T3 ผู้ใช้ไม่มี profiles เขียนข้อมูลได้'; end if;
  perform pg_temp.logout();
  insert into public.profiles (user_id) values (ub);

  -- T4 เปลี่ยนรหัสจริง -> trigger เคลียร์ธง · อัปเดต hash เป็นค่าเดิมไม่เคลียร์
  update auth.users set encrypted_password = encrypted_password where id = ua;
  select must_change_password into v_text from public.profiles where user_id = ua;
  if v_text::boolean is not true then raise exception 'FAIL: T4 ธงถูกเคลียร์ทั้งที่รหัสไม่เปลี่ยน'; end if;
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  select count(*) into v_int from public.profiles where user_id in (ua, ub) and not must_change_password and password_changed_at is not null;
  if v_int <> 2 then raise exception 'FAIL: T4 ธงไม่ถูกเคลียร์หลังเปลี่ยนรหัส'; end if;

  -- T5 ผู้ใช้เขียน profiles เองไม่ได้ (เคลียร์ธง/แก้วันยินยอมเอง)
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ update public.profiles set must_change_password = false $$);
  if r is null then raise exception 'FAIL: T5 ผู้ใช้แก้ profiles เองได้'; end if;
  perform public.record_consent();
  perform pg_temp.logout();
  select count(*) into v_int from public.profiles where user_id = ua and consented_at is not null;
  if v_int <> 1 then raise exception 'FAIL: T5 record_consent ไม่ตั้งเวลา'; end if;

  -- T6 anon ไม่มีสิทธิ์ใดๆ
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  r := pg_temp.fails($$ select count(*) from public.accounts $$);
  if r is null then raise exception 'FAIL: T6 anon อ่าน accounts ได้'; end if;
  r := pg_temp.fails($$ select public.create_entry('{}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 anon เรียก create_entry ได้'; end if;
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

  -- T8 เพิ่มรายการปกติ (รายจ่าย) สำเร็จ
  perform public.create_entry('{"id":"e1","date":"2026-11-02","memo":"ข้าว","source":"manual","lines":[{"accountId":"food","amount":6500},{"accountId":"w1","amount":-6500}]}'::jsonb);

  -- T9 R16: ไม่สมดุล / บรรทัดเดียว / ยอด 0 / ไม่ใช่จำนวนเต็ม / ยอดเกินช่วงปลอดภัย / ข้ามสกุลเงินไม่มีบัญชีพัก
  perform pg_temp.settle();
  r := pg_temp.fails($ select public.create_entry('{"id":"bad1","date":"2026-11-02","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-99}]}'::jsonb) $$);
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

  -- T10 ขอบ: ยอดเท่า 2^53-1 (หักกลบทันที) ผ่าน · ข้ามสกุลเงินผ่านบัญชีพักผ่าน
  perform public.create_entry(format('{"id":"edge1","date":"2026-11-02","lines":[{"accountId":"food","amount":%s},{"accountId":"w1","amount":-%s}]}', maxi, maxi)::jsonb);
  -- ข้ามสกุลเงิน: ต้องมีบัญชีพัก (equity) ฝั่งละสกุลเงิน ผลรวมต่อสกุลเงิน = 0
  perform public.create_entry('{"id":"fx2","date":"2026-11-02","lines":[{"accountId":"w1","amount":-3500},{"accountId":"open","amount":3500},{"accountId":"usd","amount":100},{"accountId":"fx","amount":-100}]}'::jsonb);

  -- T11 แก้ไขรายการ: สำเร็จ · ทำให้ไม่สมดุลแล้วต้องไม่เปลี่ยนอะไร
  perform pg_temp.settle();
  perform public.update_entry('{"id":"e1","date":"2026-11-03","memo":"ข้าวมันไก่","lines":[{"accountId":"food","amount":7000},{"accountId":"w1","amount":-7000}]}'::jsonb);
  perform pg_temp.settle();
  select count(*) into v_int from public.entries where id = 'e1' and memo = 'ข้าวมันไก่';
  if v_int <> 1 then raise exception 'FAIL: T11 update_entry ไม่เปลี่ยน memo'; end if;
  r := pg_temp.fails($$ select public.update_entry('{"id":"e1","date":"2026-11-03","memo":"x","lines":[{"accountId":"food","amount":7000},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T11 update_entry ไม่สมดุลผ่าน'; end if;
  select count(*) into v_int from public.entries where id = 'e1' and memo = 'ข้าวมันไก่';
  if v_int <> 1 then raise exception 'FAIL: T11 update ไม่สมดุลแล้วข้อมูลเปลี่ยน'; end if;

  -- T12 รายการ system (ยอดยกมา): แก้/ลบ/แก้บรรทัดตรงไม่ได้
  r := pg_temp.fails($$ select public.update_entry('{"id":"e-open","date":"2026-11-01","lines":[{"accountId":"w1","amount":5},{"accountId":"open","amount":-5}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T12a แก้ system ผ่าน'; end if;
  r := pg_temp.fails($$ delete from public.entries where id = 'e-open' $$);
  if r is null then raise exception 'FAIL: T12b ลบ system ผ่าน'; end if;
  r := pg_temp.fails($$ update public.lines set amount = amount + 1 where entry_id = 'e-open' and idx = 1 $$);
  if r is null then raise exception 'FAIL: T12c แก้บรรทัด system ตรงๆ ผ่าน'; end if;
  r := pg_temp.fails($$ update public.entries set source = 'manual' where id = 'e-open' $$);
  if r is null then raise exception 'FAIL: T12d เปลี่ยน source ของ system ผ่าน'; end if;

  -- T13 R15 บิล: lastPaidMonth เกินเดือนปัจจุบันไม่ได้
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('bx','x',100,5,'2999-01') $$);
  if r is null then raise exception 'FAIL: T13a last_paid_month อนาคตผ่าน'; end if;
  insert into public.bills (id, name, amount, due_day, wallet_id, category_id, start_month)
  values ('bill1','ค่าเน็ต',59900,5,'w1','food',private.current_month());

  -- T14 จ่ายบิล: ผูกบิล+รอบ → ตั้ง lastPaidMonth ให้ในธุรกรรมเดียว
  perform public.create_entry(format('{"id":"pay1","date":"2026-11-04","memo":"ค่าเน็ต","source":"recurring","bill":{"id":"bill1","cycle":"%s"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}', private.current_month())::jsonb);
  perform pg_temp.settle();
  select last_paid_month into v_text from public.bills where id = 'bill1';
  if v_text is distinct from private.current_month() then raise exception 'FAIL: T14 จ่ายบิลแล้ว lastPaidMonth ไม่ถูกตั้ง (%)', v_text; end if;

  -- T15 จ่ายซ้ำรอบเดิม / จ่ายล่วงหน้า / before ไม่ตรง / บิลไม่มี / bill กับ source ไม่ใช่ recurring
  r := pg_temp.fails(format($$ select public.create_entry('{"id":"pay2","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"%s","before":"2020-01"},"lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$, private.current_month()));
  if r is null then raise exception 'FAIL: T15a จ่ายซ้ำรอบเดิม/before ไม่ตรงผ่าน'; end if;
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

  -- T17 ยกเลิกได้เฉพาะรอบล่าสุด: จ่าย 2 รอบ แล้วลบรอบเก่าต้องไม่ได้
  update public.bills set start_month = '2026-09' where id = 'bill1';
  perform public.create_entry('{"id":"payA","date":"2026-09-05","source":"recurring","bill":{"id":"bill1","cycle":"2026-09"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb);
  perform public.create_entry('{"id":"payB","date":"2026-10-05","source":"recurring","bill":{"id":"bill1","cycle":"2026-10","before":"2026-09"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($ delete from public.entries where id = 'payA' $);
  if r is null then raise exception 'FAIL: T17a ยกเลิกรอบเก่า (ไม่ใช่รอบล่าสุด) ผ่าน'; end if;
  delete from public.entries where id = 'payB';
  perform pg_temp.settle();
  select last_paid_month into v_text from public.bills where id = 'bill1';
  if v_text is distinct from '2026-09' then raise exception 'FAIL: T17b คืนค่าเป็น before ไม่ถูก (%)', v_text; end if;

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

  -- ---------- ผู้ใช้ B ต้องมองไม่เห็นและแตะข้อมูลของ A ไม่ได้ ----------
  perform pg_temp.login(ub);
  select count(*) into v_int from public.accounts;
  if v_int <> 0 then raise exception 'FAIL: T21 B เห็นบัญชีของ A (%)', v_int; end if;
  select count(*) into v_int from public.entries;
  if v_int <> 0 then raise exception 'FAIL: T21 B เห็นรายการของ A (%)', v_int; end if;
  select count(*) into v_int from public.lines;
  if v_int <> 0 then raise exception 'FAIL: T21 B เห็นบรรทัดของ A (%)', v_int; end if;
  select count(*) into v_int from public.bills;
  if v_int <> 0 then raise exception 'FAIL: T21 B เห็นบิลของ A (%)', v_int; end if;
  select count(*) into v_int from public.settings;
  if v_int <> 0 then raise exception 'FAIL: T21 B เห็น settings ของ A (%)', v_int; end if;
  select count(*) into v_int from public.profiles;
  if v_int <> 1 then raise exception 'FAIL: T21 B เห็น profiles ของคนอื่น (%)', v_int; end if;
  -- B ไม่มีบัญชี w1 ของตัวเอง จึงอ้าง id ของ A ไม่ได้ (FK ผูก user_id)
  r := pg_temp.fails($$ select public.create_entry('{"id":"steal","date":"2026-11-02","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T22 B สร้างรายการอ้างบัญชีของ A ได้'; end if;
  -- B แก้/ลบของ A ด้วย id ตรงๆ ไม่ได้ (ไม่เจอแถว)
  r := pg_temp.fails($$ select public.update_entry('{"id":"e1","date":"2026-11-03","lines":[{"accountId":"food","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T22 B แก้รายการของ A ได้'; end if;
  delete from public.entries where id = 'e1';
  get diagnostics v_int = row_count;
  if v_int <> 0 then raise exception 'FAIL: T22 B ลบรายการของ A ได้'; end if;
  -- B ปลอม user_id เป็นของ A ตอนเขียน
  r := pg_temp.fails(format($$ insert into public.accounts (user_id, id, type, name, currency) values ('%s','zz','asset','zz','THB') $$, ua));
  if r is null then raise exception 'FAIL: T22 B เขียนข้อมูลในชื่อ A ได้'; end if;
  perform pg_temp.logout();

  -- T23 ลบบัญชี: รหัสผิดถูกปฏิเสธ · รหัสถูกลบผู้ใช้ + ข้อมูลทุกตาราง (รวม system/recurring) หมด
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.delete_my_account('wrong-password') $$);
  if r is null then raise exception 'FAIL: T23a ลบบัญชีด้วยรหัสผิดผ่าน'; end if;
  perform public.delete_my_account('new-password-1');
  perform pg_temp.settle();
  perform pg_temp.logout();
  select (select count(*) from public.accounts where user_id = ua)
       + (select count(*) from public.entries where user_id = ua)
       + (select count(*) from public.lines where user_id = ua)
       + (select count(*) from public.bills where user_id = ua)
       + (select count(*) from public.settings where user_id = ua)
       + (select count(*) from public.profiles where user_id = ua)
       + (select count(*) from auth.users where id = ua) into v_int;
  if v_int <> 0 then raise exception 'FAIL: T23b ลบบัญชีแล้วข้อมูลยังเหลือ (%)', v_int; end if;
  select count(*) into v_int from auth.users where id = ub;
  if v_int <> 1 then raise exception 'FAIL: T23c ลบบัญชี A กระทบ B'; end if;

  -- T24 ผู้ใช้ที่ยังต้องเปลี่ยนรหัส ลบบัญชีด้วย RPC ไม่ได้
  update public.profiles set must_change_password = true where user_id = ub;
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ select public.delete_my_account('new-password-2') $$);
  if r is null then raise exception 'FAIL: T24 ลบบัญชีทั้งที่ยังไม่เปลี่ยนรหัสผ่าน'; end if;
  perform pg_temp.logout();

  -- จบ: rollback ทุกอย่างด้วยการ raise
  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$test$;
