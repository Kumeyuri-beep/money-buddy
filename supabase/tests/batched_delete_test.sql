-- ทดสอบ: ล้างข้อมูล/ลบบัญชีแบบเป็นชุด (reset_my_ledger_step / delete_my_account_step) และ import_ledger_abort ฉบับจำกัดบรรทัด
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261109000400 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

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
-- ล็อกอินด้วย JWT เดิมโดยไม่สร้าง session ใหม่ (ทดสอบ session ที่ถูกเพิกถอนกลางลูป)
create function pg_temp.login_existing(p_user uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', md5(p_user::text)::uuid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

-- สร้างข้อมูลจำนวนมากแบบเร็ว (ในฐานะผู้ดูแล): n รายการ รายการละ p_lines บรรทัด (เลขคู่ สมดุล) + รายการ system + รายการจ่ายบิลที่ผูกบิล + บิล + ตั้งค่า
create function pg_temp.seed(p_user uuid, p_prefix text, p_n integer, p_lines integer default 2) returns void language plpgsql as $$
begin
  insert into public.accounts (user_id, id, type, name, currency) values (p_user, 'w1', 'asset', 'w1', 'THB'), (p_user, 'food', 'expense', 'food', 'THB'), (p_user, 'open', 'equity', 'open', 'THB');
  insert into public.bills (user_id, id, name, amount, due_day, wallet_id, category_id) values (p_user, 'bill-' || p_prefix, 'b', 100, 5, 'w1', 'food');
  insert into public.entries (user_id, id, date, memo, source) select p_user, p_prefix || i, date '2026-11-02', '', 'manual' from generate_series(1, p_n) i;
  insert into public.lines (user_id, entry_id, idx, account_id, amount)
    select p_user, p_prefix || i, j, case when j % 2 = 1 then 'food' else 'w1' end, case when j % 2 = 1 then 1 else -1 end from generate_series(1, p_n) i, generate_series(1, p_lines) j;
  -- ยอดยกมา (system) และรายการจ่ายบิล (recurring ผูกบิล+รอบ → trigger ตั้ง last_paid_month)
  insert into public.entries (user_id, id, date, memo, source) values (p_user, 'sys-' || p_prefix, date '2026-11-01', 'open', 'system');
  insert into public.lines (user_id, entry_id, idx, account_id, amount) values (p_user, 'sys-' || p_prefix, 1, 'w1', 1000), (p_user, 'sys-' || p_prefix, 2, 'open', -1000);
  insert into public.entries (user_id, id, date, memo, source, bill_id, bill_cycle) values (p_user, 'pay-' || p_prefix, date '2026-11-05', 'pay', 'recurring', 'bill-' || p_prefix, '2026-11');
  insert into public.lines (user_id, entry_id, idx, account_id, amount) values (p_user, 'pay-' || p_prefix, 1, 'food', 100), (p_user, 'pay-' || p_prefix, 2, 'w1', -100);
  insert into public.settings (user_id, value) values (p_user, '{"payDay":25}'::jsonb);
end $$;

create function pg_temp.mkuser(p_id uuid, p_tag text) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (p_id, p_tag || '-bd@users.money-buddy.internal', extensions.crypt('old-password', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
end $$;

-- นับจำนวนที่เหลือของผู้ใช้ (ผู้ดูแลอ่านได้ทุกคน)
create function pg_temp.left_rows(p_user uuid) returns integer language sql as $$
  select ((select count(*) from public.entries where user_id = p_user) + (select count(*) from public.lines where user_id = p_user)
        + (select count(*) from public.accounts where user_id = p_user) + (select count(*) from public.bills where user_id = p_user)
        + (select count(*) from public.settings where user_id = p_user))::integer
$$;
grant execute on function pg_temp.left_rows(uuid) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  ud uuid := gen_random_uuid();
  ue uuid := gen_random_uuid();
  uf uuid := gen_random_uuid();
  ug uuid := gen_random_uuid();
  r text;
  n integer;
  steps integer;
  v_attempts integer;
begin
  perform pg_temp.mkuser(ua, 'a'); perform pg_temp.mkuser(ub, 'b'); perform pg_temp.mkuser(uc, 'c'); perform pg_temp.mkuser(ud, 'd');
  perform pg_temp.mkuser(ue, 'e'); perform pg_temp.mkuser(uf, 'f'); perform pg_temp.mkuser(ug, 'g');

  -- T1 ยังไม่เปลี่ยนรหัส = ทุกฟังก์ชันปฏิเสธ
  perform pg_temp.login(ua);
  if pg_temp.fails($$ select public.reset_my_ledger_step('old-password') $$) is null then raise exception 'FAIL: T1 reset'; end if;
  if pg_temp.fails($$ select public.delete_my_account_step('old-password') $$) is null then raise exception 'FAIL: T1 delete'; end if;
  perform pg_temp.logout();
  update auth.users set encrypted_password = extensions.crypt('new-password', extensions.gen_salt('bf')) where id in (ua, ub, uc, ud, ue, uf, ug);

  -- T2 cooldown 24 ชม. ยังบังคับ (เพิ่งเปลี่ยนรหัส) ทั้งสองฟังก์ชัน · ไม่นับเป็นการลองรหัส
  perform pg_temp.login(ua);
  r := pg_temp.fails($$ select public.reset_my_ledger_step('new-password') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T2 reset ไม่ติด cooldown (%)', r; end if;
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T2 delete ไม่ติด cooldown (%)', r; end if;
  perform pg_temp.logout();
  select count(*) into v_attempts from private.delete_attempts where user_id = ua;
  if v_attempts <> 0 then raise exception 'FAIL: T2 cooldown ถูกนับเป็นการลองรหัส (%)', v_attempts; end if;

  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub, uc, ud, ue, uf, ug);
  perform pg_temp.seed(ua, 'a', 1200);
  perform pg_temp.seed(ub, 'b', 30);
  perform pg_temp.seed(uc, 'c', 1200);
  perform pg_temp.seed(ud, 'd', 100, 300);   -- รายการหนัก: 100 รายการ × 300 บรรทัด = 30,000 บรรทัด
  perform pg_temp.seed(ue, 'e', 3000);       -- 6 ชุด
  perform pg_temp.seed(uf, 'f', 1000);       -- พหุคูณของ 500 พอดี
  perform pg_temp.seed(ug, 'g', 10);
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200), (uc, 5000, 1200);

  -- T3 รหัสผิด = 'wrong' ไม่ลบอะไรเลย · ถูกจำกัดเมื่อผิดครบ 5 ครั้ง (แม้ใส่รหัสถูกหลังจากนั้น) ทั้งสองฟังก์ชัน
  perform pg_temp.login(ua);
  for i in 1..5 loop
    if public.reset_my_ledger_step('wrong-' || i) <> 'wrong' then raise exception 'FAIL: T3 รหัสผิดไม่คืน wrong (ครั้ง %)', i; end if;
  end loop;
  select count(*) into n from public.entries; if n <> 1202 then raise exception 'FAIL: T3 รหัสผิดแต่ข้อมูลหาย (%)', n; end if;
  r := pg_temp.fails($$ select public.reset_my_ledger_step('new-password') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T3 ไม่ถูกจำกัดการลองหลังผิด 5 ครั้ง (%)', r; end if;
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T3 delete ไม่ถูกจำกัด (%)', r; end if;
  perform pg_temp.logout();
  delete from private.delete_attempts where user_id = ua;

  -- T3b รหัสผิด 4 ครั้งแล้วรหัสถูกยังใช้ได้ · ตัวนับไม่เพิ่มตอนรหัสถูก (ยังเป็น 4)
  perform pg_temp.login(ug);
  for i in 1..4 loop
    if public.reset_my_ledger_step('bad-' || i) <> 'wrong' then raise exception 'FAIL: T3b รหัสผิดไม่คืน wrong'; end if;
  end loop;
  if public.reset_my_ledger_step('new-password') <> 'done' then raise exception 'FAIL: T3b รหัสถูกหลังผิด 4 ครั้งต้องได้ done'; end if;
  perform pg_temp.logout();
  select count(*) into v_attempts from private.delete_attempts where user_id = ug;
  if v_attempts <> 4 then raise exception 'FAIL: T3b ตัวนับต้องเป็น 4 (นับเฉพาะรหัสผิด) ได้ %', v_attempts; end if;
  if pg_temp.left_rows(ug) <> 0 then raise exception 'FAIL: T3b ล้างแล้วยังเหลือแถว'; end if;

  -- T3c ตัวนับใช้ร่วมกับฟังก์ชันเดิม: ผิด 5 ครั้งด้วย reset_my_ledger เดิม แล้ว _step เห็นตัวนับและถูกจำกัด
  delete from private.delete_attempts where user_id = ub;
  perform pg_temp.login(ub);
  for i in 1..5 loop
    if public.reset_my_ledger('bad-old-' || i) then raise exception 'FAIL: T3c ฟังก์ชันเดิมรหัสผิดต้องคืน false'; end if;
  end loop;
  r := pg_temp.fails($$ select public.reset_my_ledger_step('new-password') $$);
  if r is null or r not like '%ลองผิดหลายครั้ง%' then raise exception 'FAIL: T3c _step ไม่เห็นตัวนับของฟังก์ชันเดิม (%)', r; end if;
  perform pg_temp.logout();
  delete from private.delete_attempts where user_id = ub;

  -- T4 ล้างเป็นชุดละ 500 → more, more, done (1,202 = 500 + 500 + 202) · รวมรายการ system และรายการจ่ายบิลที่ผูกบิล · ล้างเซสชันนำเข้าค้างด้วย · ผู้ใช้อื่นไม่ถูกแตะ
  perform pg_temp.login(ua);
  steps := 0;
  loop
    r := public.reset_my_ledger_step('new-password');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' then raise exception 'FAIL: T4 ผลไม่คาด % (ชุดที่ %)', r, steps; end if;
    if steps > 10 then raise exception 'FAIL: T4 วนไม่จบ'; end if;
    select count(*) into n from public.entries;
    if steps = 1 and n <> 702 then raise exception 'FAIL: T4 หลังชุดแรกเหลือ % <> 702', n; end if;
    if steps = 2 and n <> 202 then raise exception 'FAIL: T4 หลังชุดสองเหลือ % <> 202', n; end if;
  end loop;
  if steps <> 3 then raise exception 'FAIL: T4 จำนวนชุด % <> 3', steps; end if;
  perform pg_temp.settle();
  perform pg_temp.logout();
  if pg_temp.left_rows(ua) <> 0 then raise exception 'FAIL: T4 ล้างแล้วยังเหลือแถว (%)', pg_temp.left_rows(ua); end if;
  if not exists (select 1 from public.profiles where user_id = ua) then raise exception 'FAIL: T4 profile ต้องยังอยู่'; end if;
  if exists (select 1 from private.import_sessions where user_id = ua) then raise exception 'FAIL: T4 เซสชันนำเข้าค้างไม่ถูกล้าง'; end if;
  perform pg_temp.login(ub);
  select count(*) into n from public.entries; if n <> 32 then raise exception 'FAIL: T4 ข้อมูลของ B ถูกกระทบ (%)', n; end if;
  perform pg_temp.logout();

  -- T4b ลูปยาว 6 ชุด (3,002 รายการ) ไม่ชนเพดานการลอง: ตัวนับยังเป็น 0 เมื่อจบ
  perform pg_temp.login(ue);
  steps := 0;
  loop
    r := public.reset_my_ledger_step('new-password');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' then raise exception 'FAIL: T4b ผลไม่คาด %', r; end if;
    if steps > 10 then raise exception 'FAIL: T4b วนไม่จบ'; end if;
  end loop;
  if steps <> 7 then raise exception 'FAIL: T4b จำนวนชุด % <> 7 (3,002 รายการ = 500×6 + 2)', steps; end if;
  perform pg_temp.logout();
  select count(*) into v_attempts from private.delete_attempts where user_id = ue;
  if v_attempts <> 0 then raise exception 'FAIL: T4b ลูปยาวแล้วตัวนับไม่เป็น 0 (%)', v_attempts; end if;
  if pg_temp.left_rows(ue) <> 0 then raise exception 'FAIL: T4b ล้างแล้วยังเหลือแถว'; end if;

  -- T4c ชุดตามบรรทัด: 102 รายการ (100 × 300 บรรทัด + 2 รายการเล็ก) ชุดแรกต้องไม่เกิน ~20,000 บรรทัด (ลบได้ 66 รายการหนัก) แล้วยังเหลือ → more
  perform pg_temp.login(ud);
  select count(*) into n from public.entries; if n <> 102 then raise exception 'FAIL: T4c seed ผิด (%)', n; end if;
  if public.reset_my_ledger_step('new-password') <> 'more' then raise exception 'FAIL: T4c ชุดแรกต้องคืน more'; end if;
  select count(*) into n from public.entries;
  if n < 30 or n > 45 then raise exception 'FAIL: T4c ชุดแรกควรลบราว 66 รายการ (จำกัดบรรทัด) เหลือ % ', n; end if;
  steps := 1;
  loop
    r := public.reset_my_ledger_step('new-password');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' or steps > 6 then raise exception 'FAIL: T4c ผลไม่คาด % (ชุด %)', r, steps; end if;
  end loop;
  perform pg_temp.logout();
  if pg_temp.left_rows(ud) <> 0 then raise exception 'FAIL: T4c ล้างแล้วยังเหลือแถว'; end if;

  -- T5 ล้างสมุดว่างซ้ำ: done ทันที ไม่ error (วนซ้ำหลังเน็ตหลุดได้)
  perform pg_temp.login(ua);
  if public.reset_my_ledger_step('new-password') <> 'done' then raise exception 'FAIL: T5 สมุดว่างต้องได้ done'; end if;
  perform pg_temp.logout();

  -- T6 ลบบัญชีเป็นชุด (มีเซสชันนำเข้าค้างด้วย): C มี 1,202 รายการ → more, more, done · บัญชี C หาย · B ยังอยู่
  perform pg_temp.login(uc);
  steps := 0;
  loop
    r := public.delete_my_account_step('new-password');
    steps := steps + 1;
    exit when r = 'done';
    if r <> 'more' then raise exception 'FAIL: T6 ผลไม่คาด % (ชุดที่ %)', r, steps; end if;
    if steps > 10 then raise exception 'FAIL: T6 วนไม่จบ'; end if;
  end loop;
  if steps <> 3 then raise exception 'FAIL: T6 จำนวนชุด % <> 3', steps; end if;
  perform pg_temp.logout();
  perform pg_temp.settle();
  if pg_temp.left_rows(uc) + (select count(*) from public.profiles where user_id = uc)::integer + (select count(*) from auth.users where id = uc)::integer + (select count(*) from private.import_sessions where user_id = uc)::integer <> 0 then
    raise exception 'FAIL: T6 ลบบัญชีแล้วยังเหลือ';
  end if;
  if not exists (select 1 from auth.users where id = ub) then raise exception 'FAIL: T6 บัญชี B ถูกลบ'; end if;

  -- T6b พหุคูณของ 500 พอดี (1,002 = 500 + 500 + 2): ไม่มีชุดว่างเกิน · ลบบัญชีที่ชุดสุดท้าย
  -- (F ใช้ทดสอบกลางลูปด้านล่างด้วย จึงทดสอบกับ 1,002 รายการ: more, more, done)
  perform pg_temp.login(uf);
  if public.delete_my_account_step('new-password') <> 'more' then raise exception 'FAIL: T6b ชุดแรกต้องคืน more'; end if;
  perform pg_temp.logout();

  -- T6c กลางลูป: เปลี่ยนรหัสผ่านใหม่ (cooldown ใหม่) → ชุดถัดไปถูกปฏิเสธ ไม่ลบเพิ่ม
  update public.profiles set password_changed_at = now() where user_id = uf;
  perform pg_temp.login(uf);
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password') $$);
  if r is null or r not like '%24 ชั่วโมง%' then raise exception 'FAIL: T6c เปลี่ยนรหัสกลางลูปแล้วยังลบต่อได้ (%)', r; end if;
  perform pg_temp.logout();
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id = uf;

  -- T6d กลางลูป: session ถูกเพิกถอน → ชุดถัดไปถูกปฏิเสธ
  delete from auth.sessions where user_id = uf;
  perform pg_temp.login_existing(uf);
  r := pg_temp.fails($$ select public.delete_my_account_step('new-password') $$);
  if r is null then raise exception 'FAIL: T6d session ที่ถูกเพิกถอนยังลบต่อได้'; end if;
  perform pg_temp.logout();
  if not exists (select 1 from auth.users where id = uf) then raise exception 'FAIL: T6d บัญชีถูกลบด้วย session ที่เพิกถอนแล้ว'; end if;

  -- T6e ลบต่อหลังล็อกอินใหม่ได้: เหลือ 502 รายการ → more, done (ชุดละ 500 แล้วเหลือ 2 → ลบบัญชี)
  perform pg_temp.login(uf);
  if public.delete_my_account_step('new-password') <> 'more' then raise exception 'FAIL: T6e ควรคืน more'; end if;
  if public.delete_my_account_step('new-password') <> 'done' then raise exception 'FAIL: T6e ควรคืน done'; end if;
  perform pg_temp.logout();
  if exists (select 1 from auth.users where id = uf) then raise exception 'FAIL: T6e บัญชียังอยู่'; end if;

  -- T7 รหัสผิดตอนลบบัญชี = 'wrong' บัญชีไม่ถูกลบ
  perform pg_temp.login(ub);
  if public.delete_my_account_step('wrong-x') <> 'wrong' then raise exception 'FAIL: T7 รหัสผิดไม่คืน wrong'; end if;
  perform pg_temp.logout();
  if not exists (select 1 from auth.users where id = ub) then raise exception 'FAIL: T7 รหัสผิดแต่บัญชีถูกลบ'; end if;

  -- T7b import_ledger_abort ฉบับจำกัดบรรทัด: ผู้ใช้ B เปิดเซสชันค้างแล้ว abort ผ่านชุดเดียวกัน (ได้ done สำหรับสมุดเล็ก) · ไม่ติด cooldown
  delete from public.entries where user_id = ub;
  delete from public.bills where user_id = ub; delete from public.accounts where user_id = ub; delete from public.settings where user_id = ub;
  perform pg_temp.seed(ub, 'bb', 700);
  update public.profiles set password_changed_at = now() where user_id = ub;
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ub, 5000, 700);
  perform pg_temp.login(ub);
  if public.import_ledger_abort() <> 'more' then raise exception 'FAIL: T7b ชุดแรกควรคืน more'; end if;
  if public.import_ledger_abort() <> 'done' then raise exception 'FAIL: T7b ชุดสองควรคืน done'; end if;
  if public.import_ledger_abort() <> 'none' then raise exception 'FAIL: T7b หลัง done ควรคืน none'; end if;
  perform pg_temp.logout();
  if pg_temp.left_rows(ub) <> 0 then raise exception 'FAIL: T7b abort แล้วยังเหลือแถว'; end if;

  -- T8 เรียกแบบอ่านอย่างเดียว (GET) ถูกปฏิเสธ · anon เรียกไม่ได้ · ผู้ใช้เรียกตัวช่วย private ตรงๆ ไม่ได้
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id = ub;
  perform pg_temp.login(ub);
  r := pg_temp.fails($$ select set_config('transaction_read_only', 'on', true), public.reset_my_ledger_step('new-password') $$);
  if r is null or r not like '%เขียนได้%' then raise exception 'FAIL: T8 เรียกแบบอ่านอย่างเดียวไม่ถูกปฏิเสธด้วยเหตุผลที่ถูก (%)', r; end if;
  if pg_temp.fails($$ select private.deletion_gate('new-password') $$) is null then raise exception 'FAIL: T8 ผู้ใช้เรียก private.deletion_gate ตรงๆ ได้'; end if;
  if pg_temp.fails(format($$ select private.delete_entry_batch('%s') $$, ub)) is null then raise exception 'FAIL: T8 ผู้ใช้เรียก private.delete_entry_batch ตรงๆ ได้'; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  if pg_temp.fails($$ select public.reset_my_ledger_step('x') $$) is null then raise exception 'FAIL: T8 anon เรียก reset step ได้'; end if;
  if pg_temp.fails($$ select public.delete_my_account_step('x') $$) is null then raise exception 'FAIL: T8 anon เรียก delete step ได้'; end if;
  execute 'reset role';

  -- T9 สิทธิ์ในแคตตาล็อก: ฟังก์ชันเดิมยังอยู่ · _step เปิดให้ authenticated เท่านั้น · ตัวช่วย private ไม่มี PUBLIC/anon/authenticated
  if not has_function_privilege('authenticated', 'public.reset_my_ledger(text)', 'execute') then raise exception 'FAIL: T9 reset_my_ledger เดิมหาย'; end if;
  if not has_function_privilege('authenticated', 'public.delete_my_account(text)', 'execute') then raise exception 'FAIL: T9 delete_my_account เดิมหาย'; end if;
  if has_function_privilege('anon', 'public.reset_my_ledger_step(text)', 'execute') or has_function_privilege('anon', 'public.delete_my_account_step(text)', 'execute') then raise exception 'FAIL: T9 anon มีสิทธิ์'; end if;
  if not has_function_privilege('authenticated', 'public.reset_my_ledger_step(text)', 'execute') or not has_function_privilege('authenticated', 'public.delete_my_account_step(text)', 'execute') then raise exception 'FAIL: T9 authenticated ไม่มีสิทธิ์ _step'; end if;
  if exists (
    select 1 from pg_proc p where p.oid in ('private.deletion_gate(text)'::regprocedure, 'private.delete_entry_batch(uuid)'::regprocedure)
      and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))
  ) then raise exception 'FAIL: T9 ตัวช่วย private เปิดให้ PUBLIC'; end if;
  if has_function_privilege('authenticated', 'private.deletion_gate(text)', 'execute') or has_function_privilege('authenticated', 'private.delete_entry_batch(uuid)', 'execute') then raise exception 'FAIL: T9 authenticated เรียกตัวช่วย private ได้'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
