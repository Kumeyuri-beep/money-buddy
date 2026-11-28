-- ทดสอบ migration 20261129000100_expected_user_header_guard: ทุกการเขียนตรวจหัวคำขอ x-expected-user กับ auth.uid() ในธุรกรรมเดียวกัน
-- วิธีรัน: **หลังใส่ migration** · จบด้วย raise TESTS_PASSED (ย้อนกลับทั้งหมด ไม่มีข้อมูลทดสอบเหลือ) · ตัวเลขสมมติทั้งหมด

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.fails(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate || '|' || sqlerrm; end $$;
-- หัวคำขอแบบที่ PostgREST ตั้งให้ · null = ไม่มีหัวคำขอ x-expected-user
create function pg_temp.headers(p_expected text) returns void language plpgsql as $$
begin
  perform set_config('request.headers', case when p_expected is null then '{"x-client-info":"test"}' else json_build_object('x-expected-user', p_expected)::text end, true);
end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); perform set_config('request.headers', '', true); end $$;
-- ภาพข้อมูลทั้งหมดของผู้ใช้ (อ่านด้วยสิทธิ์ผู้ดูแล) ใช้เทียบว่า "ไม่มีอะไรเปลี่ยน"
create function pg_temp.snap(p_user uuid) returns text language plpgsql as $$
declare t text; part text; out text := '';
begin
  foreach t in array array['accounts','entries','lines','bills','settings','assets','trades','asset_prices','fx_rates','fx_exchanges','asset_categories'] loop
    execute format('select coalesce(string_agg(to_jsonb(x)::text, '';'' order by to_jsonb(x)::text), '''') from public.%I x where x.user_id = $1', t) into part using p_user;
    out := out || '|' || part;
  end loop;
  return out;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.headers(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid(); -- ผู้ที่ล็อกอินอยู่ตอนนี้
  ub uuid := gen_random_uuid(); -- ผู้ใช้ที่หน้าจอ "ตั้งใจ" (บัญชีเดิมของอีกแท็บ) และผู้ที่ต้องไม่ถูกแตะ
  tables text[] := array['accounts','entries','lines','bills','settings','assets','trades','asset_prices','fx_rates','fx_exchanges','asset_categories'];
  t text;
  r text;
  stmt text;
  before_a text;
  before_b text;
  calls text[];
  call text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
  one jsonb := '{"id":"e2","date":"2026-11-02","memo":"x","source":"manual","createdAt":"2026-11-02T03:00:00.000Z","lines":[{"accountId":"w1","amount":100},{"accountId":"open","amount":-100}]}';
begin
  -- T1 รูปแบบ: ทุกตารางใน public ยกเว้น profiles มี trigger ที่เปิดอยู่ ระดับคำสั่ง ก่อน insert/update/delete (tgtype 30) · ตารางใหม่ที่ลืมใส่จะทำให้ข้อนี้ล้ม
  select string_agg(c.relname, ', ') into r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'profiles'
     and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'a_expected_user_trg' and g.tgenabled = 'O' and g.tgtype = 30
                       and g.tgfoid = 'private.expected_user_header_guard()'::regprocedure);
  if r is not null then raise exception 'FAIL: T1a ตารางที่ไม่มี trigger ตรวจบัญชี: %', r; end if;
  if (select p.prosecdef from pg_proc p where p.oid = 'private.expected_user_header_guard()'::regprocedure) then raise exception 'FAIL: T1b ต้องเป็น security invoker'; end if;
  if not coalesce((select 'search_path=""' = any(p.proconfig) from pg_proc p where p.oid = 'private.expected_user_header_guard()'::regprocedure), false) then raise exception 'FAIL: T1c ต้องตรึง search_path เป็นค่าว่าง'; end if;
  if has_function_privilege('anon', 'private.expected_user_header_guard()', 'execute') or has_function_privilege('authenticated', 'private.expected_user_header_guard()', 'execute') then
    raise exception 'FAIL: T1d ผู้ใช้ต้องเรียกฟังก์ชันตรงไม่ได้';
  end if;

  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  select u, e || '@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (ua, 'a-hdr'), (ub, 'b-hdr')) x(u, e);
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id in (ua, ub);
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  -- ข้อมูลตั้งต้นของทั้งสองคน (ไม่มีหัวคำขอ = เว็บรุ่นเก่าใช้ได้เหมือนเดิม)
  foreach t in array array[ua::text, ub::text] loop
    perform pg_temp.login(t::uuid);
    perform public.setup_ledger(acc, ent);
    perform pg_temp.settle();
    perform pg_temp.logout();
  end loop;
  if (select count(*) from public.entries where user_id in (ua, ub)) <> 2 then raise exception 'FAIL: T1e ตั้งต้นแบบไม่มีหัวคำขอต้องสำเร็จ'; end if;
  perform pg_temp.login(ub);
  perform public.merge_settings('{"payDay": 10}'::jsonb, '{}');
  insert into public.bills (id, name, amount, due_day, start_month) values ('bill-b', 'บิลของ B', 100, 1, '2026-11');
  perform pg_temp.settle();
  perform pg_temp.logout();
  before_b := pg_temp.snap(ub);

  -- T2 ตรรกะหัวคำขอ ทุกตาราง ทุกชนิดคำสั่ง (สิทธิ์ผู้ดูแล + claims ของ A: ตรวจตัว trigger ไม่ติดด่านสิทธิ์ตาราง · คำสั่งไม่แตะแถวใด)
  perform pg_temp.login(ua);
  execute 'reset role';
  foreach t in array tables loop
    foreach stmt in array array[
      format('insert into public.%I select * from public.%I where false', t, t),
      format('update public.%I set user_id = user_id where false', t),
      format('delete from public.%I where false', t)] loop
      foreach r in array array[ub::text, '', 'not-a-uuid'] loop
        perform pg_temp.headers(r);
        if coalesce(pg_temp.fails(stmt), 'ผ่าน') not like 'PT412|%' then raise exception 'FAIL: T2a หัวคำขอไม่ตรงต้อง PT412 (%)', stmt; end if;
      end loop;
      foreach r in array array[ua::text, upper(ua::text)] loop
        perform pg_temp.headers(r);
        r := pg_temp.fails(stmt);
        if r is not null then raise exception 'FAIL: T2b หัวคำขอตรงต้องผ่าน (%) ได้ %', stmt, r; end if;
      end loop;
      perform pg_temp.headers(null);
      r := pg_temp.fails(stmt);
      if r is not null then raise exception 'FAIL: T2c ไม่มีหัวคำขอต้องผ่าน (%) ได้ %', stmt, r; end if;
      perform set_config('request.headers', '', true);
      r := pg_temp.fails(stmt);
      if r is not null then raise exception 'FAIL: T2d ไม่มี request.headers ต้องผ่าน (%) ได้ %', stmt, r; end if;
    end loop;
  end loop;
  -- มีหัวคำขอแต่ไม่มีผู้ใช้ = ปฏิเสธ
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.headers(ua::text);
  if coalesce(pg_temp.fails('delete from public.bills where false'), 'ผ่าน') not like 'PT412|%' then raise exception 'FAIL: T2e ไม่มีผู้ใช้ต้อง PT412'; end if;
  perform pg_temp.logout();

  -- T3 ทางเขียนจริงของหน้าจอ: แท็บของ B ค้างอยู่ แต่เซสชันเป็น A = PT412 และข้อมูลของทั้งสองคนไม่เปลี่ยน
  before_a := pg_temp.snap(ua);
  calls := array[
    format('select public.create_entry(%L::jsonb)', one),
    'select public.merge_settings(''{"payDay": 3}''::jsonb, ''{}'')',
    'select public.merge_settings_if(''{"payDay": 3}''::jsonb, ''{}'', ''{"payDay": null}''::jsonb)',
    'insert into public.bills (id, name, amount, due_day, start_month) values (''bill-x'', ''x'', 100, 1, ''2026-11'')',
    'update public.bills set name = ''x'' where id = ''bill-b''',
    'delete from public.bills where id = ''bill-b''',
    'insert into public.accounts (id, type, name, currency, kind) values (''w9'', ''asset'', ''w9'', ''THB'', ''normal'')',
    'update public.accounts set name = ''x'' where id = ''w1''',
    'delete from public.entries where id = ''sys''',
    'delete from public.entries where id = ''no-such-entry''',
    'select public.set_category_archived(''no-such'', true)',
    'select public.set_account_kind(''w1'', ''investment'')'];
  foreach call in array calls loop
    perform pg_temp.login(ua);
    perform pg_temp.headers(ub::text);
    r := pg_temp.fails(call);
    perform pg_temp.logout();
    -- ฟังก์ชันที่ตรวจข้อมูลก่อนเขียน (ไม่พบหมวด) อาจตอบข้อผิดพลาดของตัวเองก่อนถึง trigger: ต้องล้มและไม่มีอะไรเปลี่ยน
    if r is null then raise exception 'FAIL: T3a ต้องล้ม คำสั่ง %', split_part(call, '(', 1); end if;
    if call not like '%set_category_archived%' and r not like 'PT412|%' then raise exception 'FAIL: T3b ต้อง PT412 (ได้ %) คำสั่ง %', r, split_part(call, '(', 1); end if;
    if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T3c ข้อมูลของผู้ล็อกอินต้องไม่เปลี่ยน คำสั่ง %', split_part(call, '(', 1); end if;
    if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T3d ข้อมูลของอีกคนต้องไม่เปลี่ยน คำสั่ง %', split_part(call, '(', 1); end if;
  end loop;

  -- T4 หัวคำขอตรง = ทำงานเหมือนเดิม · และหัวคำขอไม่ใช่ทางข้าม RLS (A บอกว่าเป็น A ก็ยังแตะของ B ไม่ได้)
  perform pg_temp.login(ua);
  perform pg_temp.headers(ua::text);
  perform public.create_entry(one);
  perform pg_temp.settle();
  perform public.merge_settings('{"payDay": 3}'::jsonb, '{}');
  insert into public.bills (id, name, amount, due_day, start_month) values ('bill-a', 'a', 100, 1, '2026-11');
  update public.bills set name = 'a2' where id = 'bill-a';
  delete from public.bills where id = 'bill-a';
  delete from public.bills where id = 'bill-b';
  delete from public.entries where id = 'e2';
  perform pg_temp.settle();
  perform pg_temp.logout();
  if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T4a ข้อมูลของอีกคนต้องไม่เปลี่ยน'; end if;
  if (select value->>'payDay' from public.settings where user_id = ua) is distinct from '3' or exists (select 1 from public.entries where user_id = ua and id = 'e2') then
    raise exception 'FAIL: T4b คำสั่งของผู้ใช้ที่ตรงกันต้องสำเร็จ';
  end if;

  -- T5 ลบบัญชีด้วยหัวคำขอตรง: การลบต่อเนื่อง (cascade) ผ่าน trigger ได้
  perform pg_temp.login(ua);
  perform pg_temp.headers(ua::text);
  r := public.delete_my_account_step_as(ua, 'new-password-1');
  perform pg_temp.settle();
  perform pg_temp.logout();
  if r <> 'done' or exists (select 1 from auth.users where id = ua) then raise exception 'FAIL: T5a ลบบัญชีตัวเองต้องสำเร็จ (ได้ %)', r; end if;
  if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T5b ข้อมูลของอีกคนต้องไม่ถูกแตะตลอดการทดสอบ'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
