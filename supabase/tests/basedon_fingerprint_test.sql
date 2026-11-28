-- ทดสอบ migration 20261124000100_basedon_fingerprint: basedOn เป็นลายนิ้วมือรายการ (private.trades_fingerprint) ใน record_trade / record_trade_fx / replace_trade
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย rollback: TESTS_PASSED · ข้อมูลสมมติล้วน
-- จุดสำคัญ: แก้รายการ (ลบ 1 เพิ่ม 1) จำนวนรายการเท่าเดิม แต่ลายนิ้วมือเปลี่ยน → แท็บที่คำนวณต้นทุนจากข้อมูลเก่าต้องได้ PT409

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
  r text;
  fp_empty text := encode(sha256(convert_to('0' || E'\n', 'UTF8')), 'hex');
  f0 text; f1 text; f2 text; f3 text; f4 text;
  n bigint;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000000},{"accountId":"open","amount":-500000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-fp@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-fp@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'กองทุน ก', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุน ก', 'fund', 'inv1');
  perform pg_temp.settle();

  -- T1 สินทรัพย์ว่าง: ลายนิ้วมือ = sha256 ของ "0\n" (สูตรเดียวกับฝั่งเว็บ) · เรียกซ้ำได้ค่าเดิม
  f0 := private.trades_fingerprint(ua, 'a1');
  if f0 is distinct from fp_empty then raise exception 'FAIL: T1 ลายนิ้วมือสินทรัพย์ว่างไม่ใช่ sha256 ของ "0\n" (%)', f0; end if;
  if private.trades_fingerprint(ua, 'a1') is distinct from f0 then raise exception 'FAIL: T1 เรียกซ้ำแล้วค่าเปลี่ยน'; end if;

  -- T2 record_trade ด้วยลายนิ้วมือที่ตรง ผ่าน · ลายนิ้วมือเปลี่ยน · ใช้ค่าเก่า (ว่าง) ซ้ำถูกปฏิเสธ PT409 และไม่เขียนแถว
  perform public.record_trade(jsonb_build_object('id', 't-b1', 'assetId', 'a1', 'kind', 'buy', 'date', '2026-11-05', 'units', '1000000000', 'priceMicro', 5000000, 'amount', 50000, 'fee', 100, 'basedOn', f0),
    '{"id":"e-b1","date":"2026-11-05","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":50100},{"accountId":"w1","amount":-50100}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  f1 := private.trades_fingerprint(ua, 'a1');
  if f1 = f0 then raise exception 'FAIL: T2 เพิ่มรายการแล้วลายนิ้วมือไม่เปลี่ยน'; end if;
  r := pg_temp.fails(format($q$ select public.record_trade(jsonb_build_object('id', 't-b9', 'assetId', 'a1', 'kind', 'buy', 'date', '2026-11-06', 'units', '100000000', 'priceMicro', 5000000, 'amount', 5000, 'fee', 0, 'basedOn', %L),
    '{"id":"e-b9","date":"2026-11-06","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$, f0));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T2 ลายนิ้วมือเก่าต้อง PT409 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 't-b9' and user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T2 ถูกปฏิเสธแล้วยังเขียนแถว'; end if;

  -- T3 ซื้อเพิ่ม (5 หน่วย 250.00 บาท) ด้วยลายนิ้วมือล่าสุด
  perform public.record_trade(jsonb_build_object('id', 't-b2', 'assetId', 'a1', 'kind', 'buy', 'date', '2026-11-06', 'units', '500000000', 'priceMicro', 5000000, 'amount', 25000, 'fee', 0, 'basedOn', f1),
    '{"id":"e-b2","date":"2026-11-06","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":25000},{"accountId":"w1","amount":-25000}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  f2 := private.trades_fingerprint(ua, 'a1');

  -- T4 ช่องโหว่เดิม: แก้ t-b2 (จำนวนรายการเท่าเดิม = 2) แล้วแท็บที่ถือ f2 ขายต้องถูกปฏิเสธ PT409 · ลายนิ้วมือใหม่ขายได้
  perform public.replace_trade('t-b2',
    jsonb_build_object('id', 't-b2b', 'assetId', 'a1', 'kind', 'buy', 'date', '2026-11-06', 'units', '500000000', 'priceMicro', 5000000, 'amount', 30000, 'fee', 0, 'basedOn', f2),
    '{"id":"e-b2b","date":"2026-11-06","memo":"b2","source":"manual","lines":[{"accountId":"inv1","amount":30000},{"accountId":"w1","amount":-30000}]}'::jsonb);
  perform pg_temp.settle();
  f3 := private.trades_fingerprint(ua, 'a1');
  if f3 = f2 then raise exception 'FAIL: T4 แก้รายการจำนวนเท่าเดิมแล้วลายนิ้วมือไม่เปลี่ยน'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where asset_id = 'a1' and user_id = %L $q$, ua)) <> 2 then raise exception 'FAIL: T4 จำนวนรายการต้องยังเป็น 2 (นี่คือกรณีที่นับจำนวนจับไม่ได้)'; end if;
  r := pg_temp.fails(format($q$ select public.record_trade(jsonb_build_object('id', 't-s1', 'assetId', 'a1', 'kind', 'sell', 'date', '2026-11-10', 'units', '300000000', 'priceMicro', 6000000, 'fee', 0, 'basedOn', %L),
    '{"id":"e-s1","date":"2026-11-10","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv1","amount":-16020},{"accountId":"inv-loss","amount":14220}]}'::jsonb, '[{"id":"inv-loss"}]'::jsonb) $q$, f2));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T4 แท็บเก่า (ต้นทุนจากข้อมูลก่อนแก้) ต้อง PT409 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-s1' and user_id = %L) + (select count(*) from public.accounts where id = 'inv-loss' and user_id = %L) $q$, ua, ua)) <> 0 then raise exception 'FAIL: T4 ถูกปฏิเสธแล้วยังเขียนแถว/สร้างบัญชี'; end if;
  -- ขาย 3 หน่วย: ต้นทุนรวม 50100 + 30000 = 80100 สำหรับ 15 หน่วย → ตัดออก 16020 · ขายได้ 1800 · ขาดทุน 14220
  perform public.record_trade(jsonb_build_object('id', 't-s1', 'assetId', 'a1', 'kind', 'sell', 'date', '2026-11-10', 'units', '300000000', 'priceMicro', 6000000, 'fee', 0, 'basedOn', f3),
    '{"id":"e-s1","date":"2026-11-10","memo":"s","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv1","amount":-16020},{"accountId":"inv-loss","amount":14220}]}'::jsonb, pg_temp.need(array['inv-loss']));
  perform pg_temp.settle();
  f4 := private.trades_fingerprint(ua, 'a1');

  -- T5 replace_trade: ลายนิ้วมือเก่า (f3 ไม่มีรายการขาย) ถูกปฏิเสธ PT409 ทั้งก้อนย้อนกลับ · ลายนิ้วมือล่าสุดผ่าน
  r := pg_temp.fails(format($q$ select public.replace_trade('t-s1',
    jsonb_build_object('id', 't-s1b', 'assetId', 'a1', 'kind', 'sell', 'date', '2026-11-10', 'units', '200000000', 'priceMicro', 6000000, 'fee', 0, 'basedOn', %L),
    '{"id":"e-s1b","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":1200},{"accountId":"inv1","amount":-10680},{"accountId":"inv-loss","amount":9480}]}'::jsonb) $q$, f3));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T5 replace_trade ลายนิ้วมือเก่าต้อง PT409 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.trades where id = 't-s1' and user_id = %L) + (select count(*) from public.entries where id = 'e-s1' and user_id = %L) + (select count(*) from public.trades where id = 't-s1b' and user_id = %L) * 100 $q$, ua, ua, ua)) <> 2 then raise exception 'FAIL: T5 ถูกปฏิเสธแล้วรายการเดิมหาย/รายการใหม่เข้า'; end if;
  perform public.replace_trade('t-s1',
    jsonb_build_object('id', 't-s1b', 'assetId', 'a1', 'kind', 'sell', 'date', '2026-11-10', 'units', '200000000', 'priceMicro', 6000000, 'fee', 0, 'basedOn', f4),
    '{"id":"e-s1b","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":1200},{"accountId":"inv1","amount":-10680},{"accountId":"inv-loss","amount":9480}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.trades where id = 't-s1b' and user_id = %L and units = '200000000' $q$, ua)) <> 1 then raise exception 'FAIL: T5 replace ด้วยลายนิ้วมือล่าสุดไม่สำเร็จ'; end if;

  -- T6 รูปแบบ basedOn: ลายนิ้วมือ + p_based_on พร้อมกัน 22023 · ชนิดผิด (boolean/object/ใน replace เป็นตัวเลข) 22023 · memo ไม่อยู่ในลายนิ้วมือ
  f4 := private.trades_fingerprint(ua, 'a1');
  r := pg_temp.fails(format($q$ select public.replace_trade('t-s1b',
    jsonb_build_object('id', 't-s1c', 'assetId', 'a1', 'kind', 'sell', 'date', '2026-11-10', 'units', '200000000', 'priceMicro', 6000000, 'fee', 0, 'basedOn', %L),
    '{"id":"e-s1c","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":1200},{"accountId":"inv1","amount":-10680},{"accountId":"inv-loss","amount":9480}]}'::jsonb, '[]'::jsonb, 3) $q$, f4));
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6 ลายนิ้วมือ+จำนวนพร้อมกันต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.replace_trade('t-s1b',
    '{"id":"t-s1c","assetId":"a1","kind":"sell","date":"2026-11-10","units":"200000000","priceMicro":6000000,"fee":0,"basedOn":3}'::jsonb,
    '{"id":"e-s1c","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":1200},{"accountId":"inv1","amount":-10680},{"accountId":"inv-loss","amount":9480}]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6 replace_trade basedOn เป็นตัวเลขใน p_trade ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade('{"id":"t-x","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0,"basedOn":true}'::jsonb,
    '{"id":"e-x","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6 record_trade basedOn เป็น boolean ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_trade('{"id":"t-x","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0,"basedOn":{"a":1}}'::jsonb,
    '{"id":"e-x","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6 record_trade basedOn เป็น object ต้อง 22023 (ได้ %)', r; end if;
  -- รูปแบบ basedOn: string ที่ไม่ใช่ hex 64 · ตัวเลขทศนิยม/ติดลบ/เกินช่วง integer = 22023 (ทั้ง record_trade และ replace_trade)
  foreach r in array array['"zzz"', '""', '"' || upper(f4) || '"', '1.5', '-1', '99999999999'] loop
    if coalesce(pg_temp.fails(format($q$ select public.record_trade('{"id":"t-x","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0,"basedOn":%s}'::jsonb,
      '{"id":"e-x","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$, r)), '') not like '22023|%' then
      raise exception 'FAIL: T6 record_trade basedOn % ต้อง 22023', r;
    end if;
  end loop;
  r := pg_temp.fails($q$ select public.replace_trade('t-s1b',
    '{"id":"t-s1c","assetId":"a1","kind":"sell","date":"2026-11-10","units":"200000000","priceMicro":6000000,"fee":0,"basedOn":"zzz"}'::jsonb,
    '{"id":"e-s1c","date":"2026-11-10","source":"manual","lines":[{"accountId":"w1","amount":1200},{"accountId":"inv1","amount":-10680},{"accountId":"inv-loss","amount":9480}]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6 replace_trade basedOn ไม่ใช่ hex ต้อง 22023 (ได้ %)', r; end if;
  update public.trades set memo = 'แก้โน้ต' where id = 't-b1';
  if private.trades_fingerprint(ua, 'a1') is distinct from f4 then raise exception 'FAIL: T6 แก้ memo แล้วลายนิ้วมือเปลี่ยน (memo ไม่ควรอยู่ในสูตร)'; end if;

  -- T7 แบบเดิม (ตัวเลข) ยังใช้ได้ชั่วคราว: record_trade basedOn = จำนวน ถูก/ผิด · replace_trade p_based_on ถูก/ผิด
  r := pg_temp.fails($q$ select public.record_trade('{"id":"t-l1","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0,"basedOn":99}'::jsonb,
    '{"id":"e-l1","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T7 basedOn ตัวเลขผิดต้อง PT409 (ได้ %)', r; end if;
  perform public.record_trade('{"id":"t-l1","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0,"basedOn":3}'::jsonb,
    '{"id":"e-l1","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.replace_trade('t-l1', '{"id":"t-l1b","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-l1b","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb, 99) $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T7 replace p_based_on ผิดต้อง PT409 (ได้ %)', r; end if;
  perform public.replace_trade('t-l1', '{"id":"t-l1b","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-l1b","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb, 4);
  perform pg_temp.settle();
  -- ไม่ส่ง basedOn เลย = ไม่ตรวจ (พฤติกรรมเดิม)
  perform public.replace_trade('t-l1b', '{"id":"t-l1c","assetId":"a1","kind":"buy","date":"2026-11-11","units":"100000000","priceMicro":5000000,"amount":5000,"fee":0}'::jsonb,
    '{"id":"e-l1c","date":"2026-11-11","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb);
  perform pg_temp.settle();

  -- T8 USD (record_trade_fx): ซื้อ 8 หุ้นด้วยลายนิ้วมือว่าง · แก้ (จำนวนเท่าเดิม) · แท็บเก่าขายถูกปฏิเสธ PT409 · ลายนิ้วมือใหม่ขายผ่าน
  insert into public.accounts (id, type, name, currency, kind) values ('usd-c2', 'asset', 'เงินสด USD 2', 'USD', 'investment'), ('inv-us2', 'asset', 'หุ้นสหรัฐ ข', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us2', 'หุ้นสหรัฐ ข', 'stock', 'inv-us2', 'USD', 'XYZ', 'NASDAQ');
  perform pg_temp.settle();
  perform public.record_fx_exchange(
    '{"id":"fx2","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"memo":"แลก"}'::jsonb,
    '{"id":"fx2-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-7000000},{"accountId":"fx-suspense-thb","amount":7000000},{"accountId":"usd-c2","amount":200000},{"accountId":"fx-suspense-usd","amount":-200000}]}'::jsonb,
    pg_temp.need(array['fx-suspense-thb', 'fx-suspense-usd']));
  perform public.record_trade_fx(jsonb_build_object('id', 'u-b1', 'assetId', 'us2', 'kind', 'buy', 'date', '2026-11-03', 'units', '1000000000', 'priceMicro', 100000000, 'amount', 100000, 'fee', 100, 'fxRateMicro', 35000000, 'basedOn', private.trades_fingerprint(ua, 'us2')),
    '{"id":"u-b1-e","date":"2026-11-03","memo":"buy","source":"manual","lines":[{"accountId":"inv-us2","amount":100100},{"accountId":"usd-c2","amount":-100100}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  f1 := private.trades_fingerprint(ua, 'us2');
  perform public.replace_trade('u-b1',
    jsonb_build_object('id', 'u-b1b', 'assetId', 'us2', 'kind', 'buy', 'date', '2026-11-03', 'units', '800000000', 'priceMicro', 100000000, 'amount', 80000, 'fee', 100, 'fxRateMicro', 35000000, 'basedOn', f1),
    '{"id":"u-b1b-e","date":"2026-11-03","memo":"buy2","source":"manual","lines":[{"accountId":"inv-us2","amount":80100},{"accountId":"usd-c2","amount":-80100}]}'::jsonb);
  perform pg_temp.settle();
  f2 := private.trades_fingerprint(ua, 'us2');
  if f2 = f1 then raise exception 'FAIL: T8 แก้รายการ USD แล้วลายนิ้วมือไม่เปลี่ยน'; end if;
  r := pg_temp.fails(format($q$ select public.record_trade_fx(jsonb_build_object('id', 'u-s1', 'assetId', 'us2', 'kind', 'sell', 'date', '2026-11-10', 'units', '300000000', 'priceMicro', 120000000, 'fee', 100, 'fxRateMicro', 33000000, 'basedOn', %L),
    '{"id":"u-s1-e","date":"2026-11-10","memo":"sell","source":"manual","lines":[{"accountId":"usd-c2","amount":35900},{"accountId":"inv-us2","amount":-30038},{"accountId":"inv-gain-usd","amount":-5862}]}'::jsonb, '[{"id":"inv-gain-usd"}]'::jsonb) $q$, f1));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T8 USD แท็บเก่าต้อง PT409 (ได้ %)', r; end if;
  perform public.record_trade_fx(jsonb_build_object('id', 'u-s1', 'assetId', 'us2', 'kind', 'sell', 'date', '2026-11-10', 'units', '300000000', 'priceMicro', 120000000, 'fee', 100, 'fxRateMicro', 33000000, 'basedOn', f2),
    '{"id":"u-s1-e","date":"2026-11-10","memo":"sell","source":"manual","lines":[{"accountId":"usd-c2","amount":35900},{"accountId":"inv-us2","amount":-30038},{"accountId":"inv-gain-usd","amount":-5862}]}'::jsonb, pg_temp.need(array['inv-gain-usd']));
  perform pg_temp.settle();

  -- T9 ข้ามผู้ใช้: B ขอลายนิ้วมือของสินทรัพย์ A ได้แต่เป็นของ "ว่าง" (RLS) ไม่รั่วข้อมูลของ A · ลายนิ้วมือของ A ไม่ใช้กับของ B ได้
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  if private.trades_fingerprint(ua, 'a1') is distinct from fp_empty then raise exception 'FAIL: T9 B เห็นลายนิ้วมือที่มีเนื้อหาของ A'; end if;
  if private.trades_fingerprint(ub, 'a1') is distinct from fp_empty then raise exception 'FAIL: T9 ของ B ที่ยังไม่มีรายการต้องเป็นลายนิ้วมือว่าง'; end if;
  perform private.setup_ledger(acc, ent);
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'ของ B', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a1', 'ของ B', 'fund', 'inv1');
  perform pg_temp.settle();
  r := pg_temp.fails(format($q$ select public.record_trade(jsonb_build_object('id', 'b-1', 'assetId', 'a1', 'kind', 'buy', 'date', '2026-11-05', 'units', '100000000', 'priceMicro', 5000000, 'amount', 5000, 'fee', 0, 'basedOn', %L),
    '{"id":"b-1-e","date":"2026-11-05","source":"manual","lines":[{"accountId":"inv1","amount":5000},{"accountId":"w1","amount":-5000}]}'::jsonb, '[]'::jsonb) $q$, f3));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T9 ลายนิ้วมือของ A ใช้กับสินทรัพย์รหัสเดียวกันของ B ต้อง PT409 (ได้ %)', r; end if;
  perform pg_temp.logout();

  -- T10 สิทธิ์: anon เรียกไม่ได้ · authenticated เรียกได้ · PUBLIC ไม่มี · security invoker + search_path ว่าง · สามฟังก์ชันหลักยังเป็น authenticated เท่านั้น
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'private' and p.proname = 'trades_fingerprint' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
         and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) <> 1 then
    raise exception 'FAIL: T10 สิทธิ์/ชนิดของ private.trades_fingerprint ไม่ตรง';
  end if;
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('record_trade', 'record_trade_fx', 'replace_trade') and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
         and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) <> 3 then
    raise exception 'FAIL: T10 สิทธิ์/ชนิดของ record_trade, record_trade_fx, replace_trade ไม่ตรง';
  end if;
  execute 'set local role anon';
  r := pg_temp.fails(format($q$ select private.trades_fingerprint(%L, 'a1') $q$, ua));
  execute 'reset role';
  if r is null or r not like '42501|%' then raise exception 'FAIL: T10 anon เรียก trades_fingerprint ได้ (ได้ %)', r; end if;

  -- T11 รหัส "ข้อมูลเปลี่ยนระหว่างทำรายการ" ต้องเป็น PT409 ไม่ใช่ 40001 (40001 ถูก PostgREST ลองซ้ำอัตโนมัติจนค้าง ~60 วินาที) · ตรวจนิยามฟังก์ชันทั้งสามว่าไม่มี errcode 40001 เหลือ
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname in ('record_trade', 'record_trade_fx', 'replace_trade')
         and (pg_get_functiondef(p.oid) ~ 'errcode = ''40001''' or pg_get_functiondef(p.oid) !~ 'errcode = ''PT409''')) <> 0 then
    raise exception 'FAIL: T11 record_trade/record_trade_fx/replace_trade ยังใช้ errcode 40001 หรือไม่มี PT409';
  end if;
  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
