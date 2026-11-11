-- ทดสอบ พอร์ตลงทุน P2: accounts.kind, ตาราง assets/trades/asset_prices, RLS, cascade, ฟังก์ชันล้างข้อมูล/ลบบัญชีเดิมยังทำงาน
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261111000100_invest_schema** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขทั้งหมดสมมติ)

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
  uc uuid := gen_random_uuid();
  r text;
  n integer;
  k text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":100000},{"accountId":"open","amount":-100000}]}]';
  buy1 jsonb := '{"id":"e-buy1","date":"2026-11-05","memo":"buy","source":"manual","lines":[{"accountId":"inv1","amount":50000},{"accountId":"w1","amount":-50000}]}';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-inv@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-inv@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-inv@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  -- uc ไม่เปลี่ยนรหัส (ใช้ข้อมูลไม่ได้) · ข้ามด่านรอ 24 ชม. ของ ua/ub สำหรับ reset/delete
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();

  -- T1 บัญชีเดิม/ใหม่ที่ไม่ระบุ kind = normal
  select kind into k from public.accounts where id = 'w1';
  if k is distinct from 'normal' then raise exception 'FAIL: T1 kind ตั้งต้นไม่ใช่ normal (%)', k; end if;

  -- T2 บัญชีลงทุนต้องเป็น type asset · kind แปลก = ปฏิเสธ
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency, kind) values ('bad1', 'expense', 'x', 'THB', 'investment') $$);
  if r is null then raise exception 'FAIL: T2 บัญชีลงทุนชนิด expense ได้'; end if;
  r := pg_temp.fails($$ insert into public.accounts (id, type, name, currency, kind) values ('bad2', 'asset', 'x', 'THB', 'weird') $$);
  if r is null then raise exception 'FAIL: T2 kind แปลกได้'; end if;
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'กองทุน ก', 'THB', 'investment'), ('inv2', 'asset', 'กองทุน ข', 'THB', 'investment');
  perform pg_temp.settle();

  -- T3 เปลี่ยน kind ของบัญชีที่ยังไม่มีรายการได้ · ที่มีรายการแล้วไม่ได้
  update public.accounts set kind = 'normal' where id = 'inv2';
  update public.accounts set kind = 'investment' where id = 'inv2';
  perform public.create_entry(buy1);
  perform pg_temp.settle();
  r := pg_temp.fails($$ update public.accounts set kind = 'normal' where id = 'inv1' $$);
  if r is null or r not like '%ประเภทบัญชี%' then raise exception 'FAIL: T3 เปลี่ยน kind ของบัญชีที่มีรายการได้ (%)', r; end if;
  r := pg_temp.fails($$ update public.accounts set kind = 'investment' where id = 'w1' $$);
  if r is null then raise exception 'FAIL: T3 เปลี่ยนกระเป๋าเงินสดที่มีรายการเป็นบัญชีลงทุนได้'; end if;

  -- T4 สินทรัพย์: ต้องผูกบัญชีลงทุนสกุลบาท · หนึ่งบัญชีต่อหนึ่งสินทรัพย์ · THB เท่านั้น
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุน ก', 'fund', 'inv1');
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id) values ('a-bad', 'x', 'w1') $$);
  if r is null or r not like '%บัญชีลงทุน%' then raise exception 'FAIL: T4 สินทรัพย์ผูกบัญชีปกติได้ (%)', r; end if;
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id) values ('a-dup', 'x', 'inv1') $$);
  if r is null then raise exception 'FAIL: T4 สองสินทรัพย์ใช้บัญชีเดียวกันได้'; end if;
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id, currency) values ('a-usd', 'x', 'inv2', 'USD') $$);
  if r is null then raise exception 'FAIL: T4 สกุลไม่ใช่ THB ได้'; end if;
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id, kind) values ('a-k', 'x', 'inv2', 'crypto') $$);
  if r is null then raise exception 'FAIL: T4 kind สินทรัพย์แปลกได้'; end if;
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id) values ('a-name', repeat('ก', 201), 'inv2') $$);
  if r is null then raise exception 'FAIL: T4 ชื่อยาวเกิน 200 ได้'; end if;
  insert into public.assets (id, name, kind, account_id) values ('a2', 'หุ้น ข', 'stock', 'inv2');

  -- T5 รูปแบบรายการลงทุน (check ที่ฐานข้อมูล ไม่พึ่งเว็บ)
  -- 5.1 ซื้อปกติ ผูก Entry (e-buy1) · ขายต้องมีราคา · ปันผล/ปันผลลงทุนต่อ
  insert into public.trades (id, asset_id, kind, date, units, price_micro, amount, fee, entry_id)
    values ('t-buy1', 'a1', 'buy', '2026-11-05', '500000000', 10000000, 50000, 5, 'e-buy1');
  insert into public.trades (id, asset_id, kind, date, units, price_micro, fee)
    values ('t-sell1', 'a1', 'sell', '2026-11-20', '100000000', 12000000, 3);
  insert into public.trades (id, asset_id, kind, date, amount, withholding)
    values ('t-div1', 'a1', 'dividend', '2026-11-25', 1000, 100);
  insert into public.trades (id, asset_id, kind, date, units, amount)
    values ('t-re1', 'a1', 'reinvest', '2026-11-26', '1000000', 900);
  perform pg_temp.settle();
  -- 5.2 รูปแบบผิด
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units) values ('x1', 'a1', 'buy', '2026-11-06', '100') $$);
  if r is null then raise exception 'FAIL: T5 ซื้อไม่มีมูลค่าซื้อได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('x2', 'a1', 'sell', '2026-11-06', '100', 100) $$);
  if r is null then raise exception 'FAIL: T5 ขายไม่มีราคา/มี amount ได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, amount, withholding) values ('x3', 'a1', 'dividend', '2026-11-06', 1000, 1000) $$);
  if r is null then raise exception 'FAIL: T5 ภาษีหักเท่ากับยอดปันผลได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount, fee) values ('x4', 'a1', 'reinvest', '2026-11-06', '100', 100, 5) $$);
  if r is null then raise exception 'FAIL: T5 ปันผลลงทุนต่อมีค่าธรรมเนียมได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount, fee) values ('x5', 'a1', 'buy', '2026-11-06', '100', 100, -1) $$);
  if r is null then raise exception 'FAIL: T5 ค่าธรรมเนียมติดลบได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('x6', 'a1', 'buy', '2026-11-06', '100', 0) $$);
  if r is null then raise exception 'FAIL: T5 มูลค่าซื้อ 0 ได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('x7', 'a1', 'buy', '2026-11-06', '100', 9007199254740992) $$);
  if r is null then raise exception 'FAIL: T5 มูลค่าซื้อเกินช่วงปลอดภัยได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, price_micro) values ('x8', 'a1', 'sell', '2026-11-06', '100', 0) $$);
  if r is null then raise exception 'FAIL: T5 ราคา 0 ได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('x9', 'nope', 'buy', '2026-11-06', '100', 100) $$);
  if r is null then raise exception 'FAIL: T5 รายการลงทุนของสินทรัพย์ที่ไม่มีได้'; end if;
  -- 5.3 รูปแบบ units: เพดาน int64 (R17) · ไม่ขึ้นต้นด้วย 0 · ไม่ลบ · ไม่ทศนิยม/scientific
  insert into public.trades (id, asset_id, kind, date, units, amount) values ('u-max', 'a2', 'buy', '2026-11-07', '9223372036854775807', 100);
  foreach k in array array['9223372036854775808', '9999999999999999999', '10000000000000000000', '0', '012', '-5', '1.5', '1e3', '', ' 5', 'abc'] loop
    r := pg_temp.fails(format($f$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('u-bad', 'a2', 'buy', '2026-11-07', %L, 100) $f$, k));
    if r is null then raise exception 'FAIL: T5 units "%" ถูกรับ', k; end if;
  end loop;
  perform pg_temp.settle();

  -- T6 ราคาที่กรอกเอง: หนึ่งราคาต่อวัน · ราคา ≤ 0 ปฏิเสธ
  insert into public.asset_prices (asset_id, date, price_micro) values ('a1', '2026-11-10', 11000000), ('a1', '2026-11-11', 11500000);
  r := pg_temp.fails($$ insert into public.asset_prices (asset_id, date, price_micro) values ('a1', '2026-11-11', 1) $$);
  if r is null then raise exception 'FAIL: T6 ราคาซ้ำวันเดียวกันได้'; end if;
  r := pg_temp.fails($$ insert into public.asset_prices (asset_id, date, price_micro) values ('a1', '2026-11-12', 0) $$);
  if r is null then raise exception 'FAIL: T6 ราคา 0 ได้'; end if;

  -- T7 แยกข้อมูลต่อผู้ใช้ (RLS): B อ่าน/แก้/ลบของ A ไม่ได้ · ใส่ user_id ของ A ไม่ได้ · ผูกสินทรัพย์ของ A ไม่ได้
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  insert into public.accounts (id, type, name, currency, kind) values ('inv1', 'asset', 'ของ B', 'THB', 'investment');
  perform pg_temp.settle();
  select count(*) into n from public.assets;       if n <> 0 then raise exception 'FAIL: T7 B เห็นสินทรัพย์ของ A (%)', n; end if;
  select count(*) into n from public.trades;       if n <> 0 then raise exception 'FAIL: T7 B เห็นรายการลงทุนของ A (%)', n; end if;
  select count(*) into n from public.asset_prices; if n <> 0 then raise exception 'FAIL: T7 B เห็นราคาของ A (%)', n; end if;
  update public.trades set memo = 'hack';          get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: T7 B แก้รายการของ A ได้'; end if;
  delete from public.assets;                       get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: T7 B ลบสินทรัพย์ของ A ได้'; end if;
  r := pg_temp.fails(format($f$ insert into public.assets (user_id, id, name, account_id) values (%L, 'a-hack', 'x', 'inv1') $f$, ua));
  if r is null then raise exception 'FAIL: T7 B ใส่สินทรัพย์ในชื่อ A ได้'; end if;
  r := pg_temp.fails($$ insert into public.trades (id, asset_id, kind, date, units, amount) values ('b-x', 'a1', 'buy', '2026-11-06', '100', 100) $$);
  if r is null then raise exception 'FAIL: T7 B ผูกรายการกับสินทรัพย์ของ A ได้'; end if;
  insert into public.assets (id, name, account_id) values ('a1', 'ของ B', 'inv1');  -- รหัสซ้ำกับของ A ได้ (คนละผู้ใช้)
  perform pg_temp.settle();
  perform pg_temp.logout();

  -- T8 ผู้ใช้ที่ยังไม่เปลี่ยนรหัส (ด่าน can_use_data) ใช้ตารางลงทุนไม่ได้
  perform pg_temp.login(uc);
  r := pg_temp.fails($$ insert into public.assets (id, name, account_id) values ('c1', 'x', 'inv1') $$);
  if r is null then raise exception 'FAIL: T8 ผู้ใช้ที่ยังไม่เปลี่ยนรหัสเพิ่มสินทรัพย์ได้'; end if;
  select count(*) into n from public.assets; if n <> 0 then raise exception 'FAIL: T8 เห็นข้อมูล'; end if;
  perform pg_temp.logout();

  -- T9 anon เข้าตารางลงทุนไม่ได้ (สิทธิ์ระดับตาราง)
  if has_table_privilege('anon', 'public.assets', 'select') or has_table_privilege('anon', 'public.trades', 'select')
     or has_table_privilege('anon', 'public.asset_prices', 'select') then raise exception 'FAIL: T9 anon อ่านตารางลงทุนได้'; end if;
  if has_table_privilege('authenticated', 'public.trades', 'truncate') then raise exception 'FAIL: T9 authenticated truncate ได้'; end if;

  -- T10 ลบ Entry ที่ผูก = ลบรายการลงทุนที่ผูกตาม (cascade) · รายการอื่นคงอยู่
  perform pg_temp.login(ua);
  select count(*) into n from public.trades where entry_id = 'e-buy1'; if n <> 1 then raise exception 'FAIL: T10 ไม่พบรายการที่ผูก'; end if;
  delete from public.entries where id = 'e-buy1';
  perform pg_temp.settle();
  select count(*) into n from public.trades where id = 't-buy1'; if n <> 0 then raise exception 'FAIL: T10 ลบ Entry แล้วรายการลงทุนยังอยู่'; end if;
  select count(*) into n from public.trades where id = 't-sell1'; if n <> 1 then raise exception 'FAIL: T10 รายการอื่นหายตาม'; end if;
  perform pg_temp.logout();

  -- T11 ล้างข้อมูล (reset_my_ledger_step) ผู้ใช้ที่มีข้อมูลลงทุน: ฟังก์ชันเดิมต้องผ่านจนถึง done และตารางลงทุนว่าง
  --     (ไม่ต้องแก้ฟังก์ชันเดิม: ลบ entries → bills → accounts แล้ว cascade ถึง assets/trades/asset_prices)
  perform pg_temp.login(ua);
  perform public.create_entry(buy1);                                     -- เพิ่มรายการผูกอีกชุดก่อนล้าง
  insert into public.trades (id, asset_id, kind, date, units, price_micro, amount, entry_id)
    values ('t-buy2', 'a1', 'buy', '2026-11-05', '500000000', 10000000, 50000, 'e-buy1');
  perform pg_temp.settle();
  n := 0;
  loop
    r := public.reset_my_ledger_step('new-password-1');
    n := n + 1;
    exit when r = 'done';
    if r <> 'more' or n > 10 then raise exception 'FAIL: T11 ผลไม่คาด % (ชุดที่ %)', r, n; end if;
  end loop;
  perform pg_temp.logout();
  select count(*) into n from public.assets where user_id = ua;       if n <> 0 then raise exception 'FAIL: T11 สินทรัพย์เหลือหลังล้าง (%)', n; end if;
  select count(*) into n from public.trades where user_id = ua;       if n <> 0 then raise exception 'FAIL: T11 รายการลงทุนเหลือหลังล้าง (%)', n; end if;
  select count(*) into n from public.asset_prices where user_id = ua; if n <> 0 then raise exception 'FAIL: T11 ราคาเหลือหลังล้าง (%)', n; end if;
  select count(*) into n from public.accounts where user_id = ua;     if n <> 0 then raise exception 'FAIL: T11 บัญชีเหลือหลังล้าง (%)', n; end if;
  select count(*) into n from public.assets where user_id = ub;       if n <> 1 then raise exception 'FAIL: T11 ล้างของ A กระทบข้อมูลของ B (%)', n; end if;

  -- T12 ลบบัญชีผู้ใช้ (delete_my_account_step) ที่มีข้อมูลลงทุน: ต้องลบสะอาด ไม่ติด FK
  perform pg_temp.login(ub);
  insert into public.trades (id, asset_id, kind, date, units, amount) values ('b-t1', 'a1', 'buy', '2026-11-06', '100', 100);
  insert into public.asset_prices (asset_id, date, price_micro) values ('a1', '2026-11-10', 1000000);
  perform pg_temp.settle();
  n := 0;
  loop
    r := public.delete_my_account_step('new-password-2');
    n := n + 1;
    exit when r = 'done';
    if r <> 'more' or n > 10 then raise exception 'FAIL: T12 ผลไม่คาด % (ชุดที่ %)', r, n; end if;
  end loop;
  perform pg_temp.logout();
  select count(*) into n from public.assets where user_id = ub;       if n <> 0 then raise exception 'FAIL: T12 สินทรัพย์เหลือหลังลบบัญชี (%)', n; end if;
  select count(*) into n from public.trades where user_id = ub;       if n <> 0 then raise exception 'FAIL: T12 รายการลงทุนเหลือหลังลบบัญชี (%)', n; end if;
  select count(*) into n from auth.users where id = ub;               if n <> 0 then raise exception 'FAIL: T12 ผู้ใช้ยังอยู่'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
