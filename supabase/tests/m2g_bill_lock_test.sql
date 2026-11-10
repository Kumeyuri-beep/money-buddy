-- ทดสอบ M2-G: bills.last_paid_month เปลี่ยนได้เฉพาะผ่านเส้นทางจ่าย/ยกเลิก/นำเข้า (R15 "ทุกเส้นทาง")
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108001100 , 20261108001200 และ 20261108001300 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน
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
  v_paid text;
  n integer;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":100000},{"accountId":"open","amount":-100000}]}]';
  pay jsonb := '{"id":"pay1","date":"2026-11-05","memo":"n","source":"recurring","bill":{"id":"b1","cycle":"2026-11"},"lines":[{"accountId":"food","amount":500},{"accountId":"w1","amount":-500}]}';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-bl@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-bl@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  insert into public.bills (id, name, amount, due_day) values ('b1', 'net', 500, 5);
  perform pg_temp.settle();

  -- T1 แก้ตรงๆ ผ่าน REST (UPDATE) ตั้งเป็น "จ่ายแล้ว" โดยไม่มีรายการจ่าย = ปฏิเสธ
  r := pg_temp.fails($$ update public.bills set last_paid_month = '2026-11' where id = 'b1' $$);
  if r is null or r not like '%ตรงๆ%' then raise exception 'FAIL: T1 ตั้ง lastPaidMonth ตรงๆ ได้ (%)', r; end if;

  -- T2 จ่ายผ่านรายการจ่าย (เส้นทางปกติ) ตั้งค่าได้
  perform public.create_entry(pay);
  perform pg_temp.settle();
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T2 จ่ายแล้ว lastPaidMonth ไม่ถูกตั้ง (%)', v_paid; end if;

  -- T3 ล้างค่า/ย้อนค่าตรงๆ เพื่อจ่ายซ้ำรอบเดิม = ปฏิเสธ
  r := pg_temp.fails($$ update public.bills set last_paid_month = null where id = 'b1' $$);
  if r is null or r not like '%ตรงๆ%' then raise exception 'FAIL: T3 ล้าง lastPaidMonth ตรงๆ ได้ หรือถูกปฏิเสธด้วยเหตุผลอื่น (%)', r; end if;
  r := pg_temp.fails($$ update public.bills set last_paid_month = '2026-10' where id = 'b1' $$);
  if r is null or r not like '%ตรงๆ%' then raise exception 'FAIL: T3 ย้อน lastPaidMonth ตรงๆ ได้ หรือถูกปฏิเสธด้วยเหตุผลอื่น (%)', r; end if;

  -- T3b upsert (insert ... on conflict do update) เป็นอีกทางหนึ่งของการ "แก้ตรงๆ": ต้องถูกปฏิเสธเหมือน UPDATE
  --   แถวที่เสนอ (last_paid_month = 2026-11) ผ่านด่าน insert เพราะมีรายการจ่ายรองรับ แต่ส่วน do update ที่ล้าง/ย้อนค่าต้องถูกปฏิเสธโดยด่าน update
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2026-11') on conflict (user_id, id) do update set last_paid_month = null $$);
  if r is null or r not like '%แก้ตรงๆ%' then raise exception 'FAIL: T3b upsert ล้าง lastPaidMonth ได้ หรือถูกปฏิเสธด้วยเหตุผลอื่น (%)', r; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2026-11') on conflict (user_id, id) do update set last_paid_month = '2026-10' $$);
  if r is null or r not like '%แก้ตรงๆ%' then raise exception 'FAIL: T3b upsert ย้อน lastPaidMonth ได้ หรือถูกปฏิเสธด้วยเหตุผลอื่น (%)', r; end if;
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T3b หลัง upsert ที่ถูกปฏิเสธ lastPaidMonth เปลี่ยน (%)', v_paid; end if;
  -- ...แต่ upsert ที่ do update แก้ช่องอื่น (ชื่อ) ต้องสำเร็จ และ lastPaidMonth คงเดิม (ด่าน insert ไม่ได้ปิดการ upsert ทั้งหมด)
  insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net-renamed', 500, 5, '2026-11')
    on conflict (user_id, id) do update set name = excluded.name;
  perform pg_temp.settle();
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T3b upsert แก้ชื่อแล้ว lastPaidMonth เปลี่ยน (%)', v_paid; end if;
  select name into r from public.bills where id = 'b1';
  if r is distinct from 'net-renamed' then raise exception 'FAIL: T3b upsert แก้ชื่อไม่สำเร็จ (%)', r; end if;

  -- T4 แก้ฟิลด์อื่นของบิลได้ตามปกติ · lastPaidMonth ไม่เปลี่ยน
  update public.bills set name = 'net2', amount = 600, archived = false where id = 'b1';
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T4 แก้ชื่อแล้ว lastPaidMonth เปลี่ยน'; end if;

  -- T5 จ่ายรอบเดิมซ้ำ = ปฏิเสธ (กฎเดิมยังทำงาน)
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay2","date":"2026-11-06","memo":"n","source":"recurring","bill":{"id":"b1","cycle":"2026-11","before":"2026-10"},"lines":[{"accountId":"food","amount":500},{"accountId":"w1","amount":-500}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T5 จ่ายรอบเดิมซ้ำได้'; end if;

  -- T6 เลิกทำการลบบิล: ลบบิลแล้วเพิ่มกลับพร้อม lastPaidMonth เดิม ผ่านเมื่อมีรายการจ่ายรองรับ
  delete from public.bills where id = 'b1';
  insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2026-11');
  perform pg_temp.settle();
  -- ...แต่รอบที่ไม่มีรายการรองรับ / บิลอื่นที่ไม่มีรายการ = ปฏิเสธ
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b9', 'x', 1, 1, '2026-11') $$);
  if r is null then raise exception 'FAIL: T6 เพิ่มบิลใหม่ที่อ้างว่าจ่ายแล้วโดยไม่มีรายการจ่ายได้'; end if;
  delete from public.bills where id = 'b1';
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2026-10') $$);
  if r is null then raise exception 'FAIL: T6 เพิ่มบิลกลับด้วยรอบที่ไม่มีรายการรองรับได้'; end if;
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2999-01') $$);
  if r is null then raise exception 'FAIL: T6 lastPaidMonth อนาคตผ่าน'; end if;
  -- ...เพิ่มกลับด้วยค่าว่างทั้งที่มีรายการจ่ายอยู่ = ปฏิเสธ (สถานะต้องตรงกับรายการจ่าย) · บิลใหม่เอี่ยมที่ไม่มีรายการจ่ายเลยเพิ่มได้ตามปกติ
  r := pg_temp.fails($$ insert into public.bills (id, name, amount, due_day) values ('b1', 'net', 500, 5) $$);
  if r is null or r not like '%ไม่ตรงกับรายการจ่าย%' then raise exception 'FAIL: T6 เพิ่มบิลกลับด้วยค่าว่างทั้งที่มีรายการจ่ายได้ (%)', r; end if;
  insert into public.bills (id, name, amount, due_day) values ('b-new', 'new', 1, 1);
  insert into public.bills (id, name, amount, due_day, last_paid_month) values ('b1', 'net', 500, 5, '2026-11');
  perform pg_temp.settle();
  -- ...และจ่ายรอบเดิมซ้ำหลังลบ/เพิ่มกลับ ยังถูกปฏิเสธ (ดัชนี entries_bill_cycle_once_idx)
  r := pg_temp.fails($$ select public.create_entry('{"id":"pay3","date":"2026-11-07","memo":"n","source":"recurring","bill":{"id":"b1","cycle":"2026-11","before":"2026-10"},"lines":[{"accountId":"food","amount":500},{"accountId":"w1","amount":-500}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T6 จ่ายรอบเดิมซ้ำได้หลังลบ/เพิ่มบิลกลับ'; end if;

  -- T6b เปลี่ยนรหัสบิลด้วย UPDATE (ให้บิลใหม่ 'จ่ายแล้ว' โดยรายการจ่ายยังชี้บิลเดิม) = ปฏิเสธ
  r := pg_temp.fails($$ update public.bills set id = 'b1-renamed' where id = 'b1' $$);
  if r is null or r not like '%เปลี่ยนรหัสบิล%' then raise exception 'FAIL: T6b เปลี่ยน id บิลได้ (%)', r; end if;

  -- T7 ยกเลิกการจ่าย (ลบรายการจ่าย) คืนค่าเป็นก่อนจ่ายได้ผ่านเส้นทางปกติ
  delete from public.entries where id = 'pay1';
  perform pg_temp.settle();
  select last_paid_month into v_paid from public.bills where id = 'b1';
  if v_paid is not null then raise exception 'FAIL: T7 ยกเลิกการจ่ายแล้ว lastPaidMonth ไม่คืน (%)', v_paid; end if;
  -- T7b หลังยกเลิกการจ่าย (entries_guard ครอบด้วย app.bill_paid_path) ตัวแปรต้องไม่ค้าง: ตั้งค่าตรงๆ ต้องยังถูกปฏิเสธ
  r := pg_temp.fails($$ update public.bills set last_paid_month = '2026-11' where id = 'b1' $$);
  if r is null or r not like '%ตรงๆ%' then raise exception 'FAIL: T7b หลังยกเลิกการจ่ายตั้ง lastPaidMonth ตรงๆ ได้ (ตัวแปรเส้นทางจ่ายค้าง) (%)', r; end if;
  -- A มีบิลรหัส 'ib' เหมือนของ B (ว่าง ไม่เคยจ่าย) ไว้ให้ T9 พิสูจน์ว่าคำสั่งผู้ดูแลกรอง user_id จริง
  insert into public.bills (id, name, amount, due_day) values ('ib', 'n', 5, 1);
  perform pg_temp.logout();

  -- T8 นำเข้า: บิลพก lastPaidMonth มาจากไฟล์ได้ (ผู้ใช้ B ว่าง)
  perform pg_temp.login(ub);
  perform public.import_ledger(('{"accounts":' || acc::text || ',"bills":[{"id":"ib","name":"n","amount":5,"dueDay":1,"lastPaidMonth":"2026-11"}],"entries":' || ent::text || '}')::jsonb);
  perform pg_temp.settle();
  select last_paid_month into v_paid from public.bills where id = 'ib';
  if v_paid is distinct from '2026-11' then raise exception 'FAIL: T8 นำเข้าแล้ว lastPaidMonth หาย (%)', v_paid; end if;
  -- ...และนำเข้าแล้ว ตัวแปรนำเข้าไม่ค้าง: แก้ตรงๆ ยังถูกปฏิเสธ
  r := pg_temp.fails($$ update public.bills set last_paid_month = null where id = 'ib' $$);
  if r is null then raise exception 'FAIL: T8 นำเข้าแล้วแก้ lastPaidMonth ตรงๆ ได้ (ตัวแปรนำเข้าค้าง)'; end if;
  perform pg_temp.logout();

  -- T9 บทบาทระบบซ่อมบำรุงได้
  execute 'set local role service_role';
  update public.bills set last_paid_month = '2026-10' where id = 'ib' and user_id = ub;
  get diagnostics n = row_count;
  execute 'reset role';
  if n <> 1 then raise exception 'FAIL: T9 คำสั่งผู้ดูแลต้องแก้ 1 แถว (ได้ %)', n; end if;
  select last_paid_month into v_paid from public.bills where id = 'ib' and user_id = ub;
  if v_paid is distinct from '2026-10' then raise exception 'FAIL: T9 service_role แก้ไม่ได้'; end if;
  -- คำสั่งผู้ดูแลกรอง user_id: บิลรหัส 'ib' ของ A (รหัสเดียวกับของ B) ไม่ถูกแตะ ยังว่าง
  select last_paid_month into v_paid from public.bills where id = 'ib' and user_id = ua;
  if v_paid is not null then raise exception 'FAIL: T9 คำสั่งผู้ดูแลกระทบบิลรหัสเดียวกันของผู้ใช้อื่น (%)', v_paid; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
