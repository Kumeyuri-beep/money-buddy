-- ทดสอบ migration 20261123000100_replace_trade_delete_asset: public.replace_trade (แก้รายการที่บันทึกแล้ว: กลับรายการเดิม + ลงรายการใหม่ในธุรกรรมเดียว)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย rollback: TESTS_PASSED · ข้อมูลสมมติล้วน
-- หมายเหตุ: กรณี "สองเซสชันแก้รายการเดียวกันพร้อมกัน" พิสูจน์ในธุรกรรมเดียวไม่ได้ · ตรวจแทนด้วยกรณีเทียบเท่า: รายการเดิมถูกแก้ไปแล้ว (แก้ซ้ำรอบสองต้องได้ 23503 ไม่เกิดรายการซ้ำ) + basedOn ไม่ตรง PT409

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
create function pg_temp.need(p_ids text[]) returns jsonb language sql as $$ select coalesce(jsonb_agg(jsonb_build_object('id', i)), '[]'::jsonb) from unnest(p_ids) i where not exists (select 1 from public.accounts a where a.id = i) $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.ac(uuid, text), pg_temp.need(text[]) to public;

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

  -- T7 เปลี่ยนชนิด/ย้ายสินทรัพย์ไม่ได้ · basedOn ไม่ตรง PT409 · basedOn ใน p_trade 22023 · ไม่พบรายการ 23503 · รูปแบบผิด 22023
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x1","assetId":"a1","kind":"buy","date":"2026-11-13","units":"100000000","priceMicro":5000000,"amount":500,"fee":0}'::jsonb,
    '{"id":"ex1","date":"2026-11-13","source":"manual","lines":[{"accountId":"inv1","amount":500},{"accountId":"w1","amount":-500}]}'::jsonb) $q$);
  if r is null or r not like '23514|%เปลี่ยนชนิด%' then raise exception 'FAIL: T7 เปลี่ยนชนิดต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x2","assetId":"a2","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"ex2","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ย้ายรายการ%' then raise exception 'FAIL: T7 ย้ายสินทรัพย์ต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-div2', '{"id":"x3","assetId":"a1","kind":"dividend","date":"2026-11-02","amount":2000,"withholding":200}'::jsonb,
    '{"id":"ex3","date":"2026-11-02","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb, '[]'::jsonb, 99) $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T7 basedOn ไม่ตรงต้อง PT409 (ได้ %)', r; end if;
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

  -- ===== เทสต์เพิ่มตามข้อแนะนำผู้ตรวจ (§102.2 ข้อ 3) T12-T17 · ใช้สินทรัพย์ใหม่ a3 a4 a5 us2 ไม่ยุ่งกับข้อมูลของ T1-T11 =====
  perform pg_temp.login(ua);
  insert into public.accounts (id, type, name, currency, kind) values ('inv3', 'asset', 'กองทุน ค', 'THB', 'investment'), ('inv4', 'asset', 'กองทุน ง', 'THB', 'investment'), ('inv5', 'asset', 'กองทุน จ', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a3', 'กองทุน ค', 'fund', 'inv3'), ('a4', 'กองทุน ง', 'fund', 'inv4'), ('a5', 'กองทุน จ', 'fund', 'inv5');
  perform pg_temp.settle();

  -- T12 ย้ายวันที่ซื้อข้ามวันขาย: ซื้อ 10 หน่วย (ต้นทุน 50100) · ขาย 4 หน่วยวันที่ 11-10 (ตัดต้นทุน 20040 ขาดทุน 17640) · ซื้อเพิ่มวันที่ 11-12
  perform public.record_trade('{"id":"m-b1","assetId":"a3","kind":"buy","date":"2026-11-01","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":100}'::jsonb,
    '{"id":"m-b1-e","date":"2026-11-01","memo":"b","source":"manual","lines":[{"accountId":"inv3","amount":50100},{"accountId":"w1","amount":-50100}]}'::jsonb, '[]'::jsonb);
  perform public.record_trade('{"id":"m-s1","assetId":"a3","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"m-s1-e","date":"2026-11-10","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":2400},{"accountId":"inv3","amount":-20040},{"accountId":"inv-loss","amount":17640}]}'::jsonb, pg_temp.need(array['inv-loss']));
  perform public.record_trade('{"id":"m-b2","assetId":"a3","kind":"buy","date":"2026-11-12","units":"500000000","priceMicro":5000000,"amount":25000,"fee":0}'::jsonb,
    '{"id":"m-b2-e","date":"2026-11-12","memo":"b","source":"manual","lines":[{"accountId":"inv3","amount":25000},{"accountId":"w1","amount":-25000}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('m-b2',
    '{"id":"m-b2x","assetId":"a3","kind":"buy","date":"2026-11-05","units":"500000000","priceMicro":5000000,"amount":25000,"fee":0}'::jsonb,
    '{"id":"m-b2x-e","date":"2026-11-05","source":"manual","lines":[{"accountId":"inv3","amount":25000},{"accountId":"w1","amount":-25000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%หลังรายการขายล่าสุด%' then raise exception 'FAIL: T12 ย้ายวันที่ซื้อไปก่อนวันขายต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 'm-b2' and user_id = %L) + (select count(*) from public.entries where id = 'm-b2-e' and user_id = %L) + (select count(*) from public.trades where id = 'm-b2x' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T12 ล้มแล้วรายการเดิมหาย/รายการใหม่เข้า'; end if;
  perform public.replace_trade('m-b2',
    '{"id":"m-b2y","assetId":"a3","kind":"buy","date":"2026-11-15","units":"500000000","priceMicro":5000000,"amount":25000,"fee":0}'::jsonb,
    '{"id":"m-b2y-e","date":"2026-11-15","source":"manual","lines":[{"accountId":"inv3","amount":25000},{"accountId":"w1","amount":-25000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'm-b2y' and user_id = %L and date = '2026-11-15' $q$, ua)) <> 1 then raise exception 'FAIL: T12 ย้ายซื้อไปหลังวันขายต้องผ่าน'; end if;

  -- T13 แก้ซื้อที่มีปันผลเงินสดและปันผลลงทุนต่อตามหลัง (ไม่มีรายการขาย): แก้ได้ · ปันผลทั้งสองยังอยู่ · จำนวนหน่วยรวมตรงรายการใหม่
  perform public.record_trade('{"id":"c1","assetId":"a4","kind":"buy","date":"2026-11-01","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":0}'::jsonb,
    '{"id":"c1-e","date":"2026-11-01","memo":"b","source":"manual","lines":[{"accountId":"inv4","amount":50000},{"accountId":"w1","amount":-50000}]}'::jsonb, '[]'::jsonb);
  perform public.record_trade('{"id":"d1","assetId":"a4","kind":"dividend","date":"2026-11-03","amount":1000,"withholding":100}'::jsonb,
    '{"id":"d1-e","date":"2026-11-03","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb, pg_temp.need(array['inv-dividend', 'inv-wht']));
  perform public.record_trade('{"id":"r1","assetId":"a4","kind":"reinvest","date":"2026-11-04","units":"10000000","amount":500}'::jsonb,
    '{"id":"r1-e","date":"2026-11-04","memo":"r","source":"manual","lines":[{"accountId":"inv4","amount":500},{"accountId":"inv-dividend","amount":-500}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  perform public.replace_trade('c1',
    '{"id":"c1b","assetId":"a4","kind":"buy","date":"2026-11-01","units":"2000000000","priceMicro":5000000,"amount":100000,"fee":0}'::jsonb,
    '{"id":"c1b-e","date":"2026-11-01","memo":"b2","source":"manual","lines":[{"accountId":"inv4","amount":100000},{"accountId":"w1","amount":-100000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id in ('d1', 'r1', 'c1b') and user_id = %L) + (select count(*) from public.trades where id = 'c1' and user_id = %L) * 100 + (select count(*) from public.entries where id in ('d1-e', 'r1-e', 'c1b-e') and user_id = %L) * 10 $q$, ua, ua, ua)) <> 33 then raise exception 'FAIL: T13 แก้ซื้อแล้วปันผล/รายการใหม่ไม่ครบ หรือรายการเดิมไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(units::numeric), 0)::bigint from public.trades where asset_id = 'a4' and kind in ('buy', 'reinvest') and user_id = %L $q$, ua)) <> 2010000000 then raise exception 'FAIL: T13 หน่วยรวมของ a4 ไม่ตรง'; end if;

  -- T14 แก้ปันผลลงทุนต่อ (reinvest) ได้ตราบที่ยังไม่มีรายการขาย · หลังมีรายการขาย: แก้ reinvest ที่วันที่ ≤ วันขายถูกปฏิเสธ แต่แก้ปันผลเงินสดได้
  perform public.replace_trade('r1',
    '{"id":"r1b","assetId":"a4","kind":"reinvest","date":"2026-11-04","units":"20000000","amount":1000}'::jsonb,
    '{"id":"r1b-e","date":"2026-11-04","memo":"r2","source":"manual","lines":[{"accountId":"inv4","amount":1000},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'r1b' and user_id = %L and kind = 'reinvest' and units = '20000000' and amount = 1000 $q$, ua)) <> 1 then raise exception 'FAIL: T14 รายการ reinvest ใหม่ไม่ตรง'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'r1' and user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T14 reinvest เดิมไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'inv4' and user_id = %L $q$, ua)) <> 101000 then raise exception 'FAIL: T14 ยอดบัญชีต้นทุน a4 ไม่ตรง'; end if;
  -- ขาย 5 หน่วยจากที่ถือ 20.2 หน่วย: ตัดต้นทุน 101000 × 5 / 20.2 = 25000 พอดี · ขาดทุน 22000
  perform public.record_trade('{"id":"s4","assetId":"a4","kind":"sell","date":"2026-11-10","units":"500000000","priceMicro":6000000,"fee":0}'::jsonb,
    '{"id":"s4-e","date":"2026-11-10","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":3000},{"accountId":"inv4","amount":-25000},{"accountId":"inv-loss","amount":22000}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('r1b',
    '{"id":"r1c","assetId":"a4","kind":"reinvest","date":"2026-11-04","units":"20000000","amount":1000}'::jsonb,
    '{"id":"r1c-e","date":"2026-11-04","source":"manual","lines":[{"accountId":"inv4","amount":1000},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ขายล่าสุด%' then raise exception 'FAIL: T14 แก้ reinvest ที่อยู่ก่อนวันขายต้อง 23514 (ได้ %)', r; end if;
  perform public.replace_trade('d1',
    '{"id":"d1b","assetId":"a4","kind":"dividend","date":"2026-11-03","amount":2000,"withholding":200}'::jsonb,
    '{"id":"d1b-e","date":"2026-11-03","memo":"d2","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id in ('d1b', 'r1b', 's4') and user_id = %L) + (select count(*) from public.trades where id in ('d1', 'r1c') and user_id = %L) * 100 $q$, ua, ua)) <> 3 then raise exception 'FAIL: T14 หลังแก้/ปฏิเสธ รายการไม่ตรง'; end if;

  -- T15 USD: แก้รายการขายและปันผลของหุ้น USD (ต้นทุนเฉลี่ยและสมุด USD ยังสมดุล) · ตัดต้นทุนผิด 1 เซนต์ถูกปฏิเสธและย้อนกลับ
  insert into public.accounts (id, type, name, currency, kind) values ('usd-c2', 'asset', 'เงินสด USD 2', 'USD', 'investment'), ('inv-us2', 'asset', 'หุ้นสหรัฐ ข', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us2', 'หุ้นสหรัฐ ข', 'stock', 'inv-us2', 'USD', 'XYZ', 'NASDAQ');
  perform pg_temp.settle();
  perform public.record_fx_exchange(
    '{"id":"fx2","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"memo":"แลก"}'::jsonb,
    '{"id":"fx2-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-7000000},{"accountId":"fx-suspense-thb","amount":7000000},{"accountId":"usd-c2","amount":200000},{"accountId":"fx-suspense-usd","amount":-200000}]}'::jsonb,
    pg_temp.need(array['fx-suspense-thb', 'fx-suspense-usd']));
  perform public.record_trade_fx('{"id":"u-b1","assetId":"us2","kind":"buy","date":"2026-11-03","units":"1000000000","priceMicro":100000000,"amount":100000,"fee":100,"fxRateMicro":35000000}'::jsonb,
    '{"id":"u-b1-e","date":"2026-11-03","memo":"buy","source":"manual","lines":[{"accountId":"inv-us2","amount":100100},{"accountId":"usd-c2","amount":-100100}]}'::jsonb, '[]'::jsonb);
  perform public.record_trade_fx('{"id":"u-s1","assetId":"us2","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":120000000,"fee":100,"fxRateMicro":33000000}'::jsonb,
    '{"id":"u-s1-e","date":"2026-11-10","memo":"sell","source":"manual","lines":[{"accountId":"usd-c2","amount":47900},{"accountId":"inv-us2","amount":-40040},{"accountId":"inv-gain-usd","amount":-7860}]}'::jsonb, pg_temp.need(array['inv-gain-usd']));
  perform public.record_trade_fx('{"id":"u-d1","assetId":"us2","kind":"dividend","date":"2026-11-12","amount":5000,"withholding":750,"fxRateMicro":34567891}'::jsonb,
    '{"id":"u-d1-e","date":"2026-11-12","memo":"div","source":"manual","lines":[{"accountId":"usd-c2","amount":4250},{"accountId":"inv-wht-usd","amount":750},{"accountId":"inv-dividend-usd","amount":-5000}]}'::jsonb, pg_temp.need(array['inv-dividend-usd', 'inv-wht-usd']));
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('u-s1',
    '{"id":"u-s1x","assetId":"us2","kind":"sell","date":"2026-11-10","units":"300000000","priceMicro":120000000,"fee":100,"fxRateMicro":33000000}'::jsonb,
    '{"id":"u-s1x-e","date":"2026-11-10","source":"manual","lines":[{"accountId":"usd-c2","amount":35900},{"accountId":"inv-us2","amount":-30029},{"accountId":"inv-gain-usd","amount":-5870}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T15 สมุดไม่สมดุล 1 เซนต์ต้องถูกปฏิเสธ (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 'u-s1' and user_id = %L) + (select count(*) from public.entries where id = 'u-s1-e' and user_id = %L) + (select count(*) from public.trades where id = 'u-s1x' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T15 ล้มแล้วไม่ย้อนกลับ'; end if;
  -- ขาย 3 หน่วย: net 35,900 · ตัดต้นทุน 30,030 · กำไร 5,870
  perform public.replace_trade('u-s1',
    '{"id":"u-s1b","assetId":"us2","kind":"sell","date":"2026-11-10","units":"300000000","priceMicro":120000000,"fee":100,"fxRateMicro":33000000}'::jsonb,
    '{"id":"u-s1b-e","date":"2026-11-10","memo":"sell2","source":"manual","lines":[{"accountId":"usd-c2","amount":35900},{"accountId":"inv-us2","amount":-30030},{"accountId":"inv-gain-usd","amount":-5870}]}'::jsonb);
  perform public.replace_trade('u-d1',
    '{"id":"u-d1b","assetId":"us2","kind":"dividend","date":"2026-11-12","amount":6000,"withholding":900,"fxRateMicro":34567891}'::jsonb,
    '{"id":"u-d1b-e","date":"2026-11-12","memo":"div2","source":"manual","lines":[{"accountId":"usd-c2","amount":5100},{"accountId":"inv-wht-usd","amount":900},{"accountId":"inv-dividend-usd","amount":-6000}]}'::jsonb);
  perform pg_temp.settle();
  -- เงินสด USD = 200,000 − 100,100 + 35,900 + 5,100 = 140,900
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'usd-c2' and user_id = %L $q$, ua)) <> 140900 then raise exception 'FAIL: T15 ยอดเงินสด USD หลังแก้ไม่ตรง'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(l.amount), 0)::bigint from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id where a.currency = 'USD' and l.user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T15 สมุด USD ไม่สมดุลหลังแก้'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(l.amount), 0)::bigint from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id where a.currency = 'THB' and l.user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T15 สมุดบาทไม่สมดุลหลังแก้'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id in ('u-s1b', 'u-d1b') and user_id = %L and fx_rate_micro in (33000000, 34567891) $q$, ua)) <> 2 then raise exception 'FAIL: T15 อัตราแลกเปลี่ยนของรายการใหม่ไม่ตรง'; end if;

  -- T16 ลำดับ created_at ในวันเดียวกัน: ซื้อสองรายการวันเดียวกัน (03:00 และ 04:00) แก้ทีละรายการวันเดิม ลำดับต้องไม่สลับ
  perform public.record_trade('{"id":"x1","assetId":"a5","kind":"buy","date":"2026-11-02","createdAt":"2026-11-02T03:00:00.000Z","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"x1-e","date":"2026-11-02","memo":"b","source":"manual","lines":[{"accountId":"inv5","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb);
  perform public.record_trade('{"id":"x2","assetId":"a5","kind":"buy","date":"2026-11-02","createdAt":"2026-11-02T04:00:00.000Z","units":"100000000","priceMicro":5000000,"amount":6000,"fee":0}'::jsonb,
    '{"id":"x2-e","date":"2026-11-02","memo":"b","source":"manual","lines":[{"accountId":"inv5","amount":6000},{"accountId":"w1","amount":-6000}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  perform public.replace_trade('x1',
    '{"id":"x1b","assetId":"a5","kind":"buy","date":"2026-11-02","units":"100000000","priceMicro":5000000,"amount":5500,"fee":0}'::jsonb,
    '{"id":"x1b-e","date":"2026-11-02","memo":"b","source":"manual","lines":[{"accountId":"inv5","amount":5500},{"accountId":"w1","amount":-5500}]}'::jsonb);
  perform public.replace_trade('x2',
    '{"id":"x2b","assetId":"a5","kind":"buy","date":"2026-11-02","units":"100000000","priceMicro":5000000,"amount":6500,"fee":0}'::jsonb,
    '{"id":"x2b-e","date":"2026-11-02","memo":"b","source":"manual","lines":[{"accountId":"inv5","amount":6500},{"accountId":"w1","amount":-6500}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where asset_id = 'a5' and user_id = %L and ((id = 'x1b' and created_at = timestamptz '2026-11-02T03:00:00Z') or (id = 'x2b' and created_at = timestamptz '2026-11-02T04:00:00Z')) $q$, ua)) <> 2 then raise exception 'FAIL: T16 created_at ของสองรายการวันเดียวกันไม่คงเดิม'; end if;

  -- T17 ค่าขอบ: ขายได้ 0 สตางค์ถูกปฏิเสธ · ค่าธรรมเนียมเกินเงินขาย 1 สตางค์ถูกปฏิเสธ · ค่าธรรมเนียมเท่าเงินขายพอดี (เงินเข้า 0) ผ่านและขาดทุน = ต้นทุนที่ตัดออกทั้งก้อน
  r := pg_temp.fails($q$ select public.replace_trade('m-s1',
    '{"id":"m-s1x","assetId":"a3","kind":"sell","date":"2026-11-10","units":"1","priceMicro":1,"fee":0}'::jsonb,
    '{"id":"m-s1x-e","date":"2026-11-10","source":"manual","lines":[{"accountId":"inv3","amount":-1},{"accountId":"inv-loss","amount":1}]}'::jsonb) $q$);
  if r is null or r not like '23514|%0 สตางค์%' then raise exception 'FAIL: T17 ขายได้ 0 สตางค์ต้อง 23514 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('m-s1',
    '{"id":"m-s1x","assetId":"a3","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":6000000,"fee":2401}'::jsonb,
    '{"id":"m-s1x-e","date":"2026-11-10","source":"manual","lines":[{"accountId":"inv3","amount":-20040},{"accountId":"inv-loss","amount":20040}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ค่าธรรมเนียม%' then raise exception 'FAIL: T17 ค่าธรรมเนียมเกินเงินขายต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 'm-s1' and user_id = %L) + (select count(*) from public.entries where id = 'm-s1-e' and user_id = %L) + (select count(*) from public.trades where id = 'm-s1x' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T17 ล้มแล้วไม่ย้อนกลับ'; end if;
  perform public.replace_trade('m-s1',
    '{"id":"m-s1y","assetId":"a3","kind":"sell","date":"2026-11-10","units":"400000000","priceMicro":6000000,"fee":2400}'::jsonb,
    '{"id":"m-s1y-e","date":"2026-11-10","source":"manual","lines":[{"accountId":"inv3","amount":-20040},{"accountId":"inv-loss","amount":20040}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 'm-s1y' and user_id = %L and fee = 2400 $q$, ua)) <> 1 then raise exception 'FAIL: T17 ค่าธรรมเนียมเท่าเงินขายพอดีต้องผ่าน'; end if;
  perform pg_temp.logout();

  -- T18 สิทธิ์ในแคตตาล็อก: authenticated เท่านั้น · security invoker + search_path ว่าง
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'replace_trade' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
         and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) <> 1 then
    raise exception 'FAIL: T18 สิทธิ์/ชนิดฟังก์ชันไม่ตรง';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
