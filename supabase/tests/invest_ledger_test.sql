-- ทดสอบ พอร์ตลงทุน P4: record_trade (อะตอมมิก) + ด่านกันขายเกิน/ผิดลำดับ + ลบ/แก้รายการที่ผูกสมุด + นำเข้าไฟล์สำรองยังผ่าน
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261111000300_invest_ledger** · จบด้วย rollback: TESTS_PASSED
-- รหัส error ที่คาดเรียงตามลำดับจริง: BEFORE ROW trigger (23514) ก่อน RLS WITH CHECK (42501) ก่อน FK (23503)
-- ทุกกรณีที่ถูกปฏิเสธ ตรวจด้วยสิทธิ์ผู้ดูแล (ข้าม RLS) ว่าไม่มีแถวถูกเขียนจริง · ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขสมมติ)

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
-- นับแถวด้วยสิทธิ์ผู้ดูแล (ข้าม RLS) แล้วกลับไปเป็นผู้ใช้เดิม
create function pg_temp.ac(p_user uuid, p_sql text) returns integer language plpgsql as $$
declare n integer;
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
  n integer;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000000},{"accountId":"open","amount":-1000000}]}]';
  -- ซื้อ 10 หน่วย (units 10^9) มูลค่า 500.00 บาท ค่าธรรมเนียม 1.00 บาท: บัญชีลงทุน +50100, กระเป๋า -50100
  buy1_t jsonb := '{"id":"t-buy1","assetId":"a1","kind":"buy","date":"2026-11-05","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":100}';
  buy1_e jsonb := '{"id":"e-buy1","date":"2026-11-05","memo":"buy","source":"manual","lines":[{"accountId":"inv1","amount":50100},{"accountId":"w1","amount":-50100}]}';
  -- ขาย 4 หน่วย ราคา 6.00 บาท: ขายได้ 2400 − ค่าธรรมเนียม 10 = 2390 · ต้นทุนที่ตัดออก round(50100×4/10) = 20040 · ขาดทุน 17650
  sell1_t jsonb := '{"id":"t-sell1","assetId":"a1","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":6000000,"fee":10}';
  sell1_e jsonb := '{"id":"e-sell1","date":"2026-11-10","memo":"sell","source":"manual","lines":[{"accountId":"w1","amount":2390},{"accountId":"inv1","amount":-20040},{"accountId":"inv-loss","amount":17650}]}';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-led@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-led@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'กองทุน ก', 'THB', 'investment'), ('inv2', 'asset', 'กองทุน ข', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุน ก', 'fund', 'inv1'), ('a2', 'กองทุน ข', 'fund', 'inv2');
  perform pg_temp.settle();

  -- T1 ซื้อ: บันทึกรายการ + Entry ในธุรกรรมเดียว
  perform public.record_trade(buy1_t, buy1_e, '[]');
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::int from public.trades where id = 't-buy1' and entry_id = 'e-buy1' $q$) <> 1 then raise exception 'FAIL: T1 ไม่มีรายการลงทุนที่ผูก Entry'; end if;
  if pg_temp.ac(ua, $q$ select count(*)::int from public.lines where entry_id = 'e-buy1' $q$) <> 2 then raise exception 'FAIL: T1 บรรทัดสมุดไม่ครบ'; end if;

  -- T2 Entry ไม่ตรงรายการ / ใช้บัญชีที่ไม่อนุญาต = 23514 และไม่มีแถวถูกเขียนเลย (ทั้ง entry, lines, trades)
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-bad1","assetId":"a1","kind":"buy","date":"2026-11-06","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-bad1","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":4000},{"accountId":"w1","amount":-4000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2 Entry ยอดไม่ตรงรายการซื้อ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-bad2","assetId":"a1","kind":"buy","date":"2026-11-06","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-bad2","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv2","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2 ใช้บัญชีลงทุนของสินทรัพย์อื่น (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-bad3","assetId":"a1","kind":"buy","date":"2026-11-06","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-bad3","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"open","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2 ใช้บัญชีทุน (equity) แทนกระเป๋า (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-bad4","assetId":"a1","kind":"buy","date":"2026-11-06","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-bad4","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[{"id":"hack","type":"asset","name":"x"}]') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T2 สร้างบัญชีแปลกผ่าน record_trade ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-bad5","assetId":"a1","kind":"buy","date":"2026-11-07","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-bad5","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T2 วันที่ Entry ไม่ตรงรายการ (%)', r; end if;
  if pg_temp.ac(ua, $q$ select (select count(*) from public.entries where id like 'e-bad%') + (select count(*) from public.lines where entry_id like 'e-bad%') + (select count(*) from public.trades where id like 't-bad%') + (select count(*) from public.accounts where id = 'hack') $q$) <> 0 then
    raise exception 'FAIL: T2 รายการที่ถูกปฏิเสธเขียนแถวค้างอยู่'; end if;

  -- T3 ขายเกินจำนวนที่ถือ (ถือ 10 หน่วย ขาย 20 หน่วย ราคา 6.00 = 12000) = 23514 จาก trigger · ไม่มีแถวค้าง
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-over","assetId":"a1","kind":"sell","date":"2026-11-10","units":"2000000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-over","date":"2026-11-10","memo":"x","source":"manual","lines":[{"accountId":"w1","amount":12000},{"accountId":"inv1","amount":-50100},{"accountId":"inv-gain","amount":38100}]}'::jsonb, '[]') $q$);
  -- (ครั้งแรกใช้บัญชี inv-gain ที่ยังไม่มี = ปฏิเสธที่ชนิดบัญชี) แล้วลองใหม่ด้วย Entry ที่ถูกต้องแต่ขายเกิน
  if r is null or r not like '23514|%' then raise exception 'FAIL: T3 Entry ใช้บัญชีที่ไม่มีผ่านได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-over","assetId":"a1","kind":"sell","date":"2026-11-10","units":"2000000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-over","date":"2026-11-10","memo":"x","source":"manual","lines":[{"accountId":"w1","amount":12000},{"accountId":"inv1","amount":-50100},{"accountId":"inv-loss","amount":38100}]}'::jsonb, '[{"id":"inv-loss"}]') $q$);
  if r is null or r not like '23514|%ขายเกิน%' then raise exception 'FAIL: T3 ขายเกินจำนวนที่ถือผ่านได้ (%)', r; end if;
  -- ตรงๆ ผ่านตารางโดยไม่ผ่าน RPC ก็ต้องโดน (สองแท็บ/เขียน REST ตรง)
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, price_micro, fee) values ('t-over2', 'a1', 'sell', '2026-11-10', '2000000000', 6000000, 0) $q$);
  if r is null or r not like '23514|%ขายเกิน%' then raise exception 'FAIL: T3 insert ตรงขายเกินผ่านได้ (%)', r; end if;
  -- ขายแล้วได้เงิน 0 สตางค์ และค่าธรรมเนียมเกินเงินขาย
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, price_micro, fee) values ('t-zero', 'a1', 'sell', '2026-11-10', '1', 1, 0) $q$);
  if r is null or r not like '23514|%0 สตางค์%' then raise exception 'FAIL: T3 ขายได้ 0 สตางค์ผ่านได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, price_micro, fee) values ('t-fee', 'a1', 'sell', '2026-11-10', '100000000', 6000000, 999999) $q$);
  if r is null or r not like '23514|%ค่าธรรมเนียม%' then raise exception 'FAIL: T3 ค่าธรรมเนียมเกินเงินขายผ่านได้ (%)', r; end if;
  if pg_temp.ac(ua, $q$ select (select count(*) from public.trades where id in ('t-over', 't-over2', 't-zero', 't-fee')) + (select count(*) from public.entries where id = 'e-over') $q$) <> 0 then
    raise exception 'FAIL: T3 รายการที่ถูกปฏิเสธเขียนแถวค้างอยู่'; end if;

  -- T4 ขายที่ถูกต้อง (ขาดทุน): สร้างบัญชี inv-loss ให้เอง
  perform public.record_trade(sell1_t, sell1_e, '[{"id":"inv-loss"}]');
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::int from public.accounts where id = 'inv-loss' and type = 'expense' and kind = 'normal' $q$) <> 1 then raise exception 'FAIL: T4 ไม่ได้สร้างบัญชี inv-loss'; end if;
  -- ขายอีกครั้ง: เงินเข้ากระเป๋าไม่ตรง = ปฏิเสธ
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-sell2","assetId":"a1","kind":"sell","date":"2026-11-12","units":"100000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-sell2","date":"2026-11-12","memo":"x","source":"manual","lines":[{"accountId":"w1","amount":700},{"accountId":"inv1","amount":-1000},{"accountId":"inv-loss","amount":300}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4 เงินเข้ากระเป๋าไม่ตรงผ่านได้ (%)', r; end if;

  -- T5 ลำดับ: ซื้อ/ปันผลลงทุนต่อวันที่ ≤ วันขายล่าสุด (2026-11-10) = 23514 · วันถัดไปผ่าน · ปันผลเงินสดไม่ติดกติกานี้
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-late","assetId":"a1","kind":"buy","date":"2026-11-10","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-late","date":"2026-11-10","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23514|%หลังรายการขายล่าสุด%' then raise exception 'FAIL: T5 ซื้อวันเดียวกับรายการขายผ่านได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, price_micro, amount, fee) values ('t-late2', 'a1', 'buy', '2026-11-09', '100000000', 5000000, 5000, 0) $q$);
  if r is null or r not like '23514|%หลังรายการขายล่าสุด%' then raise exception 'FAIL: T5 insert ตรงย้อนหลังผ่านได้ (%)', r; end if;
  if pg_temp.ac(ua, $q$ select count(*)::int from public.trades where id in ('t-late', 't-late2') $q$) <> 0 then raise exception 'FAIL: T5 มีแถวค้าง'; end if;
  perform public.record_trade('{"id":"t-buy2","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}',
    '{"id":"e-buy2","date":"2026-11-11","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}', '[]');
  -- ปันผลเงินสด 10.00 หักภาษี 1.00 (วันก่อนวันขายก็ได้) · ปันผลลงทุนต่อ 5.00
  perform public.record_trade('{"id":"t-div","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":1000,"withholding":100}',
    '{"id":"e-div","date":"2026-11-02","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}',
    '[{"id":"inv-dividend"},{"id":"inv-wht"}]');
  perform public.record_trade('{"id":"t-rein","assetId":"a1","kind":"reinvest","date":"2026-11-12","units":"10000000","amount":500}',
    '{"id":"e-rein","date":"2026-11-12","memo":"r","source":"manual","lines":[{"accountId":"inv1","amount":500},{"accountId":"inv-dividend","amount":-500}]}', '[]');
  perform pg_temp.settle();

  -- T6 ลบ/แก้รายการที่ผูกสมุด (ผู้ใช้): ลบรายการลงทุนตรงๆ ไม่ได้ · แก้ Entry/บรรทัดไม่ได้ · ลบ Entry ตามกติกาลำดับ
  r := pg_temp.fails($q$ delete from public.trades where id = 't-buy2' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T6 ลบรายการที่ผูกสมุดตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.entries set memo = 'edited' where id = 'e-buy1' $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 แก้ Entry ที่ผูกได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.lines set amount = amount + 1 where entry_id = 'e-buy1' and idx = 1 $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T6 แก้บรรทัดที่ผูกได้ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.lines (entry_id, idx, account_id, amount) values ('e-buy1', 3, 'w1', 1) $q$);
  if r is null then raise exception 'FAIL: T6 เพิ่มบรรทัดให้ Entry ที่ผูกได้'; end if;
  -- ลบ Entry ซื้อก่อนวันขายล่าสุดขณะยังมีรายการขาย = 23514 · ไม่มีอะไรถูกลบ
  r := pg_temp.fails($q$ delete from public.entries where id = 'e-buy1' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T6 ลบ Entry ซื้อที่อยู่ก่อนรายการขายได้ (%)', r; end if;
  if pg_temp.ac(ua, $q$ select (select count(*) from public.entries where id = 'e-buy1') + (select count(*) from public.trades where id = 't-buy1') + (select count(*) from public.lines where entry_id = 'e-buy1') $q$) <> 4 then
    raise exception 'FAIL: T6 แถวถูกลบแม้ถูกปฏิเสธ'; end if;
  -- ลบรายการที่กระทบหน่วยซึ่งลงวันที่หลังรายการขาย (ซื้อ 11-11) ได้ · ปันผลเงินสดลบได้เสมอ
  delete from public.entries where id = 'e-buy2';
  delete from public.entries where id = 'e-div';
  delete from public.entries where id = 'e-rein';
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(*)::int from public.trades where id in ('t-buy2', 't-div', 't-rein') $q$) <> 0 then raise exception 'FAIL: T6 cascade ไม่ลบรายการลงทุน'; end if;
  -- ลบรายการขายล่าสุด แล้วลบรายการซื้อได้ตามลำดับ
  delete from public.entries where id = 'e-sell1';
  perform pg_temp.settle();
  delete from public.entries where id = 'e-buy1';
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where asset_id = 'a1' and user_id = %L) + (select count(*) from public.lines where entry_id in ('e-sell1', 'e-buy1') and user_id = %L) $q$, ua, ua)) <> 0 then
    raise exception 'FAIL: T6 ลบตามลำดับแล้วยังมีแถวค้าง'; end if;

  -- T7 ผู้ใช้ B ใช้สินทรัพย์ของ A ไม่ได้ (record_trade ไม่เห็น a1) และบัญชี inv-* ที่เป็นชนิดผิดถูกปฏิเสธ
  -- T9 (เสริมความแข็งแรง 20261111000400) basedOn กันสองแท็บ · ปัดเงินขายด้วยจำนวนเต็ม · แก้/ชี้ entry_id ตรงๆ ไม่ได้ · ลบสินทรัพย์ที่ผูกสมุดไม่ได้
  perform public.record_trade('{"id":"t-a2","assetId":"a2","kind":"buy","date":"2026-11-13","units":"200000000000000000","priceMicro":1,"amount":1000,"fee":0,"basedOn":0}',
    '{"id":"e-a2","date":"2026-11-13","memo":"b","source":"manual","lines":[{"accountId":"inv2","amount":1000},{"accountId":"w1","amount":-1000}]}', '[]');
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-a2x","assetId":"a2","kind":"buy","date":"2026-11-13","units":"1","priceMicro":1,"amount":1,"fee":0,"basedOn":0}'::jsonb,
    '{"id":"e-a2x","date":"2026-11-13","memo":"b","source":"manual","lines":[{"accountId":"inv2","amount":1},{"accountId":"w1","amount":-1}]}'::jsonb, '[]') $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T9 basedOn ไม่ตรงผ่านได้ (%)', r; end if;
  -- เศษ .4999… ต้องปัดลง: units x price = 123456499999999999 → 123456.499999999999 สตางค์ = 123456 (ไม่ปัดสองรอบเป็น 123457)
  perform public.record_trade('{"id":"t-rd","assetId":"a2","kind":"sell","date":"2026-11-14","units":"123456499999999999","priceMicro":1,"fee":0,"basedOn":1}',
    '{"id":"e-rd","date":"2026-11-14","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":123456},{"accountId":"inv2","amount":-617},{"accountId":"inv-gain","amount":-122839}]}', '[{"id":"inv-gain"}]');
  perform pg_temp.settle();
  r := pg_temp.fails($q$ update public.trades set amount = 1 where id = 't-rd' $q$);
  if r is null then raise exception 'FAIL: T9 แก้ยอดรายการลงทุนตรงๆ ได้'; end if;
  r := pg_temp.fails($q$ update public.trades set units = '1' where id = 't-a2' $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T9 แก้หน่วยตรงๆ ได้ (%)', r; end if;
  r := pg_temp.fails($q$ update public.trades set entry_id = 'sys' where id = 't-a2' $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T9 ย้าย entry_id ได้ (%)', r; end if;
  update public.trades set memo = 'ok' where id = 't-a2';
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, entry_id) values ('t-forge', 'a2', 'buy', '2026-11-20', '1', 1, 'sys') $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T9 ชี้ entry_id เองได้ (%)', r; end if;
  r := pg_temp.fails($q$ delete from public.assets where id = 'a2' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T9 ลบสินทรัพย์ที่ผูกสมุดได้ (%)', r; end if;
  if pg_temp.ac(ua, format($q$ select ((select count(*) from public.assets where id = 'a2' and user_id = %L) + (select count(*) from public.trades where id in ('t-a2', 't-rd') and user_id = %L) + (select count(*) from public.trades where id in ('t-forge', 't-a2x') and user_id = %L) * 100)::int $q$, ua, ua, ua)) <> 3 then
    raise exception 'FAIL: T9 แถวไม่ตรงที่คาด'; end if;
  -- ลบตามลำดับ (ขายก่อน) ได้ผ่านการลบรายการในสมุด
  delete from public.entries where id = 'e-rd';
  delete from public.entries where id = 'e-a2';
  perform pg_temp.settle();

  perform pg_temp.login(ub);
  perform private.setup_ledger(acc, ent);
  insert into public.accounts (id, type, name, currency, kind) values ('inv9', 'asset', 'กองทุน ค', 'THB', 'investment'), ('inv-wht', 'income', 'ชื่อซ้ำชนิดผิด', 'THB', 'normal');
  insert into public.assets (id, name, kind, account_id) values ('b1', 'กองทุน ค', 'fund', 'inv9');
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-steal","assetId":"a1","kind":"buy","date":"2026-11-06","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-steal","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]') $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T7 B ใช้สินทรัพย์ของ A ได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade(
    '{"id":"t-wht","assetId":"b1","kind":"dividend","date":"2026-11-06","amount":1000,"withholding":100}'::jsonb,
    '{"id":"e-wht","date":"2026-11-06","memo":"x","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb, '[{"id":"inv-dividend"}]') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T7 inv-wht ชนิด income ผ่านได้ (%)', r; end if;
  if pg_temp.ac(ub, $q$ select (select count(*) from public.trades where id in ('t-steal', 't-wht')) + (select count(*) from public.entries where id in ('e-steal', 'e-wht')) $q$) <> 0 then
    raise exception 'FAIL: T7 มีแถวค้าง'; end if;

  -- T8 นำเข้าไฟล์สำรอง: ลำดับแถวขายก่อนซื้อในอาร์เรย์ต้องผ่าน (ข้ามด่านเฉพาะตอนนำเข้า) แล้วด่านกลับมาทำงานทันที
  -- (นำเข้าต้องไม่มีสินทรัพย์เดิม: ลบ b1 ของ B ด้วยสิทธิ์ผู้ดูแลก่อน แล้วกลับมาเป็น B)
  perform pg_temp.logout();
  delete from public.assets where user_id = ub;
  perform pg_temp.login(ub);
  r := (private.import_ledger_investments('{"assets":[{"id":"b2","name":"นำเข้า","kind":"fund","accountId":"inv9"}],"prices":[],"trades":[
     {"id":"i-sell","assetId":"b2","kind":"sell","date":"2026-11-10","units":"100000000","priceMicro":6000000,"fee":0},
     {"id":"i-buy","assetId":"b2","kind":"buy","date":"2026-11-05","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":0}]}'::jsonb))::text;
  if r not like '%"trades": 2%' then raise exception 'FAIL: T8 นำเข้าไม่ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, price_micro, fee) values ('i-over', 'b2', 'sell', '2026-11-20', '9000000000', 6000000, 0) $q$);
  if r is null or r not like '23514|%ขายเกิน%' then raise exception 'FAIL: T8 ด่านไม่กลับมาหลังนำเข้า (%)', r; end if;
  if pg_temp.ac(ub, $q$ select count(*)::int from public.trades where id = 'i-over' $q$) <> 0 then raise exception 'FAIL: T8 มีแถวค้าง'; end if;

  perform pg_temp.logout();
  raise exception 'TESTS_PASSED';
end
$t$;
