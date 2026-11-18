-- ทดสอบ migration 20261115000100_usd_phase_a (เฟส A หุ้นสหรัฐ · R20): คอลัมน์ใหม่ · ด่านสกุล/อัตรา · record_trade_fx · record_fx_exchange · fx_rates · RLS · สิทธิ์ · cascade
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261115000100_usd_phase_a** · จบด้วย rollback: TESTS_PASSED
-- ตัวเลขตรงกับตัวอย่าง A ใน docs/plans/phase-a-us-stocks.md · ไม่ใช้ข้อมูลการเงินจริง

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
-- นับ/อ่านค่าด้วยสิทธิ์ผู้ดูแล (ข้าม RLS) แล้วกลับเป็นผู้ใช้เดิม
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
  uc uuid := gen_random_uuid();
  r text;
  n bigint;
  v jsonb;
  -- กระเป๋าบาท 1,000,000 บาทเศษ (สตางค์) · เงินสด USD เริ่ม 0
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000000},{"accountId":"open","amount":-500000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-usd@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-usd@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-usd@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  -- T1 ข้อมูลเดิมไม่เปลี่ยน: สินทรัพย์/รายการเงินบาทได้ค่าตั้งต้น THB / ไม่มีอัตรา · ตารางใหม่ว่าง
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-th', 'asset', 'กองทุนไทย', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('th1', 'กองทุนไทย', 'fund', 'inv-th');
  if (select instrument_currency from public.assets where id = 'th1') is distinct from 'THB' then raise exception 'FAIL: T1 สินทรัพย์บาทไม่ได้ THB ตั้งต้น'; end if;
  if (select count(*) from public.fx_rates) <> 0 or (select count(*) from public.fx_exchanges) <> 0 then raise exception 'FAIL: T1 ตารางใหม่ไม่ว่าง'; end if;

  -- เส้นทางเงินบาทเดิม (record_trade) ยังทำงานเหมือนเดิม: ซื้อ 5.00 บาท ผ่าน
  perform public.record_trade(
    '{"id":"th-buy","assetId":"th1","kind":"buy","date":"2026-11-02","units":"100000000","priceMicro":5000000,"amount":500,"fee":0}'::jsonb,
    '{"id":"th-e","date":"2026-11-02","memo":"b","source":"manual","lines":[{"accountId":"inv-th","amount":500},{"accountId":"w1","amount":-500}]}'::jsonb, '[]');
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.trades where id = 'th-buy' and fx_rate_micro is null $q$) <> 1 then raise exception 'FAIL: T1 เส้นทางบาทเดิมพัง'; end if;
  -- รายการบาทที่มีอัตราถูกปฏิเสธ
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fx_rate_micro) values ('th-fx', 'th1', 'buy', '2026-11-03', '100000000', 100, 35000000) $q$);
  if r is null or r not like '23514|%ไม่มีอัตรา%' then raise exception 'FAIL: T1 รายการบาทมีอัตราได้ (%)', r; end if;

  -- T2 สินทรัพย์ USD: ต้องผูกบัญชีลงทุนสกุล USD · สกุลเปลี่ยนไม่ได้ · ตัวเลือก ticker/exchange ถูกตรวจ
  insert into public.accounts (id, type, name, currency, kind) values ('usd-cash', 'asset', 'เงินสด USD', 'USD', 'investment'), ('inv-us', 'asset', 'หุ้นสหรัฐ ก', 'USD', 'investment');
  r := pg_temp.fails($q$ insert into public.assets (id, name, kind, account_id, instrument_currency) values ('bad-us', 'x', 'stock', 'inv-th', 'USD') $q$);
  if r is null or r not like '23514|%สกุลเดียวกับสินทรัพย์%' then raise exception 'FAIL: T2 สินทรัพย์ USD ผูกบัญชีบาทได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.assets (id, name, kind, account_id, instrument_currency) values ('bad-th', 'x', 'stock', 'inv-us', 'THB') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2 สินทรัพย์ THB ผูกบัญชี USD ได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.assets (id, name, kind, account_id, instrument_currency) values ('bad-cur', 'x', 'stock', 'inv-us', 'EUR') $q$);
  if r is null then raise exception 'FAIL: T2 สกุล EUR ผ่าน'; end if;
  r := pg_temp.fails($q$ insert into public.assets (id, name, kind, account_id, instrument_currency, ticker) values ('bad-tk', 'x', 'stock', 'inv-us', 'USD', repeat('A', 21)) $q$);
  if r is null then raise exception 'FAIL: T2 ticker ยาวเกิน 20 ผ่าน'; end if;
  r := pg_temp.fails($q$ insert into public.assets (id, name, kind, account_id, instrument_currency, exchange) values ('bad-ex', 'x', 'stock', 'inv-us', 'USD', 'LSE') $q$);
  if r is null then raise exception 'FAIL: T2 exchange นอกรายการผ่าน'; end if;
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us1', 'หุ้นสหรัฐ ก', 'stock', 'inv-us', 'USD', 'ABC', 'NASDAQ');
  r := pg_temp.fails($q$ update public.assets set instrument_currency = 'THB' where id = 'us1' $q$);
  if r is null or r not like '42501|%สกุลของสินทรัพย์เปลี่ยนไม่ได้%' then raise exception 'FAIL: T2 เปลี่ยนสกุลสินทรัพย์ได้ (%)', r; end if;
  perform pg_temp.settle();

  -- T3 รายการ USD ตรงๆ ผ่านตารางไม่ได้: ไม่มีอัตรา / ไม่ผูกสมุด / reinvest
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('x1', 'us1', 'buy', '2026-11-03', '100000000', 100) $q$);
  if r is null or r not like '23514|%ต้องมีอัตรา%' then raise exception 'FAIL: T3 USD ไม่มีอัตราผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fx_rate_micro) values ('x2', 'us1', 'buy', '2026-11-03', '100000000', 100, 35000000) $q$);
  if r is null or r not like '23514|%ผูกกับสมุดบัญชี%' then raise exception 'FAIL: T3 USD ไม่ผูกสมุดผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fx_rate_micro) values ('x3', 'us1', 'reinvest', '2026-11-03', '100000000', 100, 35000000) $q$);
  if r is null or r not like '23514|%ยังไม่รองรับ%' then raise exception 'FAIL: T3 reinvest USD ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fx_rate_micro) values ('x4', 'us1', 'buy', '2026-11-03', '100000000', 100, 0) $q$);
  if r is null then raise exception 'FAIL: T3 อัตรา 0 ผ่าน'; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fx_rate_micro) values ('x5', 'us1', 'buy', '2026-11-03', '100000000', 100, 9007199254740992) $q$);
  if r is null then raise exception 'FAIL: T3 อัตราเกินช่วงผ่าน'; end if;

  -- T4 แลกเงิน THB -> USD: จ่าย 35,000.00 บาท (3,500,000 สตางค์) ได้ $1,000.00 (100,000 เซนต์) · อัตราที่คำนวณ = 35.000000
  v := public.record_fx_exchange(
    '{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000,"memo":"แลก"}'::jsonb,
    '{"id":"fx1-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb,
    '[{"id":"fx-suspense-thb"},{"id":"fx-suspense-usd"}]');
  perform pg_temp.settle();
  if (v->>'rateMicro')::bigint <> 35000000 then raise exception 'FAIL: T4 อัตราที่คำนวณไม่ใช่ 35.000000 (%)', v; end if;
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.fx_exchanges where id = 'fx1' and rate_micro = 35000000 and entry_id = 'fx1-e' $q$) <> 1 then raise exception 'FAIL: T4 ไม่มีแถวแลกเงิน'; end if;
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where entry_id = 'fx1-e' and account_id in ('usd-cash', 'fx-suspense-usd') $q$) <> 0 then raise exception 'FAIL: T4 ผลรวม USD ไม่เป็น 0'; end if;
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where entry_id = 'fx1-e' and account_id in ('w1', 'fx-suspense-thb') $q$) <> 0 then raise exception 'FAIL: T4 ผลรวมบาทไม่เป็น 0'; end if;

  -- T5 แลกเงินที่ผิด: ยอดไม่ตรง · ใช้บัญชีผิด · ทิศทางสลับ · ผสมสกุลโดยไม่มีบัญชีพัก · อัตราต่ำเกิน · แถวตรงๆ
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"fx-bad1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000}'::jsonb,
    '{"id":"fx-bad1-e","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":99999},{"accountId":"fx-suspense-usd","amount":-99999}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%ไม่ตรงกับจำนวน%' then raise exception 'FAIL: T5 ยอดสมุดไม่ตรงจำนวนที่ระบุผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"fx-bad2","date":"2026-11-02","direction":"usd_to_thb","thbSatang":3500000,"usdCents":100000}'::jsonb,
    '{"id":"fx-bad2-e","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5 ทิศทางสลับกับเครื่องหมายผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"fx-bad3","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000}'::jsonb,
    '{"id":"fx-bad3-e","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"food","amount":3500000},{"accountId":"usd-cash","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5 ใช้บัญชีรายจ่ายแทนบัญชีพักผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"fx-bad4","date":"2026-11-02","direction":"thb_to_usd","thbSatang":1,"usdCents":10000000000}'::jsonb,
    '{"id":"fx-bad4-e","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":-1},{"accountId":"fx-suspense-thb","amount":1},{"accountId":"usd-cash","amount":10000000000},{"accountId":"fx-suspense-usd","amount":-10000000000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%ต่ำกว่า%' then raise exception 'FAIL: T5 อัตราต่ำกว่า 1 micro ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange(
    '{"id":"fx-bad5","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000}'::jsonb,
    '{"id":"fx-bad5-e","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"usd-cash","amount":100000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5 สองบรรทัดผสมสกุลผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.fx_exchanges (id, date, direction, thb_satang, usd_cents, rate_micro, entry_id) values ('fx-direct', '2026-11-02', 'thb_to_usd', 3500000, 100000, 35000000, 'fx1-e') $q$);
  if r is null or r not like '42501|%บันทึกผ่านหน้าพอร์ต%' then raise exception 'FAIL: T5 แทรกแถวแลกเงินตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.fx_exchanges set usd_cents = 1 where id = 'fx1' $q$);
  if r is null or r not like '42501|%แก้ได้เฉพาะหมายเหตุ%' then raise exception 'FAIL: T5 แก้ยอดแลกเงินตรงๆ ได้ (%)', r; end if;
  update public.fx_exchanges set memo = 'แก้หมายเหตุ' where id = 'fx1';
  r := pg_temp.fails($q$ delete from public.fx_exchanges where id = 'fx1' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5 ลบแถวแลกเงินตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.fx_exchanges (id, date, direction, thb_satang, usd_cents, rate_micro, entry_id) values ('fx-rate', '2026-11-02', 'thb_to_usd', 3500000, 100000, 35000001, 'fx1-e') $q$);
  if r is null then raise exception 'FAIL: T5 อัตราไม่ตรงกับสองจำนวนผ่าน'; end if;

  -- T6 อัตราคำนวณปัดครึ่งขึ้นเป๊ะ: 1 สตางค์ ต่อ 3 เซนต์ = 0.333333.. -> 333333 · 2 ต่อ 3 = 666667 (ตรงเทสต์ fxRateFromExchange ฝั่งเว็บ)
  if div(1::numeric * 2000000 + 3, 3::numeric * 2) <> 333333 or div(2::numeric * 2000000 + 3, 3::numeric * 2) <> 666667 then raise exception 'FAIL: T6 สูตรปัดครึ่งขึ้น'; end if;

  -- T7 ซื้อหุ้นสหรัฐ (ตัวอย่าง A): 10 หุ้น $100.00 ค่าธรรมเนียม $1.00 อัตรา 35.000000 → สินทรัพย์ +100,100 เงินสด −100,100
  v := public.record_trade_fx(
    '{"id":"b1","assetId":"us1","kind":"buy","date":"2026-11-03","units":"1000000000","priceMicro":100000000,"amount":100000,"fee":100,"fxRateMicro":35000000,"basedOn":0}'::jsonb,
    '{"id":"b1-e","date":"2026-11-03","memo":"buy","source":"manual","lines":[{"accountId":"inv-us","amount":100100},{"accountId":"usd-cash","amount":-100100}]}'::jsonb, '[]');
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::bigint from public.trades where id = 'b1' and fx_rate_micro = 35000000 and entry_id = 'b1-e' $q$) <> 1 then raise exception 'FAIL: T7 ไม่มีรายการซื้อ USD'; end if;
  -- ซื้อที่ผิด: ใช้กระเป๋าบาท · ยอดไม่ตรง · อัตรา 0 · สินทรัพย์บาท
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-bad1","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0,"fxRateMicro":35000000}'::jsonb,
    '{"id":"b-bad1-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":10000},{"accountId":"w1","amount":-10000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T7 ซื้อหุ้น USD ด้วยกระเป๋าบาทผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-bad2","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0,"fxRateMicro":35000000}'::jsonb,
    '{"id":"b-bad2-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":9999},{"accountId":"usd-cash","amount":-9999}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T7 ยอดซื้อไม่ตรงผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-bad3","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0,"fxRateMicro":0}'::jsonb,
    '{"id":"b-bad3-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":10000},{"accountId":"usd-cash","amount":-10000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%อัตรา%' then raise exception 'FAIL: T7 อัตรา 0 ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-bad4","assetId":"th1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":5000000,"amount":500,"fee":0,"fxRateMicro":35000000}'::jsonb,
    '{"id":"b-bad4-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-th","amount":500},{"accountId":"usd-cash","amount":-500}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%สกุล USD เท่านั้น%' then raise exception 'FAIL: T7 สินทรัพย์บาทผ่าน record_trade_fx (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade('{"id":"b-bad5","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0}'::jsonb,
    '{"id":"b-bad5-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":10000},{"accountId":"w1","amount":-10000}]}'::jsonb, '[]') $q$);
  if r is null then raise exception 'FAIL: T7 สินทรัพย์ USD ผ่าน record_trade เดิมได้'; end if;
  if pg_temp.ac(ua, $q$ select (select count(*) from public.entries where id like 'b-bad%') + (select count(*) from public.trades where id like 'b-bad%') $q$) <> 0 then raise exception 'FAIL: T7 รายการที่ถูกปฏิเสธเขียนแถวค้าง'; end if;

  -- T8 ขาย 4 หุ้น $120.00 ค่าธรรมเนียม $1.00 อัตรา 33.000000 → net 47,900 · costOutUsd 40,040 · กำไร USD 7,860 (สมุด: +เงินสด 47,900 −สินทรัพย์ 40,040 −กำไร 7,860)
  v := public.record_trade_fx(
    '{"id":"s1","assetId":"us1","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":120000000,"fee":100,"fxRateMicro":33000000,"basedOn":1}'::jsonb,
    '{"id":"s1-e","date":"2026-11-10","memo":"sell","source":"manual","lines":[{"accountId":"usd-cash","amount":47900},{"accountId":"inv-us","amount":-40040},{"accountId":"inv-gain-usd","amount":-7860}]}'::jsonb,
    '[{"id":"inv-gain-usd"}]');
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*)::bigint from public.accounts where id = 'inv-gain-usd' and type = 'income' and currency = 'USD' and kind = 'normal' and user_id = %L $q$, ua)) <> 1 then raise exception 'FAIL: T8 ไม่ได้สร้างบัญชีกำไร USD'; end if;
  -- ขายที่ผิด: ขายเกิน · เงินเข้าไม่ตรง · พลิกด้านกำไรเป็นขาดทุนโดยยอดผิด · ค่าธรรมเนียมเกินเงินขาย
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"s-over","assetId":"us1","kind":"sell","date":"2026-11-11","units":"700000000","priceMicro":120000000,"fee":0,"fxRateMicro":33000000}'::jsonb,
    '{"id":"s-over-e","date":"2026-11-11","source":"manual","lines":[{"accountId":"usd-cash","amount":84000},{"accountId":"inv-us","amount":-60060},{"accountId":"inv-gain-usd","amount":-23940}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%ขายเกิน%' then raise exception 'FAIL: T8 ขายเกินที่ถือผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"s-bad","assetId":"us1","kind":"sell","date":"2026-11-11","units":"100000000","priceMicro":120000000,"fee":0,"fxRateMicro":33000000}'::jsonb,
    '{"id":"s-bad-e","date":"2026-11-11","source":"manual","lines":[{"accountId":"usd-cash","amount":11000},{"accountId":"inv-us","amount":-10010},{"accountId":"inv-gain-usd","amount":-990}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T8 เงินขายไม่ตรงผ่าน (%)', r; end if;
  -- ซื้อวันเดียวกับ/ก่อนรายการขายล่าสุดถูกปฏิเสธ (ด่านลำดับเดิมใช้กับ USD ด้วย)
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"b-late","assetId":"us1","kind":"buy","date":"2026-11-10","units":"100000000","priceMicro":100000000,"amount":10000,"fee":0,"fxRateMicro":33000000}'::jsonb,
    '{"id":"b-late-e","date":"2026-11-10","source":"manual","lines":[{"accountId":"inv-us","amount":10000},{"accountId":"usd-cash","amount":-10000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%หลังรายการขายล่าสุด%' then raise exception 'FAIL: T8 ซื้อย้อนหลังหลังขายผ่าน (%)', r; end if;

  -- T9 ปันผล $50.00 ภาษีหัก $7.50: เงินสด +4,250 · ภาษี +750 · ปันผล −5,000
  perform public.record_trade_fx(
    '{"id":"d1","assetId":"us1","kind":"dividend","date":"2026-11-12","amount":5000,"withholding":750,"fxRateMicro":34567891}'::jsonb,
    '{"id":"d1-e","date":"2026-11-12","memo":"div","source":"manual","lines":[{"accountId":"usd-cash","amount":4250},{"accountId":"inv-wht-usd","amount":750},{"accountId":"inv-dividend-usd","amount":-5000}]}'::jsonb,
    '[{"id":"inv-dividend-usd"},{"id":"inv-wht-usd"}]');
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.record_trade_fx(
    '{"id":"d-bad","assetId":"us1","kind":"dividend","date":"2026-11-13","amount":5000,"withholding":750,"fxRateMicro":34567891}'::jsonb,
    '{"id":"d-bad-e","date":"2026-11-13","source":"manual","lines":[{"accountId":"usd-cash","amount":5000},{"accountId":"inv-dividend-usd","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T9 ปันผลไม่หักภาษีที่ระบุผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx('{"id":"d-re","assetId":"us1","kind":"reinvest","date":"2026-11-13","units":"1000000","amount":100,"fxRateMicro":34567891}'::jsonb,
    '{"id":"d-re-e","date":"2026-11-13","source":"manual","lines":[{"accountId":"inv-us","amount":100},{"accountId":"inv-dividend-usd","amount":-100}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T9 reinvest USD ผ่าน (%)', r; end if;
  -- ยอดเงินสด USD ในสมุด = 100,000 (แลก) − 100,100 (ซื้อ) + 47,900 (ขาย) + 4,250 (ปันผล) = 52,050
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'usd-cash' and user_id = %L $q$, ua)) <> 52050 then raise exception 'FAIL: T9 ยอดเงินสด USD ไม่ถูก'; end if;
  -- ผลรวมทุก Line สกุล USD ของผู้ใช้ = 0 และสกุลบาท = 0 (สมดุลต่อสกุลทั้งสมุด)
  if pg_temp.ac(ua, format($q$ select coalesce(sum(l.amount), 0)::bigint from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id where a.currency = 'USD' and l.user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T9 สมุด USD ไม่สมดุล'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(l.amount), 0)::bigint from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id where a.currency = 'THB' and l.user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T9 สมุดบาทไม่สมดุล'; end if;

  -- T10 ลบรายการ: ลบ Entry ขายล่าสุดได้ (ตามลำดับ) · ลบ Entry แลกเงินลบแถว fx_exchanges ตาม · ลบ Entry ซื้อที่อยู่ก่อนขายไม่ได้
  r := pg_temp.fails($q$ delete from public.entries where id = 'b1-e' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T10 ลบ Entry ซื้อก่อนรายการขายได้ (%)', r; end if;
  delete from public.entries where id = 'd1-e';
  delete from public.entries where id = 's1-e';
  delete from public.entries where id = 'b1-e';
  perform pg_temp.settle();
  delete from public.entries where id = 'fx1-e';
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where asset_id = 'us1' and user_id = %L) + (select count(*) from public.fx_exchanges where user_id = %L) $q$, ua, ua)) <> 0 then raise exception 'FAIL: T10 ลบ Entry แล้วแถวรายการ USD/แลกเงินไม่ตาม'; end if;

  -- T11 fx_rates: ผูกบัญชี USD เท่านั้น · หนึ่งอัตราต่อวัน · อัตรา ≤ 0 ปฏิเสธ · cascade ตามบัญชี
  insert into public.fx_rates (account_id, date, rate_micro) values ('usd-cash', '2026-11-05', 35100000), ('usd-cash', '2026-11-06', 35200000);
  r := pg_temp.fails($q$ insert into public.fx_rates (account_id, date, rate_micro) values ('usd-cash', '2026-11-06', 1) $q$);
  if r is null then raise exception 'FAIL: T11 อัตราซ้ำวันเดียวกันผ่าน'; end if;
  r := pg_temp.fails($q$ insert into public.fx_rates (account_id, date, rate_micro) values ('usd-cash', '2026-11-07', 0) $q$);
  if r is null then raise exception 'FAIL: T11 อัตรา 0 ผ่าน'; end if;
  r := pg_temp.fails($q$ insert into public.fx_rates (account_id, date, rate_micro) values ('w1', '2026-11-07', 35000000) $q$);
  if r is null or r not like '23514|%บัญชีลงทุนสกุล USD%' then raise exception 'FAIL: T11 อัตราผูกกระเป๋าบาทผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.fx_rates (account_id, date, rate_micro) values ('inv-us', '2026-11-07', 35000000) $q$);
  if r is not null then raise exception 'FAIL: T11 อัตราผูกบัญชีลงทุน USD ของสินทรัพย์ควรผ่านได้ (%)', r; end if;

  -- T12 แยกข้อมูลต่อผู้ใช้ (RLS): B มองไม่เห็น/แก้/ลบอัตราและแลกเงินของ A · ใส่ user_id ของ A ไม่ได้
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  insert into public.accounts (id, type, name, currency, kind) values ('usd-cash', 'asset', 'เงินสด USD ของ B', 'USD', 'investment');
  perform pg_temp.settle();
  select count(*) into n from public.fx_rates; if n <> 0 then raise exception 'FAIL: T12 B เห็นอัตราของ A (%)', n; end if;
  select count(*) into n from public.fx_exchanges; if n <> 0 then raise exception 'FAIL: T12 B เห็นการแลกเงินของ A (%)', n; end if;
  update public.fx_rates set rate_micro = 1; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: T12 B แก้อัตราของ A ได้'; end if;
  delete from public.fx_rates; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: T12 B ลบอัตราของ A ได้'; end if;
  r := pg_temp.fails(format($f$ insert into public.fx_rates (user_id, account_id, date, rate_micro) values (%L, 'usd-cash', '2026-11-09', 35000000) $f$, ua));
  if r is null then raise exception 'FAIL: T12 B ใส่อัตราในชื่อ A ได้'; end if;
  -- B แลกเงินด้วยบัญชีของ A ไม่ได้ (บัญชี A ไม่ปรากฏให้ B) · B ใช้ได้กับบัญชีของตัวเอง
  perform public.record_fx_exchange(
    '{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":700000,"usdCents":20000}'::jsonb,
    '{"id":"fx1-e","date":"2026-11-02","memo":"แลก","source":"manual","lines":[{"accountId":"w1","amount":-700000},{"accountId":"fx-suspense-thb","amount":700000},{"accountId":"usd-cash","amount":20000},{"accountId":"fx-suspense-usd","amount":-20000}]}'::jsonb,
    '[{"id":"fx-suspense-thb"},{"id":"fx-suspense-usd"}]');
  perform pg_temp.settle();
  perform pg_temp.logout();

  -- T13 ผู้ใช้ที่ยังไม่เปลี่ยนรหัส (C) ใช้ฟังก์ชันใหม่ไม่ได้ · แถวของ C ที่ผู้ดูแลใส่ให้เห็นเป็น 0 แถว
  insert into public.accounts (user_id, id, type, name, currency, kind) values (uc, 'usd-c', 'asset', 'ของ C', 'USD', 'investment');
  insert into public.fx_rates (user_id, account_id, date, rate_micro) values (uc, 'usd-c', '2026-11-06', 35000000);
  perform pg_temp.login(uc);
  select count(*) into n from public.fx_rates; if n <> 0 then raise exception 'FAIL: T13 C เห็นอัตราทั้งที่ยังไม่เปลี่ยนรหัส (%)', n; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange('{}'::jsonb, '{}'::jsonb, '[]') $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T13 C เรียก record_fx_exchange ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx('{}'::jsonb, '{}'::jsonb, '[]') $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T13 C เรียก record_trade_fx ได้ (%)', r; end if;
  perform pg_temp.logout();

  -- T14 anon ไม่มีสิทธิ์ตาราง/ฟังก์ชันใหม่ · authenticated ไม่มี TRUNCATE · RLS เปิดและมีนโยบายครบ 5 ต่อตาราง
  execute 'set local role anon';
  r := pg_temp.fails($q$ select count(*) from public.fx_rates $q$); if r is null then raise exception 'FAIL: T14 anon อ่าน fx_rates ได้'; end if;
  r := pg_temp.fails($q$ select count(*) from public.fx_exchanges $q$); if r is null then raise exception 'FAIL: T14 anon อ่าน fx_exchanges ได้'; end if;
  r := pg_temp.fails($q$ select public.record_trade_fx('{}'::jsonb, '{}'::jsonb) $q$); if r is null then raise exception 'FAIL: T14 anon เรียก record_trade_fx ได้'; end if;
  r := pg_temp.fails($q$ select public.record_fx_exchange('{}'::jsonb, '{}'::jsonb) $q$); if r is null then raise exception 'FAIL: T14 anon เรียก record_fx_exchange ได้'; end if;
  execute 'reset role';
  if has_table_privilege('authenticated', 'public.fx_rates', 'truncate') or has_table_privilege('authenticated', 'public.fx_exchanges', 'truncate') then raise exception 'FAIL: T14 authenticated truncate ได้'; end if;
  if exists (select 1 from pg_class where oid in ('public.fx_rates'::regclass, 'public.fx_exchanges'::regclass) and not relrowsecurity) then raise exception 'FAIL: T14 ตารางใหม่ไม่ได้เปิด RLS'; end if;
  for r in select unnest(array['fx_rates', 'fx_exchanges']) loop
    select count(*) into n from pg_policies where schemaname = 'public' and tablename = r
      and policyname in (r || '_own', r || '_gate', r || '_import_lock_ins', r || '_import_lock_upd', r || '_import_lock_del');
    if n <> 5 then raise exception 'FAIL: T14 policy ของ % ไม่ครบ (พบ %)', r, n; end if;
  end loop;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('record_trade_fx', 'record_fx_exchange') and has_function_privilege('anon', p.oid, 'execute');
  if n <> 0 then raise exception 'FAIL: T14 anon มีสิทธิ์เรียกฟังก์ชันใหม่ (%)', n; end if;

  -- T15 ฟังก์ชันล้างข้อมูล (reset_my_ledger_step) ทำงานต่อได้กับข้อมูล USD/แลกเงิน/อัตรา: ล้างแล้วเหลือ 0 ทุกตารางใหม่ · ข้อมูลของ B ไม่ถูกแตะ
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);
  perform pg_temp.login(ua);
  perform public.record_fx_exchange(
    '{"id":"fx2","date":"2026-11-04","direction":"thb_to_usd","thbSatang":350000,"usdCents":10000}'::jsonb,
    '{"id":"fx2-e","date":"2026-11-04","memo":"แลก","source":"manual","lines":[{"accountId":"w1","amount":-350000},{"accountId":"fx-suspense-thb","amount":350000},{"accountId":"usd-cash","amount":10000},{"accountId":"fx-suspense-usd","amount":-10000}]}'::jsonb, '[]');
  perform pg_temp.settle();
  n := 0;
  loop
    r := public.reset_my_ledger_step('new-password-1');
    n := n + 1;
    exit when r = 'done';
    if r <> 'more' or n > 10 then raise exception 'FAIL: T15 ผลล้างข้อมูลไม่คาด % (ชุด %)', r, n; end if;
  end loop;
  perform pg_temp.logout();
  if (select count(*) from public.fx_rates where user_id = ua) + (select count(*) from public.fx_exchanges where user_id = ua) + (select count(*) from public.assets where user_id = ua) <> 0 then raise exception 'FAIL: T15 ล้างข้อมูลแล้วยังเหลือแถว USD/อัตรา/แลกเงิน'; end if;
  if (select count(*) from public.fx_exchanges where user_id = ub) <> 1 then raise exception 'FAIL: T15 ล้างของ A กระทบข้อมูลแลกเงินของ B'; end if;

  -- T16 ลบบัญชีผู้ใช้ (delete_my_account_step) ที่มีข้อมูลใหม่: ลบสะอาด
  perform pg_temp.login(ub);
  n := 0;
  loop
    r := public.delete_my_account_step('new-password-2');
    n := n + 1;
    exit when r = 'done';
    if r <> 'more' or n > 10 then raise exception 'FAIL: T16 ผลลบบัญชีไม่คาด % (ชุด %)', r, n; end if;
  end loop;
  perform pg_temp.logout();
  if (select count(*) from public.fx_exchanges where user_id = ub) + (select count(*) from public.fx_rates where user_id = ub) + (select count(*) from auth.users where id = ub) <> 0 then raise exception 'FAIL: T16 ลบบัญชีแล้วยังเหลือแถว'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
