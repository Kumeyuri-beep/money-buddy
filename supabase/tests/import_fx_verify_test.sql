-- ทดสอบ migration 20261115000400 (A3-1b): นำเข้ารายการแลกเงินต้องตรงกับบรรทัดของ Entry ฝั่งเซิร์ฟเวอร์ · set_account_kind ต้องไม่ทำงานระหว่างนำเข้าค้าง · นำเข้าที่ชี้ไปบัญชีของคนอื่นไม่ได้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration แล้ว · จบด้วย rollback: TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ) = ผ่าน
-- ไม่ใช้ข้อมูลการเงินจริง

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
  values (p_id, p_tag || '-ifv@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf')) where id = p_id;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.mkuser(uuid, text) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  ud uuid := gen_random_uuid();
  r text;
  n bigint;
  v jsonb;
  accs jsonb := '[
    {"id":"w1","type":"asset","name":"กระเป๋า","currency":"THB"},
    {"id":"open","type":"equity","name":"ยอดยกมา","currency":"THB"},
    {"id":"fx-suspense-thb","type":"equity","name":"พักบาท","currency":"THB"},
    {"id":"fx-suspense-usd","type":"equity","name":"พัก USD","currency":"USD"},
    {"id":"usd-cash","type":"asset","name":"เงินสด USD","currency":"USD","kind":"investment"}]';
  accs_b jsonb := '[
    {"id":"w1","type":"asset","name":"กระเป๋า","currency":"THB"},
    {"id":"open","type":"equity","name":"ยอดยกมา","currency":"THB"}]';
  ents jsonb := '[
    {"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":10000000},{"accountId":"open","amount":-10000000}]},
    {"id":"fx1-e","date":"2026-11-02","memo":"แลก","source":"manual","lines":[{"accountId":"w1","amount":-7000000},{"accountId":"fx-suspense-thb","amount":7000000},{"accountId":"usd-cash","amount":200000},{"accountId":"fx-suspense-usd","amount":-200000}]}]';
  ok_fx text := '{"id":"fx1","date":"2026-11-02","createdAt":"2026-11-02T03:00:00.000Z","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"memo":"แลก","entryId":"fx1-e"}';
begin
  perform pg_temp.mkuser(ua, 'a'); perform pg_temp.mkuser(ub, 'b'); perform pg_temp.mkuser(uc, 'c'); perform pg_temp.mkuser(ud, 'd');

  -- T1 ข้อมูลที่ถูกต้องยังนำเข้าได้ (ไม่ทำให้ของเดิมพัง)
  perform pg_temp.login(ua);
  perform private.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  v := private.import_ledger_investments(jsonb_build_object('fxExchanges', jsonb_build_array(ok_fx::jsonb)));
  perform pg_temp.settle();
  if v <> '{"assets":0,"prices":0,"trades":0,"fxExchanges":1}'::jsonb then raise exception 'FAIL: T1 ผลที่คืนไม่ตรง (%)', v; end if;
  perform pg_temp.logout();

  -- T2 จำนวนบาทของรายการแลกไม่ตรงกับ Entry (อัตรา 35.000005 สอดคล้องกับสองจำนวนที่ใส่ ตารางจึงไม่ปฏิเสธเอง) = ปฏิเสธทั้งก้อน
  perform pg_temp.login(ub);
  perform private.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000001,"usdCents":200000,"rateMicro":35000005,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ไม่ตรงกับรายการในสมุดบัญชี%' then raise exception 'FAIL: T2 จำนวนบาทไม่ตรง Entry ถูกรับ (%)', r; end if;
  select count(*) into n from public.fx_exchanges; if n <> 0 then raise exception 'FAIL: T2 ล้มแล้วยังเหลือการแลกเงิน (%)', n; end if;

  -- T3 วันที่ไม่ตรงกับ Entry
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-04","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ไม่ตรงกับรายการในสมุดบัญชี%' then raise exception 'FAIL: T3 วันที่ไม่ตรง Entry ถูกรับ (%)', r; end if;

  -- T4 ทิศทางสลับกับเครื่องหมายใน Entry (usd_to_thb แต่ Entry เป็น thb_to_usd)
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-02","direction":"usd_to_thb","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%ไม่ตรงกับรายการในสมุดบัญชี%' then raise exception 'FAIL: T4 ทิศทางสลับถูกรับ (%)', r; end if;

  -- T5 ไฟล์ที่เสียไม่ทิ้งข้อมูลครึ่งเดียว (สินทรัพย์/อัตราที่มาพร้อมกันก็ต้องไม่เข้า)
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxRates":[{"accountId":"usd-cash","date":"2026-11-02","rateMicro":35000000}],"fxExchanges":[{"id":"fx1","date":"2026-11-04","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T5 ก้อนที่มีรายการแลกเสียถูกรับ'; end if;
  select (select count(*) from public.fx_rates) + (select count(*) from public.fx_exchanges) + (select count(*) from public.assets) into n;
  if n <> 0 then raise exception 'FAIL: T5 ล้มแล้วยังเหลือแถวค้าง (%)', n; end if;
  v := private.import_ledger_investments(jsonb_build_object('fxExchanges', jsonb_build_array(ok_fx::jsonb)));
  perform pg_temp.settle();
  if v <> '{"assets":0,"prices":0,"trades":0,"fxExchanges":1}'::jsonb then raise exception 'FAIL: T5 หลังแก้แล้วนำเข้าไม่ได้ (%)', v; end if;
  perform pg_temp.logout();

  -- T6 (ต1) set_account_kind ระหว่างมีการนำเข้าสมุดค้างอยู่ = ปฏิเสธ 55000 · ปิดเซสชันแล้วใช้ได้ตามเดิม
  perform pg_temp.login(uc);
  v := private.import_ledger_begin(jsonb_build_object('accounts', accs, 'entries', jsonb_build_array(ents->0)), 2);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.set_account_kind('w1', 'investment') $q$);
  if r is null or r not like '55000|%' then raise exception 'FAIL: T6 เปลี่ยนป้ายได้ขณะนำเข้าค้าง (%)', r; end if;
  if (select kind from public.accounts where id = 'w1') is distinct from 'normal' then raise exception 'FAIL: T6 ป้ายเปลี่ยนทั้งที่ถูกปฏิเสธ'; end if;
  v := private.import_ledger_append(jsonb_build_array(ents->1));
  perform pg_temp.settle();
  if public.set_account_kind('w1', 'investment') is distinct from 'investment' then raise exception 'FAIL: T6 หลังปิดเซสชันเปลี่ยนป้ายไม่ได้'; end if;
  perform pg_temp.logout();

  -- T7 (ต3) นำเข้าที่ชี้ไปบัญชีของคนอื่น (ผู้ใช้ B ไม่มีบัญชี USD · A มี) ไม่ได้ และของ A ไม่เปลี่ยน
  perform pg_temp.login(ud);
  perform private.import_ledger(jsonb_build_object('accounts', accs_b, 'entries', jsonb_build_array(ents->0)));
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"assets":[{"id":"us1","name":"x","kind":"stock","accountId":"usd-cash","currency":"USD"}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T7 สินทรัพย์ชี้บัญชีของคนอื่นถูกรับ'; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxRates":[{"accountId":"usd-cash","date":"2026-11-02","rateMicro":35000000}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T7 อัตราชี้บัญชีของคนอื่นถูกรับ'; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments('{"fxExchanges":[{"id":"fx1","date":"2026-11-02","direction":"thb_to_usd","thbSatang":7000000,"usdCents":200000,"rateMicro":35000000,"entryId":"fx1-e"}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T7 การแลกเงินชี้ Entry ของคนอื่นถูกรับ'; end if;
  select (select count(*) from public.assets) + (select count(*) from public.fx_rates) + (select count(*) from public.fx_exchanges) into n;
  if n <> 0 then raise exception 'FAIL: T7 ล้มแล้วยังเหลือแถวค้าง (%)', n; end if;
  perform pg_temp.logout();
  select count(*) into n from public.fx_exchanges where user_id = ua; if n <> 1 then raise exception 'FAIL: T7 ข้อมูลของ A เปลี่ยน (%)', n; end if;

  -- T8 สิทธิ์ execute คงเดิมหลัง create or replace
  if has_function_privilege('anon', 'private.import_ledger_investments(jsonb)', 'execute') or has_function_privilege('anon', 'public.set_account_kind(text, text)', 'execute') then raise exception 'FAIL: T8 anon มีสิทธิ์'; end if;
  if not has_function_privilege('authenticated', 'private.import_ledger_investments(jsonb)', 'execute') or not has_function_privilege('authenticated', 'public.set_account_kind(text, text)', 'execute') then raise exception 'FAIL: T8 authenticated ไม่มีสิทธิ์'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
