-- ทดสอบ migration 20261128000100_expected_user_guard: ตัวห่อ *_as ตรวจผู้ใช้ที่หน้าจอตั้งใจในธุรกรรมเดียวกับการเขียน/ล้าง
-- วิธีรัน: **หลังใส่ migration** · จบด้วย raise TESTS_PASSED (ย้อนกลับทั้งหมด ไม่มีข้อมูลทดสอบเหลือ)

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
-- ภาพข้อมูลทั้งหมดของผู้ใช้ (อ่านด้วยสิทธิ์ผู้ดูแล) ใช้เทียบว่า "ไม่มีอะไรเปลี่ยน" · รวมจำนวนครั้งที่ใส่รหัสผิด
create function pg_temp.snap(p_user uuid) returns text language sql as $$
  select concat_ws('|',
    (select count(*) from auth.users where id = p_user),
    (select coalesce(string_agg(to_jsonb(x)::text, ';' order by x.id), '') from public.accounts x where x.user_id = p_user),
    (select coalesce(string_agg(to_jsonb(x)::text, ';' order by x.id), '') from public.entries x where x.user_id = p_user),
    (select count(*) from public.lines where user_id = p_user),
    (select coalesce(string_agg(to_jsonb(x)::text, ';' order by x.id), '') from public.bills x where x.user_id = p_user),
    (select coalesce(string_agg(x.value::text, ';'), '') from public.settings x where x.user_id = p_user),
    (select coalesce(string_agg(to_jsonb(x)::text, ';' order by x.id), '') from public.asset_categories x where x.user_id = p_user),
    (select count(*) from public.assets where user_id = p_user),
    (select count(*) from private.import_sessions where user_id = p_user),
    (select count(*) from private.delete_attempts where user_id = p_user))
$$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid(); -- ผู้ที่ล็อกอินอยู่ตอนนี้
  ub uuid := gen_random_uuid(); -- ผู้ใช้ที่หน้าจอ "ตั้งใจ" (บัญชีเดิมของอีกแท็บ) และผู้ที่ต้องไม่ถูกแตะ
  r text;
  v text;
  before_a text;
  before_b text;
  wrong text;
  call text;
  calls text[];
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
  data jsonb;
  more jsonb := '[{"id":"e2","date":"2026-11-02","memo":"x","source":"manual","createdAt":"2026-11-02T03:00:00.000Z","lines":[{"accountId":"w1","amount":100},{"accountId":"open","amount":-100}]}]';
  sig text;
  sigs text[] := array[
    'public.setup_ledger_as(uuid, jsonb, jsonb)',
    'public.import_ledger_as(uuid, jsonb)',
    'public.import_ledger_begin_as(uuid, jsonb, integer)',
    'public.import_ledger_append_as(uuid, jsonb)',
    'public.import_ledger_abort_as(uuid)',
    'public.import_ledger_investments_as(uuid, jsonb)',
    'public.import_ledger_investments_replacing_categories_as(uuid, jsonb, integer)',
    'public.reset_my_ledger_step_as(uuid, text)',
    'public.delete_my_account_step_as(uuid, text)'];
begin
  data := jsonb_build_object('accounts', acc, 'bills', '[]'::jsonb, 'entries', ent, 'settings', '{"payDay":25}'::jsonb);

  -- T1 สิทธิ์และรูปแบบ: anon เรียกไม่ได้ · authenticated เรียกได้ · ตัวห่อและตัวตรวจเป็น security invoker และตรึง search_path
  foreach sig in array sigs || array['private.assert_expected_user(uuid)'] loop
    if has_function_privilege('anon', sig, 'execute') then raise exception 'FAIL: T1 anon เรียกได้ %', sig; end if;
    if not has_function_privilege('authenticated', sig, 'execute') then raise exception 'FAIL: T1 authenticated เรียกไม่ได้ %', sig; end if;
    if (select p.prosecdef from pg_proc p where p.oid = sig::regprocedure) then raise exception 'FAIL: T1 ต้องเป็น security invoker %', sig; end if;
    if not coalesce((select 'search_path=""' = any(p.proconfig) from pg_proc p where p.oid = sig::regprocedure), false) then raise exception 'FAIL: T1 ต้องตรึง search_path เป็นค่าว่าง %', sig; end if;
  end loop;

  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  select u, e || '@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (ua, 'a-exp'), (ub, 'b-exp')) x(u, e);
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id in (ua, ub);
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ub);
  perform public.setup_ledger_as(ub, acc, ent);
  perform pg_temp.settle();
  perform pg_temp.logout();
  before_b := pg_temp.snap(ub);

  -- T2 ผู้ใช้ไม่ตรง (บัญชีอื่น หรือว่าง) = PT412 ทุกตัว ก่อนฟังก์ชันเดิมทำอะไร · ทำสองรอบ: ตอน A ยังว่าง (ทางเขียน) และตอน A มีข้อมูล (ทางล้าง)
  for round in 1..2 loop
    before_a := pg_temp.snap(ua);
    foreach wrong in array array[format('%L::uuid', ub), 'null::uuid'] loop
      calls := array[
        format('select public.setup_ledger_as(%s, %L::jsonb, %L::jsonb)', wrong, acc, ent),
        format('select public.import_ledger_as(%s, %L::jsonb)', wrong, data),
        format('select public.import_ledger_begin_as(%s, %L::jsonb, 2)', wrong, data),
        format('select public.import_ledger_append_as(%s, %L::jsonb)', wrong, more),
        format('select public.import_ledger_abort_as(%s)', wrong),
        format('select public.import_ledger_investments_as(%s, %L::jsonb)', wrong, '{"categories":[{"id":"c9","name":"X","targetBps":10000}]}'),
        format('select public.import_ledger_investments_replacing_categories_as(%s, %L::jsonb, 0)', wrong, '{}'),
        format('select public.reset_my_ledger_step_as(%s, %L)', wrong, 'new-password-1'),
        format('select public.reset_my_ledger_step_as(%s, %L)', wrong, 'wrong-password'),
        format('select public.delete_my_account_step_as(%s, %L)', wrong, 'new-password-1')];
      foreach call in array calls loop
        perform pg_temp.login(ua);
        r := pg_temp.fails(call);
        perform pg_temp.logout();
        if r is null or r not like 'PT412|%' then raise exception 'FAIL: T2 รอบ % ต้อง PT412 (ได้ %) คำสั่ง %', round, r, split_part(call, '(', 1); end if;
        if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T2 รอบ % ข้อมูลของผู้ล็อกอินต้องไม่เปลี่ยน คำสั่ง %', round, split_part(call, '(', 1); end if;
        if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T2 รอบ % ข้อมูลของอีกคนต้องไม่เปลี่ยน คำสั่ง %', round, split_part(call, '(', 1); end if;
      end loop;
    end loop;
    if round = 1 then
      perform pg_temp.login(ua);
      perform public.setup_ledger_as(ua, acc, ent);
      perform pg_temp.settle();
      perform pg_temp.logout();
      if (select count(*) from public.accounts where user_id = ua) <> 2 then raise exception 'FAIL: T2 ตั้งต้นด้วยผู้ใช้ตรงกันต้องสำเร็จ'; end if;
    end if;
  end loop;

  -- T3 ผู้ใช้ตรงกัน = พฤติกรรมของฟังก์ชันเดิม · รหัสผิดยังตอบ wrong และถูกนับ
  perform pg_temp.login(ua);
  v := public.reset_my_ledger_step_as(ua, 'wrong-password');
  perform pg_temp.logout();
  if v <> 'wrong' then raise exception 'FAIL: T3a รหัสผิดต้อง wrong (ได้ %)', v; end if;
  if (select count(*) from private.delete_attempts where user_id = ua) <> 1 then raise exception 'FAIL: T3b ต้องนับการใส่รหัสผิด'; end if;
  perform pg_temp.login(ua);
  v := public.reset_my_ledger_step_as(ua, 'new-password-1');
  perform pg_temp.settle();
  perform pg_temp.logout();
  if v <> 'done' or exists (select 1 from public.accounts where user_id = ua) then raise exception 'FAIL: T3c ล้างด้วยผู้ใช้ตรงกันต้องสำเร็จ (ได้ %)', v; end if;

  -- T4 นำเข้าครั้งเดียว + ข้อมูลลงทุน (ทางปกติและทางแทนหมวด)
  perform pg_temp.login(ua);
  perform public.import_ledger_as(ua, data);
  perform pg_temp.settle();
  perform public.import_ledger_investments_as(ua, '{"categories":[{"id":"c1","name":"A","targetBps":10000}]}'::jsonb);
  perform pg_temp.settle();
  perform public.import_ledger_investments_replacing_categories_as(ua, '{}'::jsonb, 1);
  perform pg_temp.settle();
  perform pg_temp.logout();
  if (select count(*) from public.entries where user_id = ua) <> 1 or exists (select 1 from public.asset_categories where user_id = ua) then
    raise exception 'FAIL: T4 นำเข้าและแทนหมวดด้วยผู้ใช้ตรงกันต้องสำเร็จ';
  end if;

  -- T5 แบ่งก้อน: begin → append ครบ = ปิดเซสชัน (abort ตอบ none) · begin ค้าง = abort ล้างได้
  perform pg_temp.login(ua);
  v := public.reset_my_ledger_step_as(ua, 'new-password-1');
  perform pg_temp.settle();
  perform public.import_ledger_begin_as(ua, data, 2);
  perform pg_temp.settle();
  perform public.import_ledger_append_as(ua, more);
  perform pg_temp.settle();
  v := public.import_ledger_abort_as(ua);
  perform pg_temp.logout();
  if v <> 'none' or (select count(*) from public.entries where user_id = ua) <> 2 then raise exception 'FAIL: T5a แบ่งก้อนครบต้องเข้า 2 รายการและ abort ตอบ none (ได้ %)', v; end if;
  if (select value->>'payDay' from public.settings where user_id = ua) is distinct from '25' then raise exception 'FAIL: T5c การตั้งค่าของไฟล์ต้องถูกบันทึกในการนำเข้าแบบแบ่งก้อน'; end if;
  perform pg_temp.login(ua);
  v := public.reset_my_ledger_step_as(ua, 'new-password-1');
  perform pg_temp.settle();
  perform public.import_ledger_begin_as(ua, data, 3);
  perform pg_temp.settle();
  v := public.import_ledger_abort_as(ua);
  perform pg_temp.settle();
  perform pg_temp.logout();
  if v <> 'done' or exists (select 1 from public.accounts where user_id = ua) then raise exception 'FAIL: T5b ล้างส่วนค้างต้องสำเร็จ (ได้ %)', v; end if;

  -- T6 ลบบัญชีด้วยผู้ใช้ตรงกัน: ลบเฉพาะของตัวเอง
  perform pg_temp.login(ua);
  v := public.delete_my_account_step_as(ua, 'new-password-1');
  perform pg_temp.settle();
  perform pg_temp.logout();
  if v <> 'done' or exists (select 1 from auth.users where id = ua) then raise exception 'FAIL: T6a ลบบัญชีตัวเองต้องสำเร็จ (ได้ %)', v; end if;
  if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T6b ข้อมูลของอีกคนต้องไม่ถูกแตะตลอดการทดสอบ'; end if;

  -- T7 anon เรียกจริงไม่ได้
  execute 'set local role anon';
  r := pg_temp.fails(format('select public.import_ledger_abort_as(%L::uuid)', ub));
  perform pg_temp.logout();
  if r is null or r not like '42501|%' then raise exception 'FAIL: T7 anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
