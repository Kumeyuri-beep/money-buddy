-- ทดสอบ migration 20261127000100_import_replace_categories: ลบหมวดเดิม + นำเข้าข้อมูลลงทุนในธุรกรรมเดียว · abort ไม่ลบหมวด
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration** · จบด้วย raise TESTS_PASSED (ย้อนกลับทั้งหมด ไม่มีข้อมูลทดสอบเหลือ)

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
-- ภาพของหมวดครบทุกคอลัมน์ (อ่านด้วยสิทธิ์ผู้ดูแล) ใช้เทียบ "กลับมาครบ"
create function pg_temp.snap(p_user uuid) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.logout();
  select coalesce(string_agg(to_jsonb(c)::text, ';' order by c.id), '') into v from public.asset_categories c where c.user_id = p_user;
  perform pg_temp.login(p_user);
  return v;
end $$;
create function pg_temp.ac(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.logout();
  execute p_sql into n;
  perform pg_temp.login(p_user);
  return n;
end $$;
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout(), pg_temp.login(uuid), pg_temp.snap(uuid), pg_temp.ac(uuid, text) to public;

do $t$
declare
  ua uuid := gen_random_uuid(); -- มีหมวดเดิมค้างโดยไม่มีบัญชี
  ub uuid := gen_random_uuid(); -- ผู้ใช้อื่น (ต้องไม่ถูกแตะ)
  uc uuid := gen_random_uuid(); -- ยังไม่เปลี่ยนรหัสผ่าน
  ud uuid := gen_random_uuid(); -- มีสินทรัพย์ผูกหมวดอยู่แล้ว
  r text;
  before_a text;
  before_b text;
  before_d text;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
  old2 jsonb := '[{"id":"c1","name":"Old Tech","targetBps":6000,"sortOrder":1},{"id":"c2","name":"Old Funds","targetBps":4000,"sortOrder":2}]';
  asset_d text := '{"id":"sd","name":"หุ้น D","kind":"stock","accountId":"inv-d","currency":"USD"';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  select u, e || '@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (ua, 'a-rep'), (ub, 'b-rep'), (uc, 'c-rep'), (ud, 'd-rep')) v(u, e);
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id in (ua, ub, ud);
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub, ud);

  perform pg_temp.login(ub);
  perform public.save_categories(old2);
  perform pg_temp.settle();
  before_b := pg_temp.snap(ub);

  -- A: หมวดค้างโดยยังไม่มีบัญชี แล้วนำเข้าสมุดทางเดิม
  perform pg_temp.login(ua);
  perform public.save_categories(old2);
  perform pg_temp.settle();
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-d', 'asset', 'หุ้น D', 'USD', 'investment');
  before_a := pg_temp.snap(ua);

  -- T1 จำนวนไม่ตรง / ว่าง = PT409 ไม่ลบ
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, 1) $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T1a จำนวนไม่ตรงต้อง PT409 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, null) $q$);
  if r is null or r not like 'PT409|%' then raise exception 'FAIL: T1b จำนวนว่างต้อง PT409 (ได้ %)', r; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T1 หมวดเดิมต้องไม่เปลี่ยน'; end if;

  -- T2 ล้มตอนตรวจเป้ารวม (ด่าน deferred) = หมวดเดิมครบ ไม่มีสินทรัพย์เข้า
  r := pg_temp.fails(format($q$ select private.import_ledger_investments_replacing_categories(%L::jsonb, 2) $q$,
        '{"categories":[{"id":"x1","name":"X","targetBps":5000}],"assets":[' || asset_d || ',"categoryId":"x1"}]}'));
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2 เป้ารวมผิดต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T2 ล้มแล้วหมวดเดิมต้องกลับครบ'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.assets where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T2 ต้องไม่มีสินทรัพย์เข้า'; end if;

  -- T3 สินทรัพย์ชี้หมวดที่ไม่มี (รวมหมวดเดิมที่ถูกลบในธุรกรรมนี้) = FK ล้ม หมวดเดิมครบ
  r := pg_temp.fails(format($q$ select private.import_ledger_investments_replacing_categories(%L::jsonb, 2) $q$, '{"categories":[],"assets":[' || asset_d || ',"categoryId":"c1"}]}'));
  if r is null or r not like '23503|%' then raise exception 'FAIL: T3 หมวดที่ไม่มีต้อง 23503 (ได้ %)', r; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T3 ล้มแล้วหมวดเดิมต้องกลับครบ'; end if;

  -- T4 รายการลงทุนผิด (ชี้สินทรัพย์ที่ไม่มี) ล้มหลังหมวดและสินทรัพย์เข้าแล้ว = ย้อนกลับทั้งหมด
  r := pg_temp.fails(format($q$ select private.import_ledger_investments_replacing_categories(%L::jsonb, 2) $q$,
        '{"categories":[{"id":"x1","name":"X","targetBps":10000}],"assets":[' || asset_d || ',"categoryId":"x1"}],"prices":[{"assetId":"nope","date":"2026-11-01","priceMicro":1000000}]}'));
  if r is null then raise exception 'FAIL: T4 ราคาชี้สินทรัพย์ที่ไม่มีต้องล้ม'; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T4 ล้มแล้วหมวดเดิมต้องกลับครบ'; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.assets where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T4 ต้องไม่มีสินทรัพย์เข้า'; end if;

  -- T5 รูปแบบผิด = 22023 หมวดเดิมครบ
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{"categories":"x"}'::jsonb, 2) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5 รูปแบบผิดต้อง 22023 (ได้ %)', r; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T5 หมวดเดิมต้องครบ'; end if;

  -- T6 มีเซสชันนำเข้าค้าง = 55000 ไม่ลบ
  perform pg_temp.logout();
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);
  perform pg_temp.login(ua);
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, 2) $q$);
  if r is null or r not like '55000|%' then raise exception 'FAIL: T6a เซสชันค้างต้อง 55000 (ได้ %)', r; end if;
  -- T7 ยกเลิกนำเข้า: สมุดค้างถูกล้าง แต่หมวดเดิมยังอยู่ครบ
  while private.import_ledger_abort() = 'more' loop null; end loop;
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.accounts where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T7 abort ต้องล้างบัญชี'; end if;
  if pg_temp.snap(ua) <> before_a then raise exception 'FAIL: T7 abort ต้องไม่ลบหมวดเดิม'; end if;

  -- T8 สำเร็จ: ใช้รหัสและชื่อซ้ำกับหมวดเดิมได้ หมวดเดิมถูกแทนด้วยของไฟล์ สินทรัพย์ผูกถูก
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-d', 'asset', 'หุ้น D', 'USD', 'investment');
  r := private.import_ledger_investments_replacing_categories(
        ('{"categories":[{"id":"c1","name":"Old Tech","targetBps":10000}],"assets":[' || asset_d || ',"categoryId":"c1"}]}')::jsonb, 2)->>'categories';
  perform pg_temp.settle();
  if r <> '1' then raise exception 'FAIL: T8a ต้องนำเข้า 1 หมวด (ได้ %)', r; end if;
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 1 then raise exception 'FAIL: T8b หมวดเดิมต้องถูกแทน'; end if;
  if (select category_id from public.assets where id = 'sd') is distinct from 'c1' then raise exception 'FAIL: T8c สินทรัพย์ต้องผูกหมวดจากไฟล์'; end if;

  -- T9 มีสินทรัพย์อยู่แล้ว = 23505 และหมวดกับการผูกหมวดของสินทรัพย์กลับครบ (ระหว่างลบ category_id ถูกตั้ง null ชั่วคราว)
  perform pg_temp.login(ud);
  perform private.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-d', 'asset', 'หุ้น D', 'USD', 'investment');
  perform public.save_categories(old2);
  insert into public.assets (id, name, kind, account_id, instrument_currency, category_id) values ('sd', 'หุ้น D', 'stock', 'inv-d', 'USD', 'c1');
  perform pg_temp.settle();
  before_d := pg_temp.snap(ud);
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, 2) $q$);
  if r is null or r not like '23505|%' then raise exception 'FAIL: T9a มีสินทรัพย์อยู่แล้วต้อง 23505 (ได้ %)', r; end if;
  if pg_temp.snap(ud) <> before_d then raise exception 'FAIL: T9b หมวดต้องกลับครบ'; end if;
  if (select category_id from public.assets where id = 'sd') is distinct from 'c1' then raise exception 'FAIL: T9c การผูกหมวดต้องกลับ'; end if;

  -- T10 ไฟล์ที่ไม่มีข้อมูลลงทุน: หมวดเดิมถูกลบ ไม่มีหมวดใหม่ · ผู้ใช้อื่นไม่ถูกแตะ
  perform pg_temp.login(ua);
  perform pg_temp.logout();
  delete from public.assets where user_id = ua;
  perform pg_temp.login(ua);
  perform private.import_ledger_investments_replacing_categories('{}'::jsonb, 1);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T10a หมวดเดิมต้องหมด'; end if;
  if pg_temp.snap(ub) <> before_b then raise exception 'FAIL: T10b หมวดของผู้ใช้อื่นต้องไม่ถูกแตะ'; end if;

  -- T11 ด่านสิทธิ์: ยังไม่เปลี่ยนรหัส = 42501 · ไม่ได้ล็อกอิน (anon) เรียกไม่ได้
  perform pg_temp.login(uc);
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, 0) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T11a ยังไม่เปลี่ยนรหัสต้อง 42501 (ได้ %)', r; end if;
  perform pg_temp.logout();
  execute 'set local role anon';
  r := pg_temp.fails($q$ select private.import_ledger_investments_replacing_categories('{}'::jsonb, 0) $q$);
  perform pg_temp.logout();
  if r is null or r not like '42501|%' then raise exception 'FAIL: T11b anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
