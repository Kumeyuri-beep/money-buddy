-- ทดสอบ migration 20261118000100_cash_adjustment (Invest v2 หน้า Cash · R16/R20/R23): record_cash_adjustment
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย raise TESTS_PASSED แล้ว rollback ไม่มีข้อมูลเหลือ · ข้อมูลสมมติล้วน

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
-- นับ/อ่านค่าด้วยสิทธิ์ผู้ดูแล (ข้าม RLS) แล้วกลับเป็นผู้ใช้เดิม
create function pg_temp.ac(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.logout();
  execute p_sql into n;
  perform pg_temp.login(p_user);
  return n;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.ac(uuid, text) to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  r text;
  n bigint;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-cash@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-cash@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values
    ('cash-usd', 'asset', 'เงินสด USD', 'USD', 'investment'),
    ('cash-thb', 'asset', 'เงินสดบาทพอร์ต', 'THB', 'investment'),
    ('inv-us', 'asset', 'หุ้นสหรัฐ ก', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency) values ('us1', 'หุ้นสหรัฐ ก', 'stock', 'inv-us', 'USD');

  -- T1 ฝาก USD 120.37 (12,037 เซนต์): สร้างบัญชีพัก USD พร้อมกัน · ยอดเงินสดเพิ่ม · ผลรวมสองบรรทัด 0
  perform public.record_cash_adjustment(
    '{"id":"ca1","date":"2026-11-02","memo":"ฝาก","source":"manual","lines":[{"accountId":"cash-usd","amount":12037},{"accountId":"inv-cash-adjust-usd","amount":-12037}]}'::jsonb,
    '[{"id":"inv-cash-adjust-usd"}]'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'cash-usd' $q$) <> 12037 then raise exception 'FAIL: T1 ยอดเงินสด USD ไม่ตรง'; end if;
  if (select type || currency from public.accounts where id = 'inv-cash-adjust-usd') is distinct from 'equityUSD' then raise exception 'FAIL: T1 บัญชีพัก USD ไม่ถูกสร้างเป็น equity USD'; end if;

  -- T2 ฝากบาท 5,000.00 (500,000 สตางค์) เข้าเงินสดบาทของพอร์ต
  perform public.record_cash_adjustment(
    '{"id":"ca2","date":"2026-11-02","source":"manual","lines":[{"accountId":"cash-thb","amount":500000},{"accountId":"inv-cash-adjust-thb","amount":-500000}]}'::jsonb,
    '[{"id":"inv-cash-adjust-thb"}]'::jsonb);
  perform pg_temp.settle();

  -- T3 ถอนบางส่วน (USD 20.37 = 2,037 เซนต์): ยอดเหลือ 10,000 · ใช้บัญชีพักที่มีอยู่แล้ว (ไม่สร้างซ้ำ)
  perform public.record_cash_adjustment(
    '{"id":"ca3","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":-2037},{"accountId":"inv-cash-adjust-usd","amount":2037}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'cash-usd' $q$) <> 10000 then raise exception 'FAIL: T3 ยอดหลังถอนไม่ตรง'; end if;

  -- T4 ถอนเกินยอดคงเหลือ (10,001 เซนต์ จากยอด 10,000) ไม่ได้ · ถอนพอดี (10,000) ได้ ยอดเป็น 0 แล้วฝากกลับได้
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"ca4","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":-10001},{"accountId":"inv-cash-adjust-usd","amount":10001}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4 ถอนเกินยอดต้องถูกปฏิเสธ (ได้ %)', r; end if;
  perform public.record_cash_adjustment('{"id":"ca4b","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":-10000},{"accountId":"inv-cash-adjust-usd","amount":10000}]}'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id = 'cash-usd' $q$) <> 0 then raise exception 'FAIL: T4 ถอนพอดีต้องเหลือ 0'; end if;
  perform public.record_cash_adjustment('{"id":"ca4c","date":"2026-11-04","source":"manual","lines":[{"accountId":"cash-usd","amount":10000},{"accountId":"inv-cash-adjust-usd","amount":-10000}]}'::jsonb);
  perform pg_temp.settle();

  -- T5 บัญชีที่ไม่ใช่เงินสดพอร์ตถูกปฏิเสธ: กระเป๋าบาททั่วไป (kind normal) · บัญชีที่ผูกหุ้น
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x5","date":"2026-11-03","source":"manual","lines":[{"accountId":"w1","amount":100},{"accountId":"inv-cash-adjust-thb","amount":-100}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5a กระเป๋าทั่วไปต้องถูกปฏิเสธ (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x5b","date":"2026-11-03","source":"manual","lines":[{"accountId":"inv-us","amount":100},{"accountId":"inv-cash-adjust-usd","amount":-100}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T5b บัญชีที่ผูกหุ้นต้องถูกปฏิเสธ (ได้ %)', r; end if;

  -- T6 สกุลไม่ตรง (เงินสด USD กับบัญชีพักบาท) · จำนวน 0 · จำนวนสองบรรทัดไม่หักล้างกัน · มี 3 บรรทัด · ชนิดรายการไม่ใช่ manual · บัญชีพักชื่ออื่น
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"inv-cash-adjust-thb","amount":-100}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T6a สกุลไม่ตรงต้องถูกปฏิเสธ (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6b","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"inv-cash-adjust-usd","amount":-99}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T6b ยอดไม่หักล้างต้องถูกปฏิเสธ'; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6c","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":0},{"accountId":"inv-cash-adjust-usd","amount":0}]}'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T6c จำนวน 0 ต้องถูกปฏิเสธ'; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6d","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"inv-cash-adjust-usd","amount":-50},{"accountId":"inv-cash-adjust-usd","amount":-50}]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6d 3 บรรทัดต้องถูกปฏิเสธ (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6e","date":"2026-11-03","source":"system","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"inv-cash-adjust-usd","amount":-100}]}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6e ชนิด system ต้องถูกปฏิเสธ (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"x6f","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"my-suspense","amount":-100}]}'::jsonb, '[{"id":"my-suspense"}]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6f สร้างบัญชีชื่ออื่นต้องถูกปฏิเสธ (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.record_cash_adjustment('[]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6g รูปแบบผิดต้องถูกปฏิเสธ (ได้ %)', r; end if;

  -- T7 ไม่มีรายการเหลือจากรายการที่ถูกปฏิเสธ (ย้อนกลับทั้งก้อน) · มีเฉพาะ ca1 ca2 ca3 ca4b ca4c
  if pg_temp.ac(ua, $q$ select count(*) from public.entries where id like 'ca%' or id like 'x%' $q$) <> 5 then raise exception 'FAIL: T7 จำนวนรายการไม่ตรง (รายการที่ถูกปฏิเสธต้องไม่ค้าง)'; end if;
  if pg_temp.ac(ua, $q$ select count(*) from public.accounts where id like 'inv-cash-adjust-%' $q$) <> 2 then raise exception 'FAIL: T7 บัญชีพักต้องมี 2 บัญชี (my-suspense ต้องไม่ถูกสร้าง)'; end if;

  -- T8 ยอดรวมบัญชีพัก + เงินสด = 0 ต่อสกุล (สมุดสมดุล) และบรรทัดเงินบาทถูกแยกสกุล
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id in ('cash-usd', 'inv-cash-adjust-usd') $q$) <> 0 then raise exception 'FAIL: T8 USD ไม่สมดุล'; end if;
  if pg_temp.ac(ua, $q$ select coalesce(sum(amount), 0)::bigint from public.lines where account_id in ('cash-thb', 'inv-cash-adjust-thb') $q$) <> 0 then raise exception 'FAIL: T8 บาทไม่สมดุล'; end if;

  -- T9 ผู้ใช้ B ใช้บัญชีของ A ไม่ได้ (RLS/ขอบเขตผู้ใช้) และ anon เรียกไม่ได้
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  perform public.setup_ledger('[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]'::jsonb, ent);
  perform pg_temp.settle();
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{"id":"b1","date":"2026-11-03","source":"manual","lines":[{"accountId":"cash-usd","amount":100},{"accountId":"inv-cash-adjust-usd","amount":-100}]}'::jsonb, '[{"id":"inv-cash-adjust-usd"}]'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T9 ผู้ใช้ B ต้องใช้บัญชีของ A ไม่ได้'; end if;
  if (select count(*) from public.lines) <> 2 then raise exception 'FAIL: T9 B เห็นหรือสร้างบรรทัดเกินของตัวเอง'; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  r := pg_temp.fails($q$ select public.record_cash_adjustment('{}'::jsonb) $q$);
  execute 'reset role';
  if r is null or r not like '42501|%' then raise exception 'FAIL: T9 anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'record_cash_adjustment' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')) <> 1 then
    raise exception 'FAIL: T9 สิทธิ์ execute ต้องเป็น authenticated เท่านั้น';
  end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
