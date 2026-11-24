-- ทดสอบ migration 20261124000300_bill_link_conflict_code: จ่ายบิลด้วย before ที่ไม่ตรง = PT409 (ไม่ใช่ 40001) และไม่เขียนอะไร · จ่ายปกติยังผ่าน · นิยามไม่มี 40001
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration · จบด้วย rollback: TESTS_PASSED · ข้อมูลสมมติ
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
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  r text;
  v_paid text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000000},{"accountId":"open","amount":-1000000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-bl@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id = ua;
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.bills (id, name, amount, due_day, wallet_id, category_id, start_month) values ('bill1', 'ค่าเน็ต', 59900, 5, 'w1', 'food', private.current_month());
  -- T1 before ไม่ตรง (บิลยังไม่เคยจ่าย = null แต่ส่ง 2020-01) → PT409 และไม่เขียนอะไร
  r := pg_temp.fails(format($q$ select public.create_entry('{"id":"p-bad","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"%s","before":"2020-01"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}'::jsonb) $q$, private.current_month()));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T1 before ไม่ตรงต้อง PT409 (ได้ %)', r; end if;
  select last_paid_month into v_paid from public.bills where id = 'bill1';
  if v_paid is not null then raise exception 'FAIL: T1 ถูกปฏิเสธแล้ว lastPaidMonth เปลี่ยน (%)', v_paid; end if;
  -- T2 จ่ายปกติ (before = null) ยังผ่านและตั้ง lastPaidMonth
  perform public.create_entry(format('{"id":"p-ok","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"%s"},"lines":[{"accountId":"food","amount":59900},{"accountId":"w1","amount":-59900}]}', private.current_month())::jsonb);
  perform pg_temp.settle();
  select last_paid_month into v_paid from public.bills where id = 'bill1';
  if v_paid is distinct from private.current_month() then raise exception 'FAIL: T2 จ่ายปกติแล้ว lastPaidMonth ไม่ถูกตั้ง (%)', v_paid; end if;
  -- T3 แท็บเก่า (ยังเห็นบิลว่าง before = null) จ่ายรอบก่อนหน้า ทั้งที่บิลถูกจ่ายรอบปัจจุบันไปแล้ว = PT409
  --   (จ่ายรอบเดิมซ้ำจะชนดัชนี entries_bill_cycle_once_idx 23505 ก่อน trigger ตามออกแบบ จึงใช้รอบก่อนหน้าเพื่อให้ถึงด่าน before)
  r := pg_temp.fails(format($q$ select public.create_entry('{"id":"p-dup","date":"2026-11-04","source":"recurring","bill":{"id":"bill1","cycle":"%s"},"lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}'::jsonb) $q$, to_char(date_trunc('month', now()) - interval '1 month', 'YYYY-MM')));
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T3 แท็บเก่าจ่ายซ้ำต้อง PT409 (ได้ %)', r; end if;
  -- T4 นิยามฟังก์ชันไม่มี errcode 40001 และมี PT409 · ชนิดฟังก์ชันไม่เปลี่ยน
  perform pg_temp.logout();
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'private' and p.proname = 'entries_bill_link'
         and pg_get_functiondef(p.oid) !~ 'errcode = ''40001''' and pg_get_functiondef(p.oid) ~ 'errcode = ''PT409''' and not p.prosecdef
         and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')) <> 1 then
    raise exception 'FAIL: T4 นิยาม entries_bill_link ไม่ตรง (ยังมี 40001 / ไม่มี PT409 / ชนิดฟังก์ชันเปลี่ยน / search_path ไม่ว่าง)';
  end if;
  -- T5 trigger entries_bill_link_trg ยังอยู่และยังชี้ไปที่ฟังก์ชันนี้
  if (select count(*) from pg_trigger t where t.tgname = 'entries_bill_link_trg' and not t.tgisinternal
        and t.tgfoid = 'private.entries_bill_link'::regproc) <> 1 then
    raise exception 'FAIL: T5 trigger entries_bill_link_trg หายหรือไม่ชี้ไปที่ private.entries_bill_link';
  end if;
  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
