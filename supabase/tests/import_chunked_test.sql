-- ทดสอบ: นำเข้าแบบแบ่งก้อน (import_ledger_begin / append / abort / status)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261109000200 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

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

-- รายการรายจ่ายสมดุล n รายการ (id แยกตามคำนำหน้า)
create function pg_temp.entries(p_prefix text, p_from integer, p_to integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p_prefix || i, 'date', '2026-11-02', 'memo', 'm' || i, 'source', 'manual',
    'lines', jsonb_build_array(jsonb_build_object('accountId', 'food', 'amount', 100), jsonb_build_object('accountId', 'w1', 'amount', -100))
  )), '[]'::jsonb) from generate_series(p_from, p_to) i
$$;
grant execute on function pg_temp.entries(text, integer, integer) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  n integer;
  v jsonb;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-chk@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-chk@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

  -- T1 ยังไม่เปลี่ยนรหัส = ทุกฟังก์ชันปฏิเสธ
  perform pg_temp.login(ua);
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 3)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('a', 1, 1)))) is null then raise exception 'FAIL: T1 begin'; end if;
  if pg_temp.fails($$ select public.import_ledger_status() $$) is null then raise exception 'FAIL: T1 status'; end if;
  if pg_temp.fails($$ select public.import_ledger_abort() $$) is null then raise exception 'FAIL: T1 abort'; end if;
  perform pg_temp.logout();
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id in (ua, ub);

  -- T2 ไม่มีเซสชัน: append ปฏิเสธ · abort คืน false และไม่แตะอะไร · status false
  perform pg_temp.login(ua);
  if pg_temp.fails(format('select public.import_ledger_append(%L::jsonb)', pg_temp.entries('x', 1, 1))) is null then raise exception 'FAIL: T2 append ไม่มีเซสชัน'; end if;
  if public.import_ledger_abort() then raise exception 'FAIL: T2 abort คืน true ทั้งที่ไม่มีเซสชัน'; end if;
  if public.import_ledger_status() then raise exception 'FAIL: T2 status true'; end if;

  -- T3 begin ก้อนแรก (2 จาก 5) -> เซสชันเปิด · status true · มีข้อมูลบางส่วน
  v := public.import_ledger_begin(jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('a', 1, 2)), 5);
  if (v->>'entries')::int <> 2 or (v->>'done')::boolean then raise exception 'FAIL: T3 ผลก้อนแรก %', v; end if;
  if not public.import_ledger_status() then raise exception 'FAIL: T3 status ควรเป็นจริง'; end if;
  select count(*) into n from public.entries; if n <> 2 then raise exception 'FAIL: T3 รายการ % <> 2', n; end if;

  -- T3b ขณะเซสชันเปิด: เขียนทางอื่นถูกปฏิเสธ (insert = error, update/delete = 0 แถว) · อ่านได้ปกติ → abort จึงไม่มีข้อมูลจริงให้ลบ
  if pg_temp.fails(format('select public.create_entry(%L::jsonb)', (pg_temp.entries('real', 1, 1))->0)) is null then raise exception 'FAIL: T3b create_entry ผ่านขณะเซสชันเปิด'; end if;
  if pg_temp.fails($$ insert into public.accounts (user_id, id, type, name, currency) values ((select auth.uid()), 'extra', 'asset', 'extra', 'THB') $$) is null then raise exception 'FAIL: T3b insert บัญชีผ่านขณะเซสชันเปิด'; end if;
  if pg_temp.fails($$ insert into public.settings (user_id, value) values ((select auth.uid()), '{"payDay":5}'::jsonb) $$) is null then raise exception 'FAIL: T3b insert ตั้งค่าผ่านขณะเซสชันเปิด'; end if;
  update public.accounts set name = 'changed' where id = 'w1';
  select name into r from public.accounts where id = 'w1'; if r is distinct from 'w1' then raise exception 'FAIL: T3b แก้บัญชีได้ขณะเซสชันเปิด (%)', r; end if;
  delete from public.entries where id = 'a1';
  select count(*) into n from public.entries; if n <> 2 then raise exception 'FAIL: T3b ลบรายการได้ขณะเซสชันเปิด (%)', n; end if;
  select count(*) into n from public.accounts; if n <> 3 then raise exception 'FAIL: T3b อ่านบัญชีได้ไม่ครบ (%)', n; end if;

  -- T4 begin ซ้ำ/นำเข้าทับ ปฏิเสธ · ผู้ใช้เข้าตารางเซสชันตรงๆ ไม่ได้
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 5)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('z', 1, 1)))) is null then raise exception 'FAIL: T4 begin ซ้ำ'; end if;
  if pg_temp.fails($$ select * from private.import_sessions $$) is null then raise exception 'FAIL: T4 อ่านตารางเซสชันได้'; end if;

  -- T5 append เกินจำนวนที่ประกาศ = ปฏิเสธทั้งก้อน (ไม่เขียนบางส่วน) · รายการไม่สมดุล (R16) = ปฏิเสธทั้งก้อน
  if pg_temp.fails(format('select public.import_ledger_append(%L::jsonb)', pg_temp.entries('b', 1, 4))) is null then raise exception 'FAIL: T5 เกินจำนวน'; end if;
  select count(*) into n from public.entries; if n <> 2 then raise exception 'FAIL: T5 เขียนบางส่วนทั้งที่ปฏิเสธ (%)', n; end if;
  if pg_temp.fails(format('select public.import_ledger_append(%L::jsonb)', pg_temp.entries('c', 1, 1) || jsonb_build_array(jsonb_build_object(
      'id', 'bad', 'date', '2026-11-02', 'memo', 'bad', 'source', 'manual',
      'lines', jsonb_build_array(jsonb_build_object('accountId', 'food', 'amount', 100), jsonb_build_object('accountId', 'w1', 'amount', -99)))))) is null then
    raise exception 'FAIL: T5 รายการไม่สมดุลผ่าน';
  end if;
  select count(*) into n from public.entries; if n <> 2 then raise exception 'FAIL: T5 รายการไม่สมดุลทำให้เขียนบางส่วน (%)', n; end if;

  -- T6 ก้อนถัดไปปกติ -> ครบ 5 พอดีปิดเซสชัน
  v := public.import_ledger_append(pg_temp.entries('b', 1, 2));
  if (v->>'done')::boolean then raise exception 'FAIL: T6 ยังไม่ครบแต่ done'; end if;
  v := public.import_ledger_append(pg_temp.entries('d', 1, 1));
  if not (v->>'done')::boolean then raise exception 'FAIL: T6 ครบแล้วแต่ไม่ done %', v; end if;
  if public.import_ledger_status() then raise exception 'FAIL: T6 เซสชันยังเปิดหลังครบ'; end if;
  select count(*) into n from public.entries; if n <> 5 then raise exception 'FAIL: T6 รายการ % <> 5', n; end if;
  -- หลังปิดแล้ว เขียนทางปกติได้อีก (นโยบายล็อกเฉพาะขณะเซสชันเปิด)
  perform public.create_entry((pg_temp.entries('real', 1, 1))->0);
  select count(*) into n from public.entries; if n <> 6 then raise exception 'FAIL: T6 เขียนปกติหลังปิดเซสชันไม่ได้ (%)', n; end if;
  delete from public.entries where id = 'real1';
  select count(*) into n from public.entries; if n <> 5 then raise exception 'FAIL: T6 ลบหลังปิดเซสชันไม่ได้ (%)', n; end if;
  -- หลังปิดแล้ว append/abort ใช้ไม่ได้ (abort ไม่ลบข้อมูลที่นำเข้าเสร็จแล้ว)
  if pg_temp.fails(format('select public.import_ledger_append(%L::jsonb)', pg_temp.entries('e', 1, 1))) is null then raise exception 'FAIL: T6 append หลังปิด'; end if;
  if public.import_ledger_abort() then raise exception 'FAIL: T6 abort ลบข้อมูลที่นำเข้าเสร็จแล้ว'; end if;
  select count(*) into n from public.entries; if n <> 5 then raise exception 'FAIL: T6 abort แตะข้อมูลที่เสร็จแล้ว'; end if;
  perform pg_temp.logout();

  -- T7 ผู้ใช้ B: เปิดเซสชันบนสมุดว่าง · abort ล้างเฉพาะของ B ไม่แตะ A · begin บนสมุดที่มีข้อมูลแล้ว (A) ปฏิเสธ
  perform pg_temp.login(ub);
  perform public.import_ledger_begin(jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('a', 1, 2)), 4); -- id ซ้ำกับของ A ได้ (คีย์ต่อผู้ใช้)
  if not public.import_ledger_abort() then raise exception 'FAIL: T7 abort ไม่คืน true'; end if;
  select count(*) into n from public.entries; if n <> 0 then raise exception 'FAIL: T7 abort ไม่ล้างรายการ (%)', n; end if;
  select count(*) into n from public.accounts; if n <> 0 then raise exception 'FAIL: T7 abort ไม่ล้างบัญชี (%)', n; end if;
  if public.import_ledger_status() then raise exception 'FAIL: T7 เซสชันยังเปิดหลัง abort'; end if;
  perform pg_temp.logout();
  perform pg_temp.login(ua);
  select count(*) into n from public.entries; if n <> 5 then raise exception 'FAIL: T7 abort ของ B กระทบ A (%)', n; end if;
  -- A มีข้อมูลแล้ว: เปิดเซสชัน (ซึ่งจะเปิดทางให้ abort ลบสมุดจริง) ไม่ได้
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 3)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('q', 1, 1)))) is null then raise exception 'FAIL: T7 begin บนสมุดที่มีข้อมูล'; end if;
  if public.import_ledger_abort() then raise exception 'FAIL: T7 abort ลบสมุดจริงของ A'; end if;
  perform pg_temp.logout();

  -- T8 เพดาน: จำนวนทั้งหมด 0/10,001 ปฏิเสธ · ก้อนเกิน 1,500 ปฏิเสธ · ก้อนแรกมากกว่าจำนวนทั้งหมดปฏิเสธ
  perform pg_temp.login(ub);
  foreach n in array array[0, 10001, -1] loop
    if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, %s)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('l', 1, 1)), n)) is null then raise exception 'FAIL: T8 total=%', n; end if;
  end loop;
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 10000)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('l', 1, 1501)))) is null then raise exception 'FAIL: T8 ก้อน 1,501'; end if;
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 1)', jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('l', 1, 2)))) is null then raise exception 'FAIL: T8 ก้อนแรกเกินจำนวนทั้งหมด'; end if;
  if public.import_ledger_status() or exists (select 1 from public.accounts) then raise exception 'FAIL: T8 ถูกปฏิเสธแล้วแต่มีข้อมูลค้าง'; end if;
  -- ก้อนแรกครบทั้งไฟล์พอดี -> ปิดเซสชันทันที
  v := public.import_ledger_begin(jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('k', 1, 3)), 3);
  if not (v->>'done')::boolean or public.import_ledger_status() then raise exception 'FAIL: T8 ก้อนเดียวครบแต่เซสชันค้าง %', v; end if;
  perform pg_temp.logout();

  -- T8b reset_my_ledger ขณะเซสชันค้าง: ล้างข้อมูลและเซสชันด้วย (ข้าม cooldown 24 ชม. ของการทดสอบ)
  perform pg_temp.logout();
  update public.profiles set password_changed_at = null where user_id = ub;
  perform pg_temp.login(ub);
  v := public.import_ledger_begin(jsonb_build_object('accounts', acc, 'entries', pg_temp.entries('r', 1, 2)), 4);
  if not public.import_ledger_status() then raise exception 'FAIL: T8b เซสชันไม่เปิด'; end if;
  if not public.reset_my_ledger('new-password-1') then raise exception 'FAIL: T8b reset คืน false'; end if;
  if public.import_ledger_status() then raise exception 'FAIL: T8b reset ไม่ล้างเซสชัน'; end if;
  select count(*) into n from public.entries; if n <> 0 then raise exception 'FAIL: T8b reset ไม่ล้างรายการ (%)', n; end if;
  perform pg_temp.logout();

  -- T8c begin ต้องมีอย่างน้อย 1 บัญชี · เปิดเซสชันบนสมุดที่มีข้อมูลโดยตรง (เรียก private.* เอง) ไม่ได้
  perform pg_temp.login(ub);
  if pg_temp.fails(format('select public.import_ledger_begin(%L::jsonb, 2)', jsonb_build_object('accounts', '[]'::jsonb, 'entries', pg_temp.entries('n', 1, 1)))) is null then raise exception 'FAIL: T8c begin ไม่มีบัญชี'; end if;
  perform pg_temp.logout();
  perform pg_temp.login(ua);
  if pg_temp.fails($$ select private.import_session_open(5) $$) is null then raise exception 'FAIL: T8c เปิดเซสชันบนสมุดที่มีข้อมูลได้'; end if;
  if public.import_ledger_status() then raise exception 'FAIL: T8c มีเซสชันค้างทั้งที่ถูกปฏิเสธ'; end if;
  perform pg_temp.logout();

  -- T9 anon เรียกไม่ได้
  execute 'set local role anon';
  foreach r in array array['select public.import_ledger_status()', 'select public.import_ledger_abort()', 'select public.import_ledger_append(''[]''::jsonb)', 'select public.import_ledger_begin(''{}''::jsonb, 1)'] loop
    if pg_temp.fails(r) is null then raise exception 'FAIL: T9 anon เรียกได้ %', r; end if;
  end loop;
  execute 'reset role';

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
