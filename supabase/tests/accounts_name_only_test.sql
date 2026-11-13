-- ทดสอบ migration 20261113000600: ผู้ใช้แก้ accounts ได้เฉพาะ name · คอลัมน์อื่น = 42501 · trigger accounts_guard ยังทำงาน · ไม่รั่วข้ามผู้ใช้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261113000600_accounts_update_name_only** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate; end $$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlerrm; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.settle(), pg_temp.state_of(text), pg_temp.msg_of(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  st text;
  r text;
  n integer;
  v text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"w2","type":"asset","name":"w2","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]},{"id":"e1","date":"2026-11-02","memo":"x","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-ano@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-ano@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;

  -- T1 สิทธิ์ในแคตตาล็อก: authenticated แก้ได้เฉพาะ name · ไม่มีสิทธิ์ update ระดับตาราง · anon ไม่มีเลย
  if not has_column_privilege('authenticated', 'public.accounts', 'name', 'update') then raise exception 'FAIL: T1 authenticated แก้ name ไม่ได้'; end if;
  select count(*) into n from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'accounts' and c.column_name <> 'name'
     and has_column_privilege('authenticated', 'public.accounts', c.column_name, 'update');
  if n <> 0 then raise exception 'FAIL: T1 authenticated ยังแก้คอลัมน์อื่นของ accounts ได้ (% คอลัมน์)', n; end if;
  if has_table_privilege('authenticated', 'public.accounts', 'update') then raise exception 'FAIL: T1 authenticated มีสิทธิ์ update ระดับตาราง'; end if;
  if has_table_privilege('anon', 'public.accounts', 'update') or has_table_privilege('anon', 'public.accounts', 'select') then raise exception 'FAIL: T1 anon มีสิทธิ์บน accounts'; end if;
  -- สิทธิ์ที่เหลือคงเดิม (select/insert/delete)
  if not (has_table_privilege('authenticated', 'public.accounts', 'select') and has_table_privilege('authenticated', 'public.accounts', 'insert') and has_table_privilege('authenticated', 'public.accounts', 'delete')) then
    raise exception 'FAIL: T1 สิทธิ์ select/insert/delete ของ authenticated เปลี่ยนไป';
  end if;

  -- เตรียม: RPC เดิมยังสร้างบัญชี/รายการได้ (setup_ledger = insert ... ไม่ต้องการ update)
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();

  -- T2 แก้ name ได้ (กระเป๋าที่มีรายการแล้วก็ได้) และทุกอย่างอื่นคงเดิม
  update public.accounts set name = 'เงินสดหลัก' where id = 'w1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: T2 แก้ name ไม่ได้ (% แถว)', n; end if;
  select name into v from public.accounts where id = 'w1';
  if v is distinct from 'เงินสดหลัก' then raise exception 'FAIL: T2 name ไม่เปลี่ยน (%)', v; end if;
  select count(*) into n from public.lines where account_id = 'w1';
  if n <> 2 then raise exception 'FAIL: T2 รายการของ w1 เปลี่ยน (%)', n; end if;

  -- T3 แก้คอลัมน์อื่น = 42501 ทุกคอลัมน์ ทั้งชุดเดียวและปนกับ name · ค่าไม่เปลี่ยน
  for r in select unnest(array['id', 'type', 'currency', 'kind', 'archived', 'sort_order', 'user_id']) loop
    st := pg_temp.state_of(format($$ update public.accounts set %I = (select %I from public.accounts where id = 'w2') where id = 'w2' $$, r, r));
    if st is distinct from '42501' then raise exception 'FAIL: T3 แก้คอลัมน์ % ต้องได้ 42501 (ได้ %)', r, st; end if;
  end loop;
  st := pg_temp.state_of($$ update public.accounts set name = 'ชื่อใหม่', currency = 'USD' where id = 'w2' $$);
  if st is distinct from '42501' then raise exception 'FAIL: T3 แก้ name ปนคอลัมน์อื่นต้องได้ 42501 (ได้ %)', st; end if;
  st := pg_temp.state_of($$ update public.accounts set type = 'expense' where id = 'w2' $$);
  if st is distinct from '42501' then raise exception 'FAIL: T3 เปลี่ยน type ต้องได้ 42501 (ได้ %)', st; end if;
  select name into v from public.accounts where id = 'w2';
  if v is distinct from 'w2' then raise exception 'FAIL: T3 ชื่อ w2 เปลี่ยนทั้งที่คำสั่งถูกปฏิเสธ (%)', v; end if;
  -- upsert ที่ต้อง update คอลัมน์อื่น (on conflict do update) ถูกปฏิเสธ · do nothing ยังได้ (RPC เดิมใช้แบบนี้)
  st := pg_temp.state_of($$ insert into public.accounts (id, type, name, currency) values ('w2', 'asset', 'x', 'USD') on conflict (user_id, id) do update set currency = excluded.currency $$);
  if st is distinct from '42501' then raise exception 'FAIL: T3 upsert แก้ currency ต้องได้ 42501 (ได้ %)', st; end if;
  insert into public.accounts (id, type, name, currency) values ('w2', 'asset', 'x', 'THB') on conflict (user_id, id) do nothing;

  -- T4 ลบ/เพิ่มบัญชีทางเดิมยังได้ (insert/delete ไม่กระทบ) · RPC เดิมที่เกี่ยวกับ accounts ยังทำงาน
  insert into public.accounts (id, type, name, currency) values ('w3', 'asset', 'ใหม่', 'THB');
  delete from public.accounts where id = 'w3';
  perform public.create_entry('{"id":"e2","date":"2026-11-03","memo":"y","lines":[{"accountId":"food","amount":50},{"accountId":"w1","amount":-50}]}'::jsonb);
  perform pg_temp.settle();
  perform pg_temp.logout();

  -- T5 trigger accounts_guard ยังทำงาน (ด่านชั้นสอง) กับ role ที่มีสิทธิ์ผู้ดูแล: เปลี่ยนสกุลเงินของบัญชีที่มีรายการแล้วไม่ได้
  r := pg_temp.msg_of(format($$ update public.accounts set currency = 'USD' where id = 'w1' and user_id = '%s' $$, ua));
  if r is null or r not like '%สกุลเงิน%' then raise exception 'FAIL: T5 trigger accounts_guard ไม่ทำงาน (%)', r; end if;
  -- ผู้ดูแลแก้ name ได้ตามปกติ
  update public.accounts set name = 'ผู้ดูแลแก้' where id = 'w2' and user_id = ua;
  select name into v from public.accounts where id = 'w2' and user_id = ua;
  if v is distinct from 'ผู้ดูแลแก้' then raise exception 'FAIL: T5 ผู้ดูแลแก้ name ไม่ได้'; end if;

  -- T6 ผู้ใช้ B แก้ name ของ A ไม่ได้ (RLS: 0 แถว) และส่ง user_id ของ A เพื่อย้ายแถวไม่ได้
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  update public.accounts set name = 'B แก้' where user_id = ua;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: T6 B แก้ name ของ A ได้ (% แถว)', n; end if;
  st := pg_temp.state_of(format($$ update public.accounts set user_id = '%s' where id = 'w2' $$, ua));
  if st is distinct from '42501' then raise exception 'FAIL: T6 B เปลี่ยน user_id ต้องได้ 42501 (ได้ %)', st; end if;
  perform pg_temp.logout();
  select name into v from public.accounts where id = 'w1' and user_id = ua;
  if v is distinct from 'เงินสดหลัก' then raise exception 'FAIL: T6 ชื่อของ A ถูกเปลี่ยนโดย B (%)', v; end if;

  -- T7 anon ไม่มีสิทธิ์เลย
  execute 'set local role anon';
  st := pg_temp.state_of($$ update public.accounts set name = 'anon' $$);
  execute 'reset role';
  if st is distinct from '42501' then raise exception 'FAIL: T7 anon update ต้องได้ 42501 (ได้ %)', st; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
