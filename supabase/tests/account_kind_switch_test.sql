-- ทดสอบ migration 20261115000300 ส่วน R23: public.set_account_kind (เปลี่ยนป้าย normal <-> investment แม้มีรายการ) + accounts_guard ที่ปล่อยเฉพาะเส้นทางนี้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261115000300_usd_backup_import** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง (ตัวเลขทั้งหมดสมมติ)

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate || '|' || sqlerrm; end $$;
create function pg_temp.admin_fails(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute 'reset role';
  begin
    execute p_sql;
    perform pg_temp.settle();
    r := null;
  exception when others then
    r := sqlstate || '|' || sqlerrm;
  end;
  execute 'set local role authenticated';
  return r;
end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.mkuser(p_id uuid, p_tag text, p_changed boolean) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (p_id, p_tag || '-ask@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  if p_changed then
    update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf')) where id = p_id;
  end if;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.admin_fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.mkuser(uuid, text, boolean) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  r text;
  v text;
  n bigint;
  lines_before bigint;
  sum_before bigint;
  accs jsonb := '[
    {"id":"w1","type":"asset","name":"กระเป๋าหลัก","currency":"THB"},
    {"id":"w2","type":"asset","name":"ออมทรัพย์","currency":"THB"},
    {"id":"open","type":"equity","name":"ยอดยกมา","currency":"THB"},
    {"id":"food","type":"expense","name":"อาหาร","currency":"THB"},
    {"id":"usd-cash","type":"asset","name":"เงินสด USD","currency":"USD","kind":"investment"},
    {"id":"inv-th","type":"asset","name":"กองทุนไทย","currency":"THB","kind":"investment"}]';
  ents jsonb := '[
    {"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000000},{"accountId":"w2","amount":500000},{"accountId":"open","amount":-1500000}]},
    {"id":"e-food","date":"2026-11-02","memo":"x","source":"manual","lines":[{"accountId":"food","amount":100},{"accountId":"w2","amount":-100}]}]';
begin
  perform pg_temp.mkuser(ua, 'a', true); perform pg_temp.mkuser(ub, 'b', true); perform pg_temp.mkuser(uc, 'c', false);

  perform pg_temp.login(ua);
  perform public.import_ledger(jsonb_build_object('accounts', accs, 'entries', ents));
  perform pg_temp.settle();
  insert into public.assets (id, name, kind, account_id) values ('a1', 'กองทุนไทย', 'fund', 'inv-th');
  insert into public.bills (id, name, amount, due_day, wallet_id) values ('b1', 'ค่าเน็ต', 500, 5, 'w1');
  perform pg_temp.settle();
  select count(*), coalesce(sum(amount), 0) into lines_before, sum_before from public.lines;

  -- T1 ติดป้ายลงทุนให้บัญชีที่มีรายการแล้ว: สำเร็จ · บรรทัด/ยอดในสมุดไม่เปลี่ยนแม้แต่สตางค์
  v := public.set_account_kind('w2', 'investment');
  perform pg_temp.settle();
  if v is distinct from 'investment' then raise exception 'FAIL: T1 ผลที่คืนไม่ใช่ investment (%)', v; end if;
  select kind into v from public.accounts where id = 'w2';
  if v is distinct from 'investment' then raise exception 'FAIL: T1 ป้ายไม่เปลี่ยน (%)', v; end if;
  select coalesce(sum(amount), 0) into n from public.lines where account_id = 'w2';
  if n <> 499900 then raise exception 'FAIL: T1 ยอดของ w2 ในสมุดเปลี่ยน (%)', n; end if;

  -- T2 เปลี่ยนกลับได้ · ทำซ้ำป้ายเดิมไม่ error ไม่แก้อะไร
  v := public.set_account_kind('w2', 'normal');
  perform pg_temp.settle();
  select kind into v from public.accounts where id = 'w2';
  if v is distinct from 'normal' then raise exception 'FAIL: T2 เปลี่ยนกลับไม่ได้ (%)', v; end if;
  v := public.set_account_kind('w2', 'normal');
  if v is distinct from 'normal' then raise exception 'FAIL: T2 ทำซ้ำป้ายเดิมผิด (%)', v; end if;

  -- T3 ห้าม: บัญชีที่ผูกสินทรัพย์ · บัญชี USD · บัญชีที่ไม่ใช่สินทรัพย์ · ไม่มีบัญชี · ป้ายผิด · ข้อมูลไม่ครบ
  r := pg_temp.fails($q$ select public.set_account_kind('inv-th', 'normal') $q$);
  if r is null or r not like '23514|%ผูกกับสินทรัพย์%' then raise exception 'FAIL: T3 บัญชีที่ผูกสินทรัพย์เปลี่ยนเป็นใช้จ่ายได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind('usd-cash', 'normal') $q$);
  if r is null or r not like '23514|%USD%' then raise exception 'FAIL: T3 บัญชี USD เปลี่ยนเป็นใช้จ่ายได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind('food', 'investment') $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T3 หมวดรายจ่ายเปลี่ยนป้ายได้ (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind('nope', 'investment') $q$);
  if r is null or r not like 'P0002|%' then raise exception 'FAIL: T3 บัญชีที่ไม่มีผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind('w2', 'weird') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T3 ป้ายผิดผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind(null, 'investment') $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T3 id null ผ่าน (%)', r; end if;
  r := pg_temp.fails($q$ select public.set_account_kind('w2', null) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T3 ป้าย null ผ่าน (%)', r; end if;

  -- T4 กระเป๋าที่เป็นกระเป๋าจ่ายของบิลที่ยังใช้อยู่ เปลี่ยนเป็นเงินลงทุนไม่ได้ · เก็บถาวรบิลแล้วเปลี่ยนได้
  r := pg_temp.fails($q$ select public.set_account_kind('w1', 'investment') $q$);
  if r is null or r not like '23514|%มีบิล%' then raise exception 'FAIL: T4 กระเป๋าจ่ายบิลเปลี่ยนเป็นลงทุนได้ (%)', r; end if;
  update public.bills set archived = true where id = 'b1';
  perform pg_temp.settle();
  v := public.set_account_kind('w1', 'investment');
  perform pg_temp.settle();
  if v is distinct from 'investment' then raise exception 'FAIL: T4 เก็บถาวรบิลแล้วยังเปลี่ยนไม่ได้ (%)', v; end if;

  -- T5 ผู้ใช้แก้คอลัมน์ kind ตรงๆ ยังไม่ได้ (สิทธิ์คอลัมน์) · ผู้ดูแลแก้ kind ของบัญชีที่มีรายการตรงๆ ยังถูกกัน (ด่านชั้นสอง ไม่ผ่านฟังก์ชัน)
  r := pg_temp.fails($q$ update public.accounts set kind = 'normal' where id = 'w1' $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T5 ผู้ใช้แก้ kind ตรงๆ ได้ (%)', r; end if;
  r := pg_temp.admin_fails(format($f$ update public.accounts set kind = 'normal' where id = 'w1' and user_id = %L $f$, ua));
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5 ผู้ดูแลแก้ kind ของบัญชีที่มีรายการตรงๆ ได้ (%)', r; end if;
  r := pg_temp.admin_fails(format($f$ update public.accounts set currency = 'USD' where id = 'w2' and user_id = %L $f$, ua));
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5 ผู้ดูแลเปลี่ยนสกุลของบัญชีที่มีรายการได้ (%)', r; end if;

  -- T6 สมุดไม่ถูกแตะ: จำนวนบรรทัด/ผลรวมทั้งสมุดเท่าก่อนเปลี่ยนป้ายทั้งหมด · ป้ายสุดท้ายของ w1 = investment
  select count(*), coalesce(sum(amount), 0) into n, v from public.lines;
  if n <> lines_before or v::bigint <> sum_before then raise exception 'FAIL: T6 สมุดเปลี่ยนไป (บรรทัด % ผลรวม %)', n, v; end if;
  select count(*) into n from public.accounts where id = 'w1' and kind = 'investment';
  if n <> 1 then raise exception 'FAIL: T6 ป้ายของ w1 ไม่ใช่ investment'; end if;
  perform pg_temp.logout();

  -- T7 ผู้ใช้ B เปลี่ยนป้ายบัญชีของ A ไม่ได้ (เห็นเป็นไม่พบ) · ป้ายของ A ไม่เปลี่ยน
  perform pg_temp.login(ub);
  r := pg_temp.fails($q$ select public.set_account_kind('w2', 'investment') $q$);
  if r is null or r not like 'P0002|%' then raise exception 'FAIL: T7 B เปลี่ยนป้ายบัญชีของ A ได้ (%)', r; end if;
  perform pg_temp.logout();
  select kind into v from public.accounts where id = 'w2' and user_id = ua;
  if v is distinct from 'normal' then raise exception 'FAIL: T7 ป้ายของ A เปลี่ยนจากการเรียกของ B (%)', v; end if;

  -- T8 ยังไม่เปลี่ยนรหัสผ่าน = 42501 · anon เรียกไม่ได้ · สิทธิ์ในแคตตาล็อก
  perform pg_temp.login(uc);
  r := pg_temp.fails($q$ select public.set_account_kind('w2', 'investment') $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T8 ผู้ใช้ที่ยังไม่เปลี่ยนรหัสเรียกได้ (%)', r; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  r := pg_temp.fails($q$ select public.set_account_kind('w2', 'investment') $q$);
  execute 'reset role';
  if r is null then raise exception 'FAIL: T8 anon เรียกได้'; end if;
  if has_function_privilege('anon', 'public.set_account_kind(text, text)', 'execute') then raise exception 'FAIL: T8 anon มีสิทธิ์ execute'; end if;
  if not has_function_privilege('authenticated', 'public.set_account_kind(text, text)', 'execute') then raise exception 'FAIL: T8 authenticated ไม่มีสิทธิ์ execute'; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname = 'set_account_kind' and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then raise exception 'FAIL: T8 set_account_kind ต้องเป็น security definer และตั้ง search_path'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
