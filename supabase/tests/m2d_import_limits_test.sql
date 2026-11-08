-- ทดสอบ M2-D1 รอบ 2: เพดานนำเข้า, รอบบิลอนาคตถูกปฏิเสธแม้ตอนนำเข้า (R15), ลิงก์ไปบิลที่ถูกลบนำเข้าได้และลบจากสมุดได้
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) หลังใส่ migration 20261108001000 แล้ว · จบด้วย rollback: TESTS_PASSED = ผ่าน

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
  r text;
  n integer;
  v jsonb;
  acc text := '"accounts":[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"food","type":"expense","name":"food","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  many_lines jsonb;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-lim@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  perform pg_temp.login(ua);

  -- T1 รอบบิลอนาคตถูกปฏิเสธแม้ตอนนำเข้า (R15) · ไม่เหลือแถวค้าง
  r := pg_temp.fails('select public.import_ledger(''{' || acc || ',"bills":[],"entries":[{"id":"p","date":"2026-11-02","memo":"","source":"recurring","bill":{"id":"b1","cycle":"2999-12"},"lines":[{"accountId":"food","amount":10},{"accountId":"w1","amount":-10}]}]}''::jsonb)');
  if r is null or r not like '%เดือนปัจจุบัน%' then raise exception 'FAIL: T1 รอบอนาคตถูกนำเข้า (%)', r; end if;
  select count(*) into n from public.accounts;
  if n <> 0 then raise exception 'FAIL: T1 ล้มแล้วยังเหลือบัญชี'; end if;

  -- T2 ลิงก์ไปบิลที่ไม่มีในไฟล์ (บิลถูกลบไปแล้ว) นำเข้าได้ และลบรายการนั้นได้จากสมุดบัญชี
  v := public.import_ledger(('{' || acc || ',"bills":[],"entries":[{"id":"open1","date":"2026-11-01","memo":"","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]},{"id":"p","date":"2026-11-02","memo":"","source":"recurring","bill":{"id":"gone","cycle":"2026-10"},"lines":[{"accountId":"food","amount":10},{"accountId":"w1","amount":-10}]}]}')::jsonb);
  perform pg_temp.settle();
  if v->>'entries' <> '2' then raise exception 'FAIL: T2 นำเข้าไม่ครบ %', v; end if;
  delete from public.entries where id = 'p';
  perform pg_temp.settle();
  select count(*) into n from public.entries;
  if n <> 1 then raise exception 'FAIL: T2 ลบรายการที่ผูกบิลที่ถูกลบไม่ได้ (%)', n; end if;
  perform pg_temp.logout();

  -- T3 เพดานบรรทัดต่อรายการ (200) และรายการ (1,500)
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (gen_random_uuid(), 'b-lim@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where email = 'b-lim@users.money-buddy.internal';
  perform pg_temp.login((select id from auth.users where email = 'b-lim@users.money-buddy.internal'));
  select jsonb_agg(jsonb_build_object('accountId', case when g % 2 = 0 then 'food' else 'w1' end, 'amount', case when g % 2 = 0 then 1 else -1 end))
    into many_lines from generate_series(1, 202) g;
  r := pg_temp.fails($$ select public.import_ledger(jsonb_build_object('accounts', '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"food","type":"expense","name":"f","currency":"THB"}]'::jsonb, 'entries', jsonb_build_array(jsonb_build_object('id','x','date','2026-11-01','memo','','lines', $$ || quote_literal(many_lines::text) || $$::jsonb)))) $$);
  if r is null or r not like '%เกินเพดาน%' then raise exception 'FAIL: T3 บรรทัดเกินเพดานถูกรับ (%)', r; end if;
  r := pg_temp.fails($$ select public.import_ledger(jsonb_build_object('accounts','[]'::jsonb,'entries',(select jsonb_agg('{"id":"e","lines":[]}'::jsonb) from generate_series(1,1501)))) $$);
  if r is null or r not like '%เกินเพดาน%' then raise exception 'FAIL: T3 รายการเกินเพดานถูกรับ (%)', r; end if;
  r := pg_temp.fails($$ select public.import_ledger('{"accounts":[],"entries":[{"id":"x","lines":"no"}]}'::jsonb) $$);
  if r is null then raise exception 'FAIL: T3 lines ไม่ใช่อาร์เรย์ถูกรับ'; end if;
  perform pg_temp.logout();

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
