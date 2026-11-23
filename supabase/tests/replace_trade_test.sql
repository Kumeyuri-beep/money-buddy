-- ทดสอบ migration 20261123000100_replace_trade_delete_asset: public.replace_trade (แก้รายการที่บันทึกแล้ว: กลับรายการเดิม + ลงรายการใหม่ในธุรกรรมเดียว)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย rollback: TESTS_PASSED · ข้อมูลสมมติล้วน
-- หมายเหตุ: กรณี "สองเซสชันแก้รายการเดียวกันพร้อมกัน" พิสูจน์ในธุรกรรมเดียวไม่ได้ · ตรวจแทนด้วยกรณีเทียบเท่า: รายการเดิมถูกแก้ไปแล้ว (แก้ซ้ำรอบสองต้องได้ 23503 ไม่เกิดรายการซ้ำ) + basedOn ไม่ตรง 40001

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
  uc uuid := gen_random_uuid();
  r text;
  v jsonb;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000000},{"accountId":"open","amount":-500000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-rt@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-rt@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-rt@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'กองทุน ก', 'THB', 'investment'), ('inv2', 'asset', 'กองทุน ข', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุน ก', 'fund', 'inv1'), ('a2', 'กองทุน ข', 'fund', 'inv2');
  perform pg_temp.settle();

  -- เตรียม: ซื้อ 10 หน่วย (createdAt ระบุเอง เพื่อพิสูจน์ว่าวันที่เดิมคงลำดับเดิม)
  perform public.record_trade('{"id":"t-buy1","assetId":"a1","kind":"buy","date":"2026-11-05","createdAt":"2026-11-05T03:00:00.000Z","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":100}'::jsonb,
    '{"id":"e-buy1","date":"2026-11-05","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":50100},{"accountId":"w1","amount":-50100}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();

  -- T1 แก้ซื้อล่าสุด (วันเดิม): รายการ/Entry เดิมหาย · รายการใหม่เข้า · created_at เดิมคงอยู่ · ยอดกระเป๋าเปลี่ยนตาม · มีรายการของสินทรัพย์เหลือ 1
  v := public.replace_trade('t-buy1',
    '{"id":"t-buy1b","assetId":"a1","kind":"buy","date":"2026-11-05","units":"2000000000","priceMicro":5000000,"amount":100000,"fee":100}'::jsonb,
    '{"id":"e-buy1b","date":"2026-11-05","memo":"b2","source":"manual","lines":[{"accountId":"inv1","amount":100100},{"accountId":"w1","amount":-100100}]}'::jsonb, '[]'::jsonb, 1);
  perform pg_temp.settle();
  if v->>'replacedTradeId' <> 't-buy1' or v->>'tradeId' <> 't-buy1b' then raise exception 'FAIL: T1 ผลที่คืนไม่ตรง (%)', v; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-buy1' and user_id = %L) + (select count(*) from public.entries where id = 'e-buy1' and user_id = %L) + (select count(*) from public.lines where entry_id = 'e-buy1' and user_id = %L) $q$, ua, ua, ua)) <> 0 then raise exception 'FAIL: T1 รายการ/Entry เดิมไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 't-buy1b' and user_id = %L and units = '2000000000' and amount = 100000 and created_at = timestamptz '2026-11-05T03:00:00Z' and entry_id = 'e-buy1b' $q$, ua)) <> 1 then raise exception 'FAIL: T1 รายการใหม่ไม่ตรง (units/amount/created_at/entry)'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where asset_id = 'a1' and user_id = %L $q$, ua)) <> 1 then raise exception 'FAIL: T1 ต้องเหลือรายการของ a1 แค่ 1'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'w1' and user_id = %L $q$, ua)) <> 500000000 - 100100 then raise exception 'FAIL: T1 ยอดกระเป๋าไม่ตรง'; end if;

  -- T1b แก้รายการเดิมซ้ำอีกรอบ (รายการเดิมถูกแก้ไปแล้ว = เทียบเท่าแท็บที่สองมาช้า) ต้องล้ม 23503 ไม่เกิดรายการซ้ำ
  r := pg_temp.fails($q$ select public.replace_trade('t-buy1',
    '{"id":"t-buy1c","assetId":"a1","kind":"buy","date":"2026-11-05","units":"2000000000","priceMicro":5000000,"amount":100000,"fee":100}'::jsonb,
    '{"id":"e-buy1c","date":"2026-11-05","source":"manual","lines":[{"accountId":"inv1","amount":100100},{"accountId":"w1","amount":-100100}]}'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T1b แก้รายการเดิมซ้ำต้อง 23503 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where asset_id = 'a1' and user_id = %L $q$, ua)) <> 1 then raise exception 'FAIL: T1b เกิดรายการซ้ำ'; end if;

  -- T2 เปลี่ยนวันที่: created_at ใหม่ (ไม่ใช่ค่าเดิม)
  perform public.replace_trade('t-buy1b',
    '{"id":"t-buy1c","assetId":"a1","kind":"buy","date":"2026-11-06","units":"2000000000","priceMicro":5000000,"amount":100000,"fee":100}'::jsonb,
    '{"id":"e-buy1c","date":"2026-11-06","memo":"b3","source":"manual","lines":[{"accountId":"inv1","amount":100100},{"accountId":"w1","amount":-100100}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 't-buy1c' and user_id = %L and date = '2026-11-06' and created_at <> timestamptz '2026-11-05T03:00:00Z' $q$, ua)) <> 1 then raise exception 'FAIL: T2 เปลี่ยนวันที่แล้ว created_at ไม่ใช่ค่าใหม่'; end if;

  -- เตรียมขาย 4 หน่วย @6.00 ค่าธรรมเนียม 0.10 (ต้นทุนเฉลี่ย 5005/หน่วย → ตัดต้นทุน 20020 · ขาดทุน 17630)
  perform public.record_trade('{"id":"t-sell1","assetId":"a1","kind":"sell","date":"2026-11-10","createdAt":"2026-11-10T04:00:00.000Z","units":"400000000","priceMicro":6000000,"fee":10}'::jsonb,
    '{"id":"e-sell1","date":"2026-11-10","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":2390},{"accountId":"inv1","amount":-20020},{"accountId":"inv-loss","amount":17630}]}'::jsonb, '[{"id":"inv-loss"}]'::jsonb);
  perform pg_temp.settle();

  -- T3 แก้ซื้อที่มีรายการขายตามหลัง (วันที่ ≤ วันขายล่าสุด) ถูกปฏิเสธ 23514 · ทุกอย่างเดิมยังอยู่
  r := pg_temp.fails($q$ select public.replace_trade('t-buy1c',
    '{"id":"t-buy1d","assetId":"a1","kind":"buy","date":"2026-11-06","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":0}'::jsonb,
    '{"id":"e-buy1d","date":"2026-11-06","source":"manual","lines":[{"accountId":"inv1","amount":50000},{"accountId":"w1","amount":-50000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ขายล่าสุด%' then raise exception 'FAIL: T3 แก้ซื้อที่มีขายตามหลังต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-buy1c' and user_id = %L) + (select count(*) from public.entries where id = 'e-buy1c' and user_id = %L) + (select count(*) from public.trades where id = 't-buy1d' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T3 รายการเดิมหาย/รายการใหม่เข้าทั้งที่ถูกปฏิเสธ'; end if;

  -- T4 แก้ขายล่าสุด (วันเดิม → created_at เดิมคงอยู่): ขาย 3 หน่วย ต้นทุนที่ตัดออก 15015 ขาดทุน 13225
  perform public.replace_trade('t-sell1',
    '{"id":"t-sell1b","assetId":"a1","kind":"sell","date":"2026-11-10","units":"300000000","priceMicro":6000000,"fee":10}'::jsonb,
    '{"id":"e-sell1b","date":"2026-11-10","memo":"s2","source":"manual","lines":[{"accountId":"w1","amount":1790},{"accountId":"inv1","amount":-15015},{"accountId":"inv-loss","amount":13225}]}'::jsonb, '[]'::jsonb, 2);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 't-sell1b' and user_id = %L and created_at = timestamptz '2026-11-10T04:00:00Z' and units = '300000000' $q$, ua)) <> 1 then raise exception 'FAIL: T4 แก้ขายล่าสุดไม่สำเร็จ หรือ created_at ไม่คงเดิม'; end if;

  -- T5 มีขายครั้งที่สองแล้ว แก้ขายที่ไม่ใช่ล่าสุดถูกปฏิเสธ · แก้ขายล่าสุดแล้วขายเกินหน่วยที่ถือถูกปฏิเสธและย้อนกลับทั้งหมด
  perform public.record_trade('{"id":"t-sell2","assetId":"a1","kind":"sell","date":"2026-11-12","units":"100000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-sell2","date":"2026-11-12","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":600},{"accountId":"inv1","amount":-5005},{"accountId":"inv-loss","amount":4405}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('t-sell1b',
    '{"id":"t-sell1c","assetId":"a1","kind":"sell","date":"2026-11-10","units":"100000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-sell1c","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":600},{"accountId":"inv1","amount":-5005},{"accountId":"inv-loss","amount":4405}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ขายล่าสุด%' then raise exception 'FAIL: T5 แก้ขายที่ไม่ใช่ล่าสุดต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-sell2',
    '{"id":"t-sell2b","assetId":"a1","kind":"sell","date":"2026-11-12","units":"9000000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"e-sell2b","date":"2026-11-12","source":"manual","lines":[{"accountId":"w1","amount":54000},{"accountId":"inv1","amount":-5005},{"accountId":"inv-gain","amount":-48995}]}'::jsonb, '[{"id":"inv-gain"}]'::jsonb) $q$);
  if r is null or r not like '23514|%ขายเกิน%' then raise exception 'FAIL: T5 ขายเกินหลังแก้ต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-sell2' and user_id = %L) + (select count(*) from public.entries where id = 'e-sell2' and user_id = %L) + (select count(*) from public.trades where id = 't-sell2b' and user_id = %L) * 100 + (select count(*) from public.accounts where id = 'inv-gain' and user_id = %L) * 1000 $q$, ua, ua, ua, ua)) <> 2 then raise exception 'FAIL: T5 ล้มแล้วไม่ย้อนกลับครบ (รายการเดิม/Entry เดิม/บัญชีที่สร้างใหม่)'; end if;

  -- T6 ปันผลเงินสด: แก้ได้เสมอ (แม้วันที่ก่อนรายการขาย) · Entry ใหม่ไม่ตรง (ปันผลไม่ตรงยอด) ถูกปฏิเสธและย้อนกลับ
  perform public.record_trade('{"id":"t-div","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":1000,"withholding":100}'::jsonb,
    '{"id":"e-div","date":"2026-11-02","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb, '[{"id":"inv-dividend"},{"id":"inv-wht"}]'::jsonb);
  perform pg_temp.settle();
  perform public.replace_trade('t-div',
    '{"id":"t-div2","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"e-div2","date":"2026-11-02","memo":"d2","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('t-div2',
    '{"id":"t-div3","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"e-div3","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-1999}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T6 Entry ไม่ตรงรายการต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-div2' and user_id = %L) + (select count(*) from public.entries where id = 'e-div2' and user_id = %L) + (select count(*) from public.trades where id = 't-div3' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T6 ล้มแล้วไม่ย้อนกลับ'; end if;

  -- T7 เปลี่ยนชนิด/ย้ายสินทรัพย์ไม่ได้ · basedOn ไม่ตรง 40001 · basedOn ใน p_trade 22023 · ไม่พบรายการ 23503 · รูปแบบผิด 22023
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x1","assetId":"a1","kind":"buy","date":"2026-11-13","units":"100000000","priceMicro":5000000,"amount":500,"fee":0}'::jsonb,
    '{"id":"ex1","date":"2026-11-13","source":"manual","lines":[{"accountId":"inv1","amount":500},{"accountId":"w1","amount":-500}]}'::jsonb) $q$);
  if r is null or r not like '23514|%เปลี่ยนชนิด%' then raise exception 'FAIL: T7 เปลี่ยนชนิดต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x2","assetId":"a2","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"ex2","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ย้ายรายการ%' then raise exception 'FAIL: T7 ย้ายสินทรัพย์ต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x3","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"ex3","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb, '[]'::jsonb, 99) $q$);
  if r is null or r not like '40001|%' then raise exception 'FAIL: T7 basedOn ไม่ตรงต้อง 40001 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x4","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200,"basedOn":0}'::jsonb,
    '{"id":"ex4","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T7 basedOn ใน p_trade ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('no-such', '{}'::jsonb, '{}'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T7 ไม่พบรายการต้อง 23503 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '[]'::jsonb, '{}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T7 รูปแบบผิดต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails(format($q$ select public.replace_trade('t-div2', jsonb_build_object('id', 'x5', 'assetId', 'a1', 'kind', 'dividend', 'date', '2026-11-02', 'amount', 1, 'junk', repeat('x', 17000)), '{}'::jsonb) $q$));
  if r is null or r not like '22023|%' then raise exception 'FAIL: T7 JSON เกินเพดานต้อง 22023 (ได้ %)', r; end if;

  -- T8 รายการที่ไม่ผูกสมุด (ข้อมูลยุคแรก) แก้ไม่ได้ 23514
  insert into public.trades (id, asset_id, kind, date, amount) values ('t-noentry', 'a2', 'dividend', '2026-11-03', 500);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('t-noentry', '{"id":"x6","assetId":"a2","kind":"dividend","date":"2026-11-03","amount":500}'::jsonb,
    '{"id":"ex6","date":"2026-11-03","source":"manual","lines":[{"accountId":"w1","amount":500},{"accountId":"inv-dividend","amount":-500}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ไม่ผูก%' then raise exception 'FAIL: T8 รายการที่ไม่ผูกสมุดต้อง 23514 (ได้ %)', r; end if;

  -- T9 USD: ใช้ record_trade_fx ผ่านฟังก์ชันนี้ · ต้นทุนบาทปัดเป็น 0 สตางค์ถูกปฏิเสธและย้อนกลับ
  insert into public.accounts (id, type, name, currency, kind) values ('usd-cash', 'asset', 'เงินสด USD', 'USD', 'investment'), ('inv-us', 'asset', 'หุ้นสหรัฐ ก', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us1', 'หุ้นสหรัฐ ก', 'stock', 'inv-us', 'USD', 'ABC', 'NASDAQ');
  perform pg_temp.settle();
  perform public.record_fx_exchange(
    '{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":3500000,"usdCents":100000,"memo":"แลก"}'::jsonb,
    '{"id":"fx1-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-3500000},{"accountId":"fx-suspense-thb","amount":3500000},{"accountId":"usd-cash","amount":100000},{"accountId":"fx-suspense-usd","amount":-100000}]}'::jsonb,
    '[{"id":"fx-suspense-thb"},{"id":"fx-suspense-usd"}]'::jsonb);
  perform public.record_trade_fx(
    '{"id":"ub1","assetId":"us1","kind":"buy","date":"2026-11-03","units":"1000000000","priceMicro":100000000,"amount":100000,"fee":100,"fxRateMicro":35000000,"basedOn":0}'::jsonb,
    '{"id":"ub1-e","date":"2026-11-03","memo":"buy","source":"manual","lines":[{"accountId":"inv-us","amount":100100},{"accountId":"usd-cash","amount":-100100}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  v := public.replace_trade('ub1',
    '{"id":"ub1b","assetId":"us1","kind":"buy","date":"2026-11-03","units":"500000000","priceMicro":100000000,"amount":50000,"fee":100,"fxRateMicro":35000000}'::jsonb,
    '{"id":"ub1b-e","date":"2026-11-03","memo":"buy2","source":"manual","lines":[{"accountId":"inv-us","amount":50100},{"accountId":"usd-cash","amount":-50100}]}'::jsonb, '[]'::jsonb, 1);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'ub1b' and user_id = %L and fx_rate_micro = 35000000 and units = '500000000' $q$, ua)) <> 1 then raise exception 'FAIL: T9 รายการ USD ใหม่ไม่ตรง'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'ub1' and user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T9 รายการ USD เดิมไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'usd-cash' and user_id = %L $q$, ua)) <> 100000 - 50100 then raise exception 'FAIL: T9 ยอดเงินสด USD ไม่ตรง'; end if;
  r := pg_temp.fails($q$ select public.replace_trade('ub1b',
    '{"id":"ub1c","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","priceMicro":100000000,"amount":1,"fee":0,"fxRateMicro":200000}'::jsonb,
    '{"id":"ub1c-e","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":1},{"accountId":"usd-cash","amount":-1}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T9 ต้นทุนบาทปัดเป็น 0 ต้องถูกปฏิเสธ (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 'ub1b' and user_id = %L) + (select count(*) from public.entries where id = 'ub1b-e' and user_id = %L) + (select count(*) from public.trades where id = 'ub1c' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T9 ล้มแล้วไม่ย้อนกลับ'; end if;

  -- T10 ผู้ใช้อื่นแก้รายการของเราไม่ได้ (RLS: ไม่พบ 23503) · ยังไม่เปลี่ยนรหัส 42501 · anon เรียกไม่ได้ · ระหว่างนำเข้า 55000
  perform pg_temp.login(ub);
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"y1","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":1}'::jsonb,
    '{"id":"ey1","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1},{"accountId":"inv-dividend","amount":-1}]}'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T10 B แก้รายการของ A ต้อง 23503 (ได้ %)', r; end if;
  perform pg_temp.login(uc);
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{}'::jsonb, '{}'::jsonb) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T10 ยังไม่เปลี่ยนรหัสต้อง 42501 (ได้ %)', r; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{}'::jsonb, '{}'::jsonb) $q$);
  execute 'reset role';
  if r is null or r not like '42501|%' then raise exception 'FAIL: T10 anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);
  perform pg_temp.login(ua);
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"y2","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":1}'::jsonb, '{"id":"ey2"}'::jsonb) $q$);
  if r is null or r not like '55000|%' then raise exception 'FAIL: T10 ระหว่างนำเข้าต้อง 55000 (ได้ %)', r; end if;
  perform pg_temp.logout();
  delete from private.import_sessions where user_id = ua;

  -- T11 สิทธิ์ในแคตตาล็อก: authenticated เท่านั้น · security invoker + search_path ว่าง
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'replace_trade' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
         and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) <> 1 then
    raise exception 'FAIL: T11 สิทธิ์/ชนิดฟังก์ชันไม่ตรง';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
