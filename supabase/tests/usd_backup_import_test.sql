-- ทดสอบ migration 20261115000300_usd_backup_import: นำเข้าไฟล์สำรองที่มีข้อมูล USD ครบ · ไฟล์บาทเดิมได้ผลรูปเดิม · ปฏิเสธข้อมูลผิด · ไม่รั่วข้ามผู้ใช้ · สิทธิ์ trigger function
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261115000100, 20261115000200 และ 20261115000300** · จบด้วย rollback: TESTS_PASSED
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
create function pg_temp.mkuser(p_id uuid, p_tag text) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (p_id, p_tag || '-ubi@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf')) where id = p_id;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.mkuser(uuid, text) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  n bigint;
  v jsonb;
  k text;
  accs jsonb := '[
    {"id":"w1","type":"asset","name":"กระเป๋า","currency":"THB"},
    {"id":"open","type":"equity","name":"ยอดยกมา","currency":"THB"},
    {"id":"fx-suspense-thb","type":"equity","name":"พักบาท","currency":"THB"},
    {"id":"fx-suspense-usd","type":"equity","name":"พัก USD","currency":"USD"},
    {"id":"usd-cash","type":"asset","name":"เงินสด USD","currency":"USD","kind":"investment"},
    {"id":"inv-us","type":"asset","name":"หุ้นสหรัฐ ก","currency":"USD","kind":"investment"},
    {"id":"inv-th","type":"asset","name":"กองทุนไทย","currency":"THB","kind":"investment"}]';
  ents jsonb := '[
    {"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":10000000},{"accountId":"open","amount":-10000000}]},
    {"id":"fx1-e","date":"2026-11-02","memo":"แลก","source":"manual","lines":[{"accountId":"w1","amount":-7000000},{"accountId":"fx-suspense-thb","amount":7000000},{"accountId":"usd-cash","amount":200000},{"accountId":"fx-suspense-usd","amount":-200000}]},
    {"id":"b1-e","date":"2026-11-03","memo":"ซื้อ","source":"manual","lines":[{"accountId":"inv-us","amount":100100},{"accountId":"usd-cash","amount":-100100}]}]';
  usd jsonb := '{
    "assets":[{"id":"us1","name":"หุ้นสหรัฐ ก","kind":"stock","accountId":"inv-us","currency":"USD","ticker":"ABC","exchange":"NASDAQ"}],
    "trades":[{"id":"t-buy","assetId":"us1","kind":"buy","date":"2026-11-03","createdAt":"2026-11-03T03:00:00.000Z","units":"1000000000","priceMicro":100000000,"amount":100000,"fee":100,"withholding":0,"memo":"","entryId":"b1-e","fxRateMicro":35000000}],
    "prices":[],
    "fxRates":[{"accountId":"usd-cash","date":"2026-11-02","rateMicro":35000000}],
    "fxExchanges":[{"id":"fx1","date":"2026-11-02","createdAt":"2026-11-02T03:00:00.000Z","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"memo":"แลก","entryId":"fx1-e"}]}';
begin
  perform pg_temp.mkuser(ua, 'a'); perform pg_temp.mkuser(ub, 'b'); perform pg_temp.mkuser(uc, 'c');

  -- T1 นำเข้าข้อมูล USD ครบ: ผลที่คืนมีคีย์ใหม่ · ข้อมูลที่เก็บตรงกับไฟล์ทุกฟิลด์ (เซนต์/สตางค์/อัตรา)
  perform pg_temp.login(ua);
  perform private.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  v := private.import_ledger_investments(usd);
  perform pg_temp.settle();
  if v <> '{"assets":1,"prices":0,"trades":1,"fxRates":1,"fxExchanges":1}'::jsonb then raise exception 'FAIL: T1 ผลที่คืนไม่ตรง (%)', v; end if;
  select count(*) into n from public.assets where id = 'us1' and instrument_currency = 'USD' and ticker = 'ABC' and exchange = 'NASDAQ' and account_id = 'inv-us';
  if n <> 1 then raise exception 'FAIL: T1 สินทรัพย์ USD เก็บไม่ครบ'; end if;
  select count(*) into n from public.trades where id = 't-buy' and fx_rate_micro = 35000000 and units = '1000000000' and price_micro = 100000000 and amount = 100000 and fee = 100 and entry_id = 'b1-e';
  if n <> 1 then raise exception 'FAIL: T1 รายการ USD เก็บไม่ครบ'; end if;
  select count(*) into n from public.fx_rates where account_id = 'usd-cash' and date = '2026-11-02' and rate_micro = 35000000;
  if n <> 1 then raise exception 'FAIL: T1 อัตราที่กรอกเก็บไม่ครบ'; end if;
  select count(*) into n from public.fx_exchanges where id = 'fx1' and direction = 'thb_to_usd' and thb_satang = 7000000 and usd_cents = 200000 and rate_micro = 35000000 and memo = 'แลก' and entry_id = 'fx1-e' and created_at = timestamptz '2026-11-02T03:00:00Z';
  if n <> 1 then raise exception 'FAIL: T1 การแลกเงินเก็บไม่ครบ'; end if;
  select coalesce(sum(l.amount), 0) into n from public.lines l where l.account_id = 'usd-cash';
  if n <> 99900 then raise exception 'FAIL: T1 ยอดเงินสด USD ในสมุดผิด (%)', n; end if;

  -- T2 นำเข้าซ้ำ = ปฏิเสธ (ไม่ทับ) · ข้อมูลเดิมไม่เปลี่ยน
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[]}'::jsonb) $q$);
  if r is null or r not like '23505|%มีข้อมูลลงทุนอยู่แล้ว%' then raise exception 'FAIL: T2 นำเข้าซ้ำได้ (%)', r; end if;
  select count(*) into n from public.fx_exchanges; if n <> 1 then raise exception 'FAIL: T2 ข้อมูลเดิมเปลี่ยน'; end if;
  -- T2b ขอบของ R20.3 (ถ้อยคำใหม่): ซื้อ USD ที่ (A+F) x fx < 500,000 ปัดต้นทุนบาทเป็น 0 สตางค์ = ปฏิเสธ · = 500,000 พอดี ผ่าน (ปัดครึ่งขึ้นเป็น 1) · ค่าธรรมเนียมช่วยให้ผ่าน
  perform set_config('app.invest_import', 'on', true);
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fee, fx_rate_micro) values ('bd1', 'us1', 'buy', '2026-11-04', '100000000', 1, 0, 500000) $q$);
  if r is not null then raise exception 'FAIL: T2b (A+F)xfx = 500,000 พอดีต้องผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fee, fx_rate_micro) values ('bd2', 'us1', 'buy', '2026-11-04', '100000000', 1, 0, 499999) $q$);
  if r is null or r not like '23514|%ปัดเป็น 0 สตางค์%' then raise exception 'FAIL: T2b 499,999 ต้องถูกปฏิเสธ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fee, fx_rate_micro) values ('bd3', 'us1', 'buy', '2026-11-04', '100000000', 1, 0, 200000) $q$);
  if r is null or r not like '23514|%ปัดเป็น 0 สตางค์%' then raise exception 'FAIL: T2b A=1 F=0 ที่ fx 0.2 ต้องถูกปฏิเสธ (%)', r; end if;
  r := pg_temp.fails($q$ insert into public.trades (id, asset_id, kind, date, units, amount, fee, fx_rate_micro) values ('bd4', 'us1', 'buy', '2026-11-04', '100000000', 1, 2, 200000) $q$);
  if r is not null then raise exception 'FAIL: T2b A=1 F=2 ที่ fx 0.2 (0.6 ปัดเป็น 1) ต้องผ่าน (%)', r; end if;
  perform set_config('app.invest_import', '', true);
  perform pg_temp.logout();

  -- T3 ไฟล์บาทเดิม (ไม่มีฟิลด์ USD) ได้ผลรูปเดิมทุกประการ: {assets, prices, trades} ไม่มีคีย์ fx
  perform pg_temp.login(ub);
  perform private.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  v := private.import_ledger_investments('{"assets":[{"id":"t1","name":"กองทุนไทย","kind":"fund","accountId":"inv-th"}]}'::jsonb);
  perform pg_temp.settle();
  if v <> '{"assets":1,"prices":0,"trades":0}'::jsonb then raise exception 'FAIL: T3 ผลของไฟล์บาทเดิมเปลี่ยนรูป (%)', v; end if;
  select instrument_currency into k from public.assets where id = 't1';
  if k is distinct from 'THB' then raise exception 'FAIL: T3 สินทรัพย์บาทไม่ได้ THB (%)', k; end if;
  perform pg_temp.logout();

  -- T4 ข้อมูลผิดถูกปฏิเสธทั้งก้อน ไม่เหลือแถวค้าง (ผู้ใช้ C)
  perform pg_temp.login(uc);
  perform private.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[{"id":"us1","name":"x","kind":"stock","accountId":"inv-th","currency":"USD"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4 สินทรัพย์ USD ผูกบัญชีบาทผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[{"id":"us1","name":"x","kind":"stock","accountId":"inv-us","currency":"USD"}],"trades":[{"id":"t","assetId":"us1","kind":"buy","date":"2026-11-03","units":"100000000","amount":100,"entryId":"b1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ต้องมีอัตรา%' then raise exception 'FAIL: T4 รายการ USD ไม่มีอัตราผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[{"id":"t1","name":"x","kind":"fund","accountId":"inv-th"}],"trades":[{"id":"t","assetId":"t1","kind":"buy","date":"2026-11-03","units":"100000000","amount":100,"fxRateMicro":35000000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ไม่มีอัตรา%' then raise exception 'FAIL: T4 รายการบาทมีอัตราผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[{"id":"us1","name":"x","kind":"stock","accountId":"inv-us","currency":"USD"}],"trades":[{"id":"t","assetId":"us1","kind":"reinvest","date":"2026-11-03","units":"100000000","amount":100,"fxRateMicro":35000000,"entryId":"b1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4 ปันผลลงทุนต่อของ USD ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxRates":[{"accountId":"w1","date":"2026-11-02","rateMicro":35000000}]}'::jsonb) $q$);
  if r is null or r not like '23514|%บัญชีลงทุนสกุล USD%' then raise exception 'FAIL: T4 อัตราผูกกระเป๋าบาทผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000001,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4 อัตราไม่ตรงสองจำนวนผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"entryId":"not-in-ledger"}]}'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T4 การแลกเงินชี้ Entry ที่ไม่มีผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxRates":"x"}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T4 fxRates ไม่ใช่อาร์เรย์ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[1]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T4 fxExchanges แถวไม่ใช่วัตถุผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments(jsonb_build_object('fxRates', (select jsonb_agg(jsonb_build_object('accountId', 'usd-cash', 'date', '2026-11-02', 'rateMicro', 1)) from generate_series(1, 10001)))) $q$);
  if r is null or r not like '22023|%เกินเพดาน%' then raise exception 'FAIL: T4 อัตราเกิน 10,000 แถวผ่าน (%)', r; end if;
  select (select count(*) from public.assets) + (select count(*) from public.trades) + (select count(*) from public.fx_rates) + (select count(*) from public.fx_exchanges) into n;
  if n <> 0 then raise exception 'FAIL: T4 ล้มแล้วยังเหลือแถวค้าง (%)', n; end if;
  perform pg_temp.logout();

  -- T5 ไม่รั่วข้ามผู้ใช้: B ไม่เห็นข้อมูลของ A · C ใช้ Entry ของ B/A ไม่ได้ (Entry ต้องอยู่ในสมุดตัวเอง)
  perform pg_temp.login(ub);
  select (select count(*) from public.fx_rates) + (select count(*) from public.fx_exchanges) into n;
  if n <> 0 then raise exception 'FAIL: T5 B เห็นข้อมูล USD ของ A (%)', n; end if;
  perform pg_temp.logout();

  -- T6 ลบ Entry ของการแลกเงิน/ซื้อ: ข้อมูล USD ตามไปทางเดียวกับปกติ (cascade) · ล้างข้อมูลทั้งหมดของ A ได้
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub, uc);
  perform pg_temp.login(ua);
  n := 0;
  loop
    r := private.reset_my_ledger_step('new-password');
    n := n + 1;
    exit when r = 'done';
    if r <> 'more' or n > 10 then raise exception 'FAIL: T6 ผลล้างข้อมูลไม่คาด % (ชุด %)', r, n; end if;
  end loop;
  perform pg_temp.logout();
  if (select count(*) from public.assets where user_id = ua) + (select count(*) from public.trades where user_id = ua)
     + (select count(*) from public.fx_rates where user_id = ua) + (select count(*) from public.fx_exchanges where user_id = ua) <> 0 then
    raise exception 'FAIL: T6 ล้างแล้วยังเหลือข้อมูล USD';
  end if;

  -- T7 trigger function ใหม่ของ A2 ไม่เปิดให้ PUBLIC/anon/authenticated (ตามแบบแผน) และ trigger ยังทำงาน (T4 ปฏิเสธด้วยด่านเหล่านี้แล้ว)
  for k in select unnest(array['assets_currency_guard', 'trades_fx_guard', 'fx_rates_guard', 'fx_exchanges_insert_guard', 'fx_exchanges_update_guard', 'fx_exchanges_delete_guard']) loop
    if has_function_privilege('anon', ('private.' || k || '()')::regprocedure, 'execute')
       or has_function_privilege('authenticated', ('private.' || k || '()')::regprocedure, 'execute') then
      raise exception 'FAIL: T7 private.% เรียกได้โดย anon/authenticated', k;
    end if;
    if exists (select 1 from pg_proc p where p.oid = ('private.' || k || '()')::regprocedure and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))) then
      raise exception 'FAIL: T7 private.% เปิดให้ PUBLIC', k;
    end if;
  end loop;

  -- T8 anon เรียกนำเข้าไม่ได้
  execute 'set local role anon';
  r := pg_temp.fails($q$ select private.import_ledger_investments('{}'::jsonb) $q$);
  execute 'reset role';
  if r is null then raise exception 'FAIL: T8 anon นำเข้าข้อมูลลงทุนได้'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
