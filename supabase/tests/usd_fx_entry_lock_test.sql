-- ทดสอบ migration 20261115000200_usd_fx_entry_lock: ล็อก Entry/บรรทัดของรายการแลกเงิน · ห้ามซ่อนหมวดผลลงทุน USD · ไม่รั่วข้ามผู้ใช้ผ่านฟังก์ชันใหม่
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261115000100_usd_phase_a และ 20261115000200_usd_fx_entry_lock** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขทั้งหมดสมมติ)

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate || '|' || sqlerrm; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.ac(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.logout();
  execute p_sql into n;
  perform pg_temp.login(p_user);
  return n;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.ac(uuid, text) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000000},{"accountId":"open","amount":-500000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-lock@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-lock@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('usd-cash', 'asset', 'เงินสด USD', 'USD', 'investment'), ('inv-us', 'asset', 'หุ้นสหรัฐ ก', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us1', 'หุ้นสหรัฐ ก', 'stock', 'inv-us', 'USD', 'ABC', 'NASDAQ');
  perform pg_temp.settle();

  perform public.record_fx_exchange(
    '{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000,"memo":"แลก"}'::jsonb,
    '{"id":"fx1-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb,
    '[{"id":"fx-suspense-thb"},{"id":"fx-suspense-usd"}]');
  perform pg_temp.settle();

  -- T1 แก้ Entry แลกเงินผ่าน update_entry (ปลอมยอด USD ให้สมดุลต่อสกุลเป็น 200,000) ถูกปฏิเสธ 42501
  r := pg_temp.fails($q$ select public.update_entry('{"id":"fx1-e","date":"2026-11-02","memo":"x","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":200000},{"accountId":"fx-suspense-usd","amount":-200000}]}'::jsonb) $q$);
  if r is null or r not like '42501|%การแลกเงิน%' then raise exception 'FAIL: T1 update_entry แก้ Entry แลกเงินได้ (%)', r; end if;

  -- T2 แก้ Entry/บรรทัดตรงๆ ผ่านตาราง (แบบ PostgREST) ถูกปฏิเสธ 42501 ทุกแบบ
  r := pg_temp.fails($q$ update public.entries set memo = 'edited' where id = 'fx1-e' $q$);
  if r is null or r not like '42501|%การแลกเงิน%' then raise exception 'FAIL: T2 แก้ memo Entry แลกเงินตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.entries set date = '2026-11-03' where id = 'fx1-e' $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T2 แก้วันที่ Entry แลกเงินตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.lines set amount = amount * 2 where entry_id = 'fx1-e' and account_id in ('usd-cash', 'fx-suspense-usd') $q$);
  if r is null or r not like '42501|%การแลกเงิน%' then raise exception 'FAIL: T2 แก้ยอดบรรทัดแลกเงินตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.lines (entry_id, idx, account_id, amount) values ('fx1-e', 5, 'food', 100), ('fx1-e', 6, 'w1', -100) $q$);
  if r is null or r not like '42501|%การแลกเงิน%' then raise exception 'FAIL: T2 เพิ่มบรรทัดคู่เข้า Entry แลกเงินได้ (%)', r; end if;

  -- T3 หลังโดนปฏิเสธ ทุกอย่างคงเดิม: เงินสด USD 100,000 · fx_exchanges ตรงสมุด
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'usd-cash' $q$) <> 100000 then raise exception 'FAIL: T3 ยอดเงินสด USD เปลี่ยน'; end if;
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.fx_exchanges where id = 'fx1' and usd_cents = 100000 and thb_satang = 3500000 and date = '2026-11-02' $q$) <> 1 then raise exception 'FAIL: T3 แถว fx_exchanges เปลี่ยน'; end if;
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.lines where entry_id = 'fx1-e' $q$) <> 4 then raise exception 'FAIL: T3 จำนวนบรรทัดของ Entry แลกเงินเปลี่ยน'; end if;

  -- T4 เส้นทางเดิมของรายการบาททั่วไปยังแก้ได้ (ไม่ถูกด่านใหม่กระทบ)
  perform public.create_entry('{"id":"e-th","date":"2026-11-03","memo":"ข้าว","source":"manual","lines":[{"accountId":"food","amount":6500},{"accountId":"w1","amount":-6500}]}'::jsonb);
  perform pg_temp.settle();
  perform public.update_entry('{"id":"e-th","date":"2026-11-03","memo":"ข้าวมันไก่","lines":[{"accountId":"food","amount":7000},{"accountId":"w1","amount":-7000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.entries where id = 'e-th' and memo = 'ข้าวมันไก่' $q$) <> 1 then raise exception 'FAIL: T4 update_entry ของรายการบาททั่วไปใช้ไม่ได้'; end if;

  -- T5 ลบ Entry แลกเงินทั้งรายการยังทำได้ และ fx_exchanges หายตาม (cascade)
  delete from public.entries where id = 'fx1-e';
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select (select count(*) from public.fx_exchanges) + (select count(*) from public.lines where entry_id = 'fx1-e') $q$) <> 0 then raise exception 'FAIL: T5 ลบ Entry แลกเงินแล้วแถวไม่ตาม'; end if;

  -- T6 ห้ามซ่อนหมวดผลลงทุนฝั่ง USD (เหมือนฝั่งบาท) · หมวดปกติยังซ่อนได้
  insert into public.accounts (id, type, name, currency, kind) values
    ('inv-gain-usd', 'income', 'กำไร USD', 'USD', 'normal'), ('inv-loss-usd', 'expense', 'ขาดทุน USD', 'USD', 'normal'),
    ('inv-dividend-usd', 'income', 'ปันผล USD', 'USD', 'normal'), ('inv-wht-usd', 'expense', 'ภาษีหัก USD', 'USD', 'normal'),
    ('food2', 'expense', 'food2', 'THB', 'normal');
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.set_category_archived('inv-gain-usd', true) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 ซ่อน inv-gain-usd ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_category_archived('inv-loss-usd', true) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 ซ่อน inv-loss-usd ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_category_archived('inv-dividend-usd', true) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 ซ่อน inv-dividend-usd ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_category_archived('inv-wht-usd', true) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 ซ่อน inv-wht-usd ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_category_archived('food2', true) $q$);
  if r is not null then raise exception 'FAIL: T6 ซ่อนหมวดปกติไม่ได้ (%)', r; end if;

  -- T7 ผู้ใช้ B ชี้ไปที่สินทรัพย์/บัญชีของ A ผ่านข้อมูลที่ส่งเข้าฟังก์ชันไม่ได้
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  insert into public.accounts (id, type, name, currency, kind) values ('usd-cash', 'asset', 'เงินสด USD ของ B', 'USD', 'investment');
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-steal","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0,"fxRateMicro":35000000,"basedOn":0}'::jsonb,
    '{"id":"b-steal-e","date":"2026-11-03","memo":"x","source":"manual","lines":[{"accountId":"inv-us","amount":10000},{"accountId":"usd-cash","amount":-10000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T7 B ซื้อสินทรัพย์ของ A ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"b-fx","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000}'::jsonb,
    '{"id":"b-fx-e","date":"2026-11-02","memo":"x","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"inv-us","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb,
    '[{"id":"fx-suspense-thb"},{"id":"fx-suspense-usd"}]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T7 B ใช้บัญชี USD ที่มีแต่ของ A ใน record_fx_exchange ได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.fx_rates (account_id, date, rate_micro) values ('inv-us', '2026-11-05', 35000000) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T7 B ใส่อัตราผูกบัญชีของ A ได้ (%)', r; end if;
  if pg_temp.ac(ub, $q$ select (select count(*) from public.trades) + (select count(*) from public.fx_exchanges) + (select count(*) from public.fx_rates) + (select count(*) from public.entries where id like 'b-%') $q$) <> 0 then raise exception 'FAIL: T7 รายการที่ถูกปฏิเสธเขียนแถวค้าง'; end if;

  perform pg_temp.logout();
  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
