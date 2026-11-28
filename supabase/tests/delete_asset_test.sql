-- ทดสอบ migration 20261123000100_replace_trade_delete_asset: public.delete_asset (ลบสินทรัพย์ที่ไม่เหลือรายการ + บัญชีต้นทุนในธุรกรรมเดียว)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย rollback: TESTS_PASSED · ข้อมูลสมมติล้วน

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
  t0 timestamptz;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000000},{"accountId":"open","amount":-1000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-da@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-da@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-da@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values
    ('inv1', 'asset', 'กองทุน ก', 'THB', 'investment'), ('inv2', 'asset', 'กองทุน ข', 'THB', 'investment'), ('inv3', 'asset', 'กองทุน ค', 'THB', 'investment'),
    ('inv-us', 'asset', 'หุ้นสหรัฐ ก', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุน ก', 'fund', 'inv1'), ('a2', 'กองทุน ข', 'fund', 'inv2'), ('a3', 'กองทุน ค', 'fund', 'inv3');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values ('us1', 'หุ้นสหรัฐ ก', 'stock', 'inv-us', 'USD', 'ABC', 'NASDAQ');
  insert into public.asset_prices (asset_id, date, price_micro) values ('a1', '2026-11-10', 11000000), ('a1', '2026-11-11', 11500000);
  perform pg_temp.settle();

  -- T1 ยังมีรายการลงทุน (ซื้อ) ลบไม่ได้ 23514 · ของเดิมอยู่ครบ
  perform public.record_trade('{"id":"t-buy1","assetId":"a1","kind":"buy","date":"2026-11-05","units":"1000000000","priceMicro":5000000,"amount":50000,"fee":100}'::jsonb,
    '{"id":"e-buy1","date":"2026-11-05","memo":"b","source":"manual","lines":[{"accountId":"inv1","amount":50100},{"accountId":"w1","amount":-50100}]}'::jsonb, '[]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.delete_asset('a1') $q$);
  if r is null or r not like '23514|%ยังมีรายการ%' then raise exception 'FAIL: T1 สินทรัพย์ที่มีรายการต้องลบไม่ได้ 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id = 'a1' and user_id = %L) + (select count(*) from public.accounts where id = 'inv1' and user_id = %L) $q$, ua, ua)) <> 2 then raise exception 'FAIL: T1 ล้มแล้วของเดิมหาย'; end if;

  -- T2 ลบรายการทั้งหมด (ลบ Entry) แล้วลบสินทรัพย์ได้: สินทรัพย์ บัญชีต้นทุน ราคา หายหมด · บัญชีอื่นไม่ถูกแตะ
  delete from public.entries where id = 'e-buy1';
  perform pg_temp.settle();
  v := public.delete_asset('a1');
  perform pg_temp.settle();
  if v->>'assetId' <> 'a1' or v->>'accountId' <> 'inv1' then raise exception 'FAIL: T2 ผลที่คืนไม่ตรง (%)', v; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id = 'a1' and user_id = %L) + (select count(*) from public.accounts where id = 'inv1' and user_id = %L) + (select count(*) from public.asset_prices where asset_id = 'a1' and user_id = %L) $q$, ua, ua, ua)) <> 0 then raise exception 'FAIL: T2 สินทรัพย์/บัญชีต้นทุน/ราคาไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id = 'a2' and user_id = %L) + (select count(*) from public.accounts where id in ('inv2', 'w1') and user_id = %L) $q$, ua, ua)) <> 3 then raise exception 'FAIL: T2 ลบกระทบสินทรัพย์/บัญชีอื่น'; end if;
  -- ลบซ้ำ = ไม่พบ 23503
  r := pg_temp.fails($q$ select public.delete_asset('a1') $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T2 ลบซ้ำต้อง 23503 (ได้ %)', r; end if;

  -- T3 มีปันผลเงินสด/ขาย/ปันผลลงทุนต่อเหลืออยู่ก็ลบไม่ได้ (ทุกชนิดรายการ)
  perform public.record_trade('{"id":"t-div","assetId":"a2","kind":"dividend","date":"2026-11-02","amount":1000,"withholding":100}'::jsonb,
    '{"id":"e-div","date":"2026-11-02","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb, '[{"id":"inv-dividend"},{"id":"inv-wht"}]'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.delete_asset('a2') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T3 มีปันผลต้องลบไม่ได้ (ได้ %)', r; end if;

  -- T4 บัญชีต้นทุนมีบรรทัดในสมุด (ไม่มีรายการลงทุน) ลบไม่ได้ 23514 · มีอัตราแลกเปลี่ยนผูกบัญชีต้นทุน ลบไม่ได้ 23514
  perform public.create_entry('{"id":"e-raw","date":"2026-11-05","memo":"x","source":"manual","lines":[{"accountId":"inv3","amount":700},{"accountId":"w1","amount":-700}]}'::jsonb);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.delete_asset('a3') $q$);
  if r is null or r not like '23514|%บัญชีต้นทุน%' then raise exception 'FAIL: T4 บัญชีต้นทุนมีบรรทัดต้องลบไม่ได้ (ได้ %)', r; end if;
  insert into public.fx_rates (account_id, date, rate_micro) values ('inv-us', '2026-11-05', 35000000);
  r := pg_temp.fails($q$ select public.delete_asset('us1') $q$);
  if r is null or r not like '23514|%อัตราแลกเปลี่ยน%' then raise exception 'FAIL: T4 มีอัตราผูกบัญชีต้นทุนต้องลบไม่ได้ (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id in ('a3', 'us1') and user_id = %L) + (select count(*) from public.fx_rates where account_id = 'inv-us' and user_id = %L) $q$, ua, ua)) <> 3 then raise exception 'FAIL: T4 ล้มแล้วของเดิมหาย'; end if;

  -- T5 รหัสว่าง/ไม่มี 22023/23503 · JSON ผิดรูปไม่เกี่ยว (พารามิเตอร์เป็น text)
  r := pg_temp.fails($q$ select public.delete_asset(null) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5 null ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.delete_asset('no-such') $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T5 ไม่พบต้อง 23503 (ได้ %)', r; end if;

  -- T6 ลบสินทรัพย์ที่มีราคาจำนวนมาก (3,000 แถว) เสร็จในเวลา (< 8 วินาที) และราคาหายตาม
  insert into public.accounts (id, type, name, currency, kind) values ('inv4', 'asset', 'กองทุน ง', 'THB', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('a4', 'กองทุน ง', 'fund', 'inv4');
  perform pg_temp.logout();
  insert into public.asset_prices (user_id, asset_id, date, price_micro) select ua, 'a4', date '2020-01-01' + i, 1000000 from generate_series(1, 3000) i;
  perform pg_temp.login(ua);
  t0 := clock_timestamp();
  perform public.delete_asset('a4');
  if clock_timestamp() - t0 > interval '8 seconds' then raise exception 'FAIL: T6 ลบสินทรัพย์ที่มีราคา 3,000 แถวช้าเกิน 8 วินาที'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_prices where asset_id = 'a4' and user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T6 ราคาไม่หายตาม'; end if;
  perform pg_temp.settle();

  -- T7 ผู้ใช้ B ลบสินทรัพย์ของ A ไม่ได้ (RLS: ไม่พบ 23503) · ยังไม่เปลี่ยนรหัส 42501 · anon เรียกไม่ได้ · ระหว่างนำเข้า 55000
  perform pg_temp.login(ub);
  r := pg_temp.fails($q$ select public.delete_asset('a3') $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T7 B ลบของ A ต้อง 23503 (ได้ %)', r; end if;
  perform pg_temp.login(uc);
  r := pg_temp.fails($q$ select public.delete_asset('a3') $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T7 ยังไม่เปลี่ยนรหัสต้อง 42501 (ได้ %)', r; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  r := pg_temp.fails($q$ select public.delete_asset('a3') $q$);
  execute 'reset role';
  if r is null or r not like '42501|%' then raise exception 'FAIL: T7 anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;
  delete from public.entries where id = 'e-raw';  -- ผู้ดูแลลบรายการดิบ เพื่อให้ a3 ลบได้ถ้าไม่ใช่ด่านนำเข้า
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);
  perform pg_temp.login(ua);
  r := pg_temp.fails($q$ select public.delete_asset('a3') $q$);
  if r is null or r not like '55000|%' then raise exception 'FAIL: T7 ระหว่างนำเข้าต้อง 55000 (ได้ %)', r; end if;
  perform pg_temp.logout();
  delete from private.import_sessions where user_id = ua;
  perform pg_temp.login(ua);
  perform public.delete_asset('a3');
  perform pg_temp.settle();
  perform pg_temp.logout();
  if (select count(*) from public.accounts where id = 'inv3' and user_id = ua) <> 0 then raise exception 'FAIL: T7 หลังนำเข้าเสร็จลบ a3 แล้วบัญชีต้นทุนต้องหาย'; end if;

  -- ===== เทสต์เพิ่มตามข้อแนะนำผู้ตรวจ (§102.2 ข้อ 3) T9-T11 · ใช้สินทรัพย์ใหม่ b1 b2 us9 us8 =====
  perform pg_temp.login(ua);
  insert into public.accounts (id, type, name, currency, kind) values
    ('invb1', 'asset', 'กองทุน บ1', 'THB', 'investment'), ('invb2', 'asset', 'กองทุน บ2', 'THB', 'investment'),
    ('usd-c9', 'asset', 'เงินสด USD 9', 'USD', 'investment'), ('inv-us9', 'asset', 'หุ้นสหรัฐ 9', 'USD', 'investment'), ('inv-us8', 'asset', 'หุ้นสหรัฐ 8', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id) values ('b1', 'กองทุน บ1', 'fund', 'invb1'), ('b2', 'กองทุน บ2', 'fund', 'invb2');
  insert into public.assets (id, name, kind, account_id, instrument_currency, ticker, exchange) values
    ('us9', 'หุ้นสหรัฐ 9', 'stock', 'inv-us9', 'USD', 'NIN', 'NASDAQ'), ('us8', 'หุ้นสหรัฐ 8', 'stock', 'inv-us8', 'USD', 'EIG', 'NASDAQ');
  perform pg_temp.settle();

  -- T9 ลบสินทรัพย์ b1 (ปันผลถูกลบก่อน) แล้วกระเป๋า/บัญชีปันผล/บัญชีภาษีที่ใช้ร่วมกันยังอยู่ · ปันผลของ b2 ไม่ถูกแตะ
  perform public.record_trade('{"id":"db1","assetId":"b1","kind":"dividend","date":"2026-11-02","amount":1000,"withholding":100}'::jsonb,
    '{"id":"db1-e","date":"2026-11-02","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":900},{"accountId":"inv-wht","amount":100},{"accountId":"inv-dividend","amount":-1000}]}'::jsonb, pg_temp.need(array['inv-dividend', 'inv-wht']));
  perform public.record_trade('{"id":"db2","assetId":"b2","kind":"dividend","date":"2026-11-03","amount":2000,"withholding":200}'::jsonb,
    '{"id":"db2-e","date":"2026-11-03","memo":"d","source":"manual","lines":[{"accountId":"w1","amount":1800},{"accountId":"inv-wht","amount":200},{"accountId":"inv-dividend","amount":-2000}]}'::jsonb, pg_temp.need(array['inv-dividend', 'inv-wht']));
  perform pg_temp.settle();
  delete from public.entries where id = 'db1-e';
  perform pg_temp.settle();
  v := public.delete_asset('b1');
  perform pg_temp.settle();
  if v->>'assetId' <> 'b1' or v->>'accountId' <> 'invb1' then raise exception 'FAIL: T9 ผลที่คืนไม่ตรง (%)', v; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.accounts where id in ('w1', 'inv-dividend', 'inv-wht', 'invb2') and user_id = %L) + (select count(*) from public.trades where id = 'db2' and user_id = %L) * 10 + (select count(*) from public.lines where entry_id = 'db2-e' and user_id = %L) * 100 + (select count(*) from public.assets where id in ('b1', 'b2') and user_id = %L) * 1000 + (select count(*) from public.accounts where id = 'invb1' and user_id = %L) * 10000 $q$, ua, ua, ua, ua, ua)) <> 4 + 10 + 300 + 1000 then raise exception 'FAIL: T9 บัญชีที่ใช้ร่วมกัน/ปันผลของสินทรัพย์อื่นถูกกระทบ หรือ b1 ไม่หาย'; end if;

  -- T10 หุ้น USD: ลบสินทรัพย์หลังลบรายการซื้อและปันผล แล้วเงินสด USD (ยอดแลกเงินยังอยู่) บัญชีปันผล/ภาษี USD และ Entry แลกเงินยังอยู่
  perform public.record_fx_exchange(
    '{"id":"fx9","date":"2026-11-02","direction":"thb_to_usd","thbSatang":700000,"usdCents":20000,"memo":"แลก"}'::jsonb,
    '{"id":"fx9-e","date":"2026-11-02","memo":"แลกเงิน","source":"manual","lines":[{"accountId":"w1","amount":-700000},{"accountId":"fx-suspense-thb","amount":700000},{"accountId":"usd-c9","amount":20000},{"accountId":"fx-suspense-usd","amount":-20000}]}'::jsonb,
    pg_temp.need(array['fx-suspense-thb', 'fx-suspense-usd']));
  perform public.record_trade_fx('{"id":"ub9","assetId":"us9","kind":"buy","date":"2026-11-03","units":"500000000","priceMicro":20000000,"amount":10000,"fee":10,"fxRateMicro":35000000}'::jsonb,
    '{"id":"ub9-e","date":"2026-11-03","memo":"buy","source":"manual","lines":[{"accountId":"inv-us9","amount":10010},{"accountId":"usd-c9","amount":-10010}]}'::jsonb, '[]'::jsonb);
  perform public.record_trade_fx('{"id":"ud9","assetId":"us9","kind":"dividend","date":"2026-11-12","amount":500,"withholding":75,"fxRateMicro":34567891}'::jsonb,
    '{"id":"ud9-e","date":"2026-11-12","memo":"div","source":"manual","lines":[{"accountId":"usd-c9","amount":425},{"accountId":"inv-wht-usd","amount":75},{"accountId":"inv-dividend-usd","amount":-500}]}'::jsonb, pg_temp.need(array['inv-dividend-usd', 'inv-wht-usd']));
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.delete_asset('us9') $q$);
  if r is null or r not like '23514|%ยังมีรายการ%' then raise exception 'FAIL: T10 หุ้น USD ที่ยังมีรายการต้องลบไม่ได้ (ได้ %)', r; end if;
  delete from public.entries where id = 'ud9-e';
  delete from public.entries where id = 'ub9-e';
  perform pg_temp.settle();
  v := public.delete_asset('us9');
  perform pg_temp.settle();
  if v->>'assetId' <> 'us9' or v->>'accountId' <> 'inv-us9' then raise exception 'FAIL: T10 ผลที่คืนไม่ตรง (%)', v; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id = 'us9' and user_id = %L) + (select count(*) from public.accounts where id = 'inv-us9' and user_id = %L) $q$, ua, ua)) <> 0 then raise exception 'FAIL: T10 สินทรัพย์/บัญชีต้นทุน USD ไม่หาย'; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.accounts where id in ('usd-c9', 'inv-dividend-usd', 'inv-wht-usd', 'fx-suspense-thb', 'fx-suspense-usd') and user_id = %L) + (select count(*) from public.entries where id = 'fx9-e' and user_id = %L) * 10 $q$, ua, ua)) <> 5 + 10 then raise exception 'FAIL: T10 เงินสด USD/บัญชีปันผล-ภาษี USD/Entry แลกเงินถูกกระทบ'; end if;
  if pg_temp.ac(ua, format($q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'usd-c9' and user_id = %L $q$, ua)) <> 20000 then raise exception 'FAIL: T10 ยอดเงินสด USD ต้องเหลือเท่ายอดแลกเงิน'; end if;

  -- T11 หุ้น USD ที่ไม่เคยมีรายการ: ลบได้ทันที (สินทรัพย์ + บัญชีต้นทุน USD) · ไม่กระทบเงินสด USD
  v := public.delete_asset('us8');
  perform pg_temp.settle();
  if v->>'assetId' <> 'us8' or v->>'accountId' <> 'inv-us8' then raise exception 'FAIL: T11 ผลที่คืนไม่ตรง (%)', v; end if;
  if pg_temp.ac(ua, format($q$ select (select count(*) from public.assets where id = 'us8' and user_id = %L) + (select count(*) from public.accounts where id = 'inv-us8' and user_id = %L) + (select count(*) from public.accounts where id = 'usd-c9' and user_id = %L) * 10 $q$, ua, ua, ua)) <> 10 then raise exception 'FAIL: T11 ลบหุ้น USD ว่างไม่ถูกต้อง'; end if;
  perform pg_temp.logout();

  -- T12 สิทธิ์ในแคตตาล็อก: authenticated เท่านั้น · security invoker + search_path ว่าง
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'delete_asset' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
         and not p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) <> 1 then
    raise exception 'FAIL: T12 สิทธิ์/ชนิดฟังก์ชันไม่ตรง';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
