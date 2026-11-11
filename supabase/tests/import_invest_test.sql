-- ทดสอบ นำเข้าไฟล์สำรอง: ป้ายบัญชี (accounts.kind) + ข้อมูลลงทุน (import_ledger_investments)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261111000100 และ 20261111000200** · จบด้วย rollback: TESTS_PASSED
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
create function pg_temp.mkuser(p_id uuid, p_tag text) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (p_id, p_tag || '-ii@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf')) where id = p_id;
end $$;
create function pg_temp.mkuser_unchanged(p_id uuid) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (p_id, 'e-ii@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  ud uuid := gen_random_uuid();
  ue uuid := gen_random_uuid();
  r text;
  n integer;
  k text;
  v jsonb;
  accs jsonb := '[
    {"id":"w1","type":"asset","name":"กระเป๋า","currency":"THB"},
    {"id":"inv1","type":"asset","name":"กองทุน ก","currency":"THB","kind":"investment"},
    {"id":"open","type":"equity","name":"ยอดยกมา","currency":"THB"}]';
  ents jsonb := '[
    {"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":100000},{"accountId":"open","amount":-100000}]},
    {"id":"e-buy1","date":"2026-11-05","memo":"buy","source":"manual","lines":[{"accountId":"inv1","amount":50000},{"accountId":"w1","amount":-50000}]}]';
  invd jsonb := '{
    "assets":[{"id":"a1","name":"กองทุน ก","kind":"fund","accountId":"inv1"}],
    "trades":[
      {"id":"t1","assetId":"a1","kind":"buy","date":"2026-11-05","createdAt":"2026-11-05T03:00:00.000Z","units":"500000000","priceMicro":10000000,"amount":50000,"fee":5,"withholding":0,"memo":"","entryId":"e-buy1"},
      {"id":"t2","assetId":"a1","kind":"sell","date":"2026-11-20","createdAt":"2026-11-20T03:00:00.000Z","units":"100000000","priceMicro":12000000,"fee":3,"withholding":0,"memo":"x"}],
    "prices":[{"assetId":"a1","date":"2026-11-10","priceMicro":11000000}]}';
begin
  perform pg_temp.mkuser(ua, 'a'); perform pg_temp.mkuser(ub, 'b'); perform pg_temp.mkuser(uc, 'c'); perform pg_temp.mkuser(ud, 'd');

  -- T1 นำเข้าครั้งเดียว (import_ledger): ป้าย kind คงอยู่ · บัญชีไม่ระบุ kind = normal
  perform pg_temp.login(ua);
  v := public.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  select kind into k from public.accounts where id = 'inv1'; if k is distinct from 'investment' then raise exception 'FAIL: T1 ป้ายบัญชีลงทุนหายตอนนำเข้า (%)', k; end if;
  select kind into k from public.accounts where id = 'w1';   if k is distinct from 'normal' then raise exception 'FAIL: T1 บัญชีทั่วไปไม่ได้ป้าย normal (%)', k; end if;

  -- T2 นำเข้าข้อมูลลงทุนหลังสมุด: อะตอมมิก · ผูก Entry ได้ · นับตรง
  v := public.import_ledger_investments(invd);
  perform pg_temp.settle();
  if v <> '{"assets":1,"prices":1,"trades":2}'::jsonb then raise exception 'FAIL: T2 จำนวนที่นำเข้าไม่ตรง (%)', v; end if;
  select count(*) into n from public.trades where entry_id = 'e-buy1'; if n <> 1 then raise exception 'FAIL: T2 รายการไม่ผูก Entry'; end if;
  select units into k from public.trades where id = 't1'; if k is distinct from '500000000' then raise exception 'FAIL: T2 units เพี้ยน (%)', k; end if;

  -- T3 ซ้ำ = ปฏิเสธ (ไม่ทับข้อมูลเดิม) และข้อมูลเดิมไม่เปลี่ยน
  r := pg_temp.fails($$ select public.import_ledger_investments('{"assets":[{"id":"a9","name":"x","kind":"fund","accountId":"inv1"}]}'::jsonb) $$);
  if r is null or r not like '%มีข้อมูลลงทุนอยู่แล้ว%' then raise exception 'FAIL: T3 นำเข้าซ้ำได้ (%)', r; end if;
  select count(*) into n from public.assets; if n <> 1 then raise exception 'FAIL: T3 ข้อมูลเดิมเปลี่ยน'; end if;
  perform pg_temp.logout();

  -- T4 นำเข้าแบบแบ่งก้อน (import_ledger_begin/append) ก็ต้องคง kind · ระหว่างเซสชันเปิดห้ามนำเข้าข้อมูลลงทุน
  perform pg_temp.login(ub);
  v := public.import_ledger_begin(jsonb_build_object('accounts', accs, 'entries', jsonb_build_array(ents->0)), 2);
  perform pg_temp.settle();
  select kind into k from public.accounts where id = 'inv1'; if k is distinct from 'investment' then raise exception 'FAIL: T4 begin ทำป้ายหาย (%)', k; end if;
  r := pg_temp.fails(format($f$ select public.import_ledger_investments(%L::jsonb) $f$, invd::text));
  if r is null or r not like '%ค้างอยู่%' then raise exception 'FAIL: T4 นำเข้าข้อมูลลงทุนได้ขณะเซสชันเปิด (%)', r; end if;
  v := public.import_ledger_append(jsonb_build_array(ents->1));
  perform pg_temp.settle();
  if (v->>'done') <> 'true' then raise exception 'FAIL: T4 append ไม่ปิดเซสชัน (%)', v; end if;
  v := public.import_ledger_investments(invd);
  perform pg_temp.settle();
  select count(*) into n from public.trades; if n <> 2 then raise exception 'FAIL: T4 หลังปิดเซสชันนำเข้าข้อมูลลงทุนไม่ได้ (%)', n; end if;
  perform pg_temp.logout();

  -- T5 ข้อมูลลงทุนเสียหนึ่งแถว = ย้อนกลับทั้งก้อน (ไม่เข้าครึ่งเดียว) · เรียกซ้ำได้หลังแก้
  perform pg_temp.login(uc);
  v := public.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  r := pg_temp.fails($$ select public.import_ledger_investments('{
    "assets":[{"id":"a1","name":"x","kind":"fund","accountId":"inv1"}],
    "trades":[{"id":"bad","assetId":"a1","kind":"buy","date":"2026-11-05","units":"1","fee":0,"withholding":0,"memo":""}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T5 ข้อมูลลงทุนที่เสียถูกรับ'; end if;
  select count(*) into n from public.assets; if n <> 0 then raise exception 'FAIL: T5 สินทรัพย์เข้าครึ่งเดียวทั้งที่ก้อนล้ม (%)', n; end if;
  r := pg_temp.fails($$ select public.import_ledger_investments('{"assets":[{"id":"a1","name":"x","kind":"fund","accountId":"w1"}]}'::jsonb) $$);
  if r is null or r not like '%บัญชีลงทุน%' then raise exception 'FAIL: T5 สินทรัพย์ผูกกระเป๋าเงินสดได้ (%)', r; end if;
  v := public.import_ledger_investments(invd);
  perform pg_temp.settle();
  select count(*) into n from public.assets; if n <> 1 then raise exception 'FAIL: T5 เรียกซ้ำหลังแก้ไม่สำเร็จ (%)', n; end if;
  perform pg_temp.logout();

  -- T6 ข้อมูลของใครของมัน: C ไม่เห็นของ A/B และของ A ไม่ถูกแตะ
  select count(*) into n from public.trades where user_id = ua; if n <> 2 then raise exception 'FAIL: T6 ข้อมูลของ A เปลี่ยน (%)', n; end if;
  perform pg_temp.login(ud);
  select count(*) into n from public.assets; if n <> 0 then raise exception 'FAIL: T6 D เห็นสินทรัพย์ของคนอื่น (%)', n; end if;
  perform pg_temp.logout();

  -- T6b เขียนข้ามผู้ใช้: D มี inv1 และ Entry e-buy1 รหัสเดียวกับของ A · นำเข้าแล้วต้องผูกกับของ D เอง ของ A ไม่เปลี่ยน
  --      entryId ที่ D ไม่มี (มีแต่ของ A) ต้องชน FK
  perform pg_temp.login(ud);
  v := public.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  r := pg_temp.fails($$ select public.import_ledger_investments('{"assets":[{"id":"a1","name":"x","kind":"fund","accountId":"inv1"}],"trades":[{"id":"zz","assetId":"a1","kind":"buy","date":"2026-11-05","units":"1","amount":1,"fee":0,"withholding":0,"memo":"","entryId":"only-in-a"}]}'::jsonb) $$);
  if r is null or r not like '%foreign key%' then raise exception 'FAIL: T6b entryId ที่ D ไม่มีถูกรับ (%)', r; end if;
  v := public.import_ledger_investments(invd);
  perform pg_temp.settle();
  perform pg_temp.logout();
  select count(*) into n from public.trades where user_id = ud and entry_id = 'e-buy1'; if n <> 1 then raise exception 'FAIL: T6b รายการของ D ไม่ผูก Entry ของ D (%)', n; end if;
  select count(*) into n from public.trades where user_id = ua; if n <> 2 then raise exception 'FAIL: T6b ข้อมูลของ A เปลี่ยน (%)', n; end if;
  perform set_config('app.deleting_account', 'on', true);  -- ข้ามตัวกันลบรายการ system (ล้างข้อมูลทดสอบของ D)
  delete from public.assets where user_id = ud;  -- เก็บ D ให้ว่างสำหรับ T7 (cascade ลบรายการ/ราคา)
  delete from public.entries where user_id = ud; delete from public.bills where user_id = ud; delete from public.accounts where user_id = ud;
  perform set_config('app.deleting_account', '', true);

  -- T7 kind แปลกในไฟล์ = ปฏิเสธทั้งการนำเข้า (ไม่เดาเป็นเงินสด) · รูปแบบข้อมูลลงทุนผิด/เกินเพดาน = ปฏิเสธ
  perform pg_temp.login(ud);
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[{"id":"w1","type":"asset","name":"x","currency":"THB","kind":"weird"},{"id":"open","type":"equity","name":"o","currency":"THB"}],"entries":[]}'::jsonb) $$);
  if r is null or r not like '%accounts_kind_check%' then raise exception 'FAIL: T7 kind แปลกถูกรับ หรือล้มด้วยเหตุผลอื่น (%)', r; end if;
  select count(*) into n from public.accounts; if n <> 0 then raise exception 'FAIL: T7 นำเข้าที่ล้มทิ้งบัญชีไว้ (%)', n; end if;
  v := public.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  r := pg_temp.fails($$ select public.import_ledger_investments('[]'::jsonb) $$);
  if r is null or r not like '%รูปแบบ%' then raise exception 'FAIL: T7 รูปแบบไม่ใช่วัตถุถูกรับ (%)', r; end if;
  r := pg_temp.fails($$ select public.import_ledger_investments('{"assets":{"a":1}}'::jsonb) $$);
  if r is null or r not like '%รูปแบบข้อมูลลงทุน%' then raise exception 'FAIL: T7 assets ไม่ใช่อาร์เรย์ถูกรับ หรือล้มด้วยเหตุผลอื่น (%)', r; end if;
  r := pg_temp.fails($$ select public.import_ledger_investments('{"assets":[1]}'::jsonb) $$);
  if r is null or r not like '%ต้องเป็นวัตถุ%' then raise exception 'FAIL: T7 แถวไม่ใช่วัตถุถูกรับ หรือล้มด้วยเหตุผลอื่น (%)', r; end if;
  r := pg_temp.fails(format($f$ select public.import_ledger_investments(jsonb_build_object('trades', (select jsonb_agg('{"id":"x"}'::jsonb) from generate_series(1, 10001)))) $f$));
  if r is null or r not like '%เกินเพดาน%' then raise exception 'FAIL: T7 รายการเกิน 10,000 ถูกรับ (%)', r; end if;
  perform pg_temp.logout();

  -- T8 ยังไม่เปลี่ยนรหัส/ไม่ล็อกอิน = ใช้ไม่ได้ · anon เรียกไม่ได้
  if has_function_privilege('anon', 'public.import_ledger_investments(jsonb)', 'execute') then raise exception 'FAIL: T8 anon เรียก import_ledger_investments ได้'; end if;
  if not has_function_privilege('authenticated', 'public.import_ledger_investments(jsonb)', 'execute') then raise exception 'FAIL: T8 authenticated เรียกไม่ได้'; end if;
  r := pg_temp.fails($$ select public.import_ledger_investments('{}'::jsonb) $$);
  if r is null or r not like '%ต้องเข้าสู่ระบบ%' then raise exception 'FAIL: T8 ไม่ล็อกอินเรียกได้ หรือล้มด้วยเหตุผลอื่น (%)', r; end if;
  -- ผู้ใช้ที่ยังไม่เปลี่ยนรหัส (must_change_password) เรียกไม่ได้
  perform pg_temp.mkuser_unchanged(ue);
  perform pg_temp.login(ue);
  r := pg_temp.fails($$ select public.import_ledger_investments('{}'::jsonb) $$);
  if r is null or r not like '%เปลี่ยนรหัสผ่าน%' then raise exception 'FAIL: T8 ผู้ใช้ที่ยังไม่เปลี่ยนรหัสเรียกได้ (%)', r; end if;
  perform pg_temp.logout();

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
