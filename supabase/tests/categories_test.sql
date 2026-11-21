-- ทดสอบ migration 20261121000100_categories (Invest v2 รอบที่ 2 · Categories): asset_categories + save_categories + ล้างข้อมูล + นำเข้า
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
  uc uuid := gen_random_uuid(); -- ยังไม่เปลี่ยนรหัสผ่าน (ด่าน can_use_data)
  ud uuid := gen_random_uuid(); -- ทดสอบนำเข้า
  r text;
  n bigint;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
  cats3 jsonb := '[{"id":"c1","name":"Tech","targetBps":5000,"sortOrder":1},{"id":"c2","name":"Health","targetBps":3000,"sortOrder":2},{"id":"c3","name":"Funds","targetBps":2000,"sortOrder":3}]';
  big jsonb;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-cat@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-cat@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-cat@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ud, 'd-cat@users.money-buddy.internal', extensions.crypt('old-password-4', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  update auth.users set encrypted_password = extensions.crypt('new-password-4', extensions.gen_salt('bf')) where id = ud;
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub, ud);

  -- เตรียมสินทรัพย์ของ A (3 ตัว) และ B (1 ตัว)
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values
    ('inv-a', 'asset', 'หุ้น A', 'USD', 'investment'), ('inv-b', 'asset', 'หุ้น B', 'USD', 'investment'), ('inv-c', 'asset', 'หุ้น C', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency) values
    ('sa', 'หุ้น A', 'stock', 'inv-a', 'USD'), ('sb', 'หุ้น B', 'stock', 'inv-b', 'USD'), ('sc', 'หุ้น C', 'stock', 'inv-c', 'USD');
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-bx', 'asset', 'หุ้น BX', 'USD', 'investment');
  insert into public.assets (id, name, kind, account_id, instrument_currency) values ('sbx', 'หุ้น BX', 'stock', 'inv-bx', 'USD');

  -- T1 บันทึกหมวด 3 หมวดเป้า 5,000/3,000/2,000 + จัดหมวดและ sector พร้อมกัน
  perform pg_temp.login(ua);
  perform public.save_categories(cats3, '[{"assetId":"sa","categoryId":"c1","sector":"Information Technology"},{"assetId":"sb","categoryId":"c2"},{"assetId":"sc","categoryId":"c3"}]'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 3 then raise exception 'FAIL: T1 ต้องมี 3 หมวด'; end if;
  if pg_temp.ac(ua, $q$ select sum(target_bps) from public.asset_categories $q$) <> 10000 then raise exception 'FAIL: T1 เป้ารวมต้อง 10,000'; end if;
  if pg_temp.ac(ua, $q$ select count(*) from public.assets where category_id is not null $q$) <> 3 then raise exception 'FAIL: T1 สินทรัพย์ต้องมีหมวดครบ 3'; end if;
  if (select sector from public.assets where id = 'sa') is distinct from 'Information Technology' then raise exception 'FAIL: T1 sector ไม่ถูกบันทึก'; end if;

  -- T2 เป้ารวมไม่ครบ 100% ล้มตอน commit (23514) · เป้าบางหมวดเป็น null ล้ม · ไม่ตั้งเลยผ่าน
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":5000},{"id":"c2","name":"Health","targetBps":3000},{"id":"c3","name":"Funds","targetBps":1999}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2a เป้ารวม 99.99%% ต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":5000},{"id":"c2","name":"Health"},{"id":"c3","name":"Funds","targetBps":5000}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T2b เป้าบางหมวดว่างต้องล้ม (ได้ %)', r; end if;
  if pg_temp.ac(ua, $q$ select sum(target_bps) from public.asset_categories $q$) <> 10000 then raise exception 'FAIL: T2 ล้มแล้วต้องย้อนกลับ (เป้ารวมเดิมยังอยู่)'; end if;
  perform public.save_categories('[{"id":"c1","name":"Tech"},{"id":"c2","name":"Health"},{"id":"c3","name":"Funds"}]'::jsonb);
  perform pg_temp.settle();
  if pg_temp.ac(ua, $q$ select count(target_bps) from public.asset_categories $q$) <> 0 then raise exception 'FAIL: T2c ไม่ตั้งเป้าเลยต้องผ่าน'; end if;
  perform public.save_categories(cats3);
  perform pg_temp.settle();

  -- T3 ชื่อซ้ำ (ไม่สนตัวพิมพ์) ล้ม 23505 · สลับชื่อสองหมวดในการบันทึกครั้งเดียวผ่าน · assignments ที่ไม่ส่ง sector ไม่ล้าง sector เดิม
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":5000},{"id":"c2","name":"tech","targetBps":3000},{"id":"c3","name":"Funds","targetBps":2000}]'::jsonb) $q$);
  if r is null or r not like '23505|%' then raise exception 'FAIL: T3a ชื่อซ้ำต้องล้ม 23505 (ได้ %)', r; end if;
  perform public.save_categories('[{"id":"c1","name":"Health","targetBps":5000},{"id":"c2","name":"Tech","targetBps":3000},{"id":"c3","name":"Funds","targetBps":2000}]'::jsonb,
                                 '[{"assetId":"sb","categoryId":"c2"}]'::jsonb);
  perform pg_temp.settle();
  if (select name from public.asset_categories where id = 'c1') <> 'Health' or (select name from public.asset_categories where id = 'c2') <> 'Tech' then raise exception 'FAIL: T3b สลับชื่อไม่สำเร็จ'; end if;
  if (select sector from public.assets where id = 'sa') is distinct from 'Information Technology' then raise exception 'FAIL: T3c ไม่ส่ง key sector แล้ว sector เดิมหาย'; end if;
  perform public.save_categories(cats3);
  perform pg_temp.settle();

  -- T4 ชื่อ/sector ไม่ผ่านรูปแบบ: ช่องว่างหน้า-หลัง · ยาวเกิน 60 · อักขระมองไม่เห็น/ตัวกลับทิศ · ว่าง
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":" Tech"}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4a ช่องว่างนำหน้าต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails(format($q$ select public.save_categories(%L::jsonb) $q$, jsonb_build_array(jsonb_build_object('id', 'c1', 'name', repeat('x', 61)))::text));
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4b ยาวเกิน 60 ต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Te​ch"}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4c อักขระศูนย์ความกว้างต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Te‮ch"}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4d ตัวกลับทิศต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":""}]'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4e ชื่อว่างต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ update public.assets set sector = '  x' where id = 'sa' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4f sector มีช่องว่างนำหน้าต้องล้ม (ได้ %)', r; end if;
  r := pg_temp.fails($q$ update public.assets set sector = 'a' || chr(8238) || 'b' where id = 'sa' $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T4g sector มีตัวกลับทิศต้องล้ม (ได้ %)', r; end if;

  -- T5 รูปแบบ/ขนาดข้อมูลเข้า: ไม่ใช่ array · แถวไม่ใช่ object · เกิน 50 หมวด · ตัวเลขผิดรูป · ได้ 22023 ทั้งหมด
  r := pg_temp.fails($q$ select public.save_categories('{}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5a ไม่ใช่ array ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[1,2]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5b แถวไม่ใช่ object ต้อง 22023 (ได้ %)', r; end if;
  select jsonb_agg(jsonb_build_object('id', 'k' || g, 'name', 'N' || g)) into big from generate_series(1, 51) g;
  r := pg_temp.fails(format($q$ select public.save_categories(%L::jsonb) $q$, big::text));
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5c เกิน 50 หมวดต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":"abc"}]'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5d targetBps ไม่ใช่ตัวเลขต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":99999}]'::jsonb) $q$);
  if r is null then raise exception 'FAIL: T5e targetBps เกิน 10,000 ต้องล้ม'; end if;
  -- ขนาดเกิน 64 KB (แถวเดียวแนบขยะ)
  r := pg_temp.fails(format($q$ select public.save_categories(%L::jsonb) $q$, jsonb_build_array(jsonb_build_object('id', 'z', 'name', 'Z', 'junk', repeat('x', 70000)))::text));
  if r is null or r not like '22023|%' then raise exception 'FAIL: T5g ขนาดเกิน 64 KB ต้อง 22023 (ได้ %)', r; end if;
  -- เพดาน 50 หมวดที่ฐานข้อมูล (แทรกตรงทีเดียว 51 แถว)
  r := pg_temp.fails($q$ insert into public.asset_categories (id, name) select 'd' || g, 'D' || g from generate_series(1, 51) g $q$);
  if r is null or r not like '54000|%' then raise exception 'FAIL: T5h แทรก 51 หมวดต้อง 54000 (ได้ %)', r; end if;

  -- T6 RLS ข้ามผู้ใช้: B เห็น/แก้/ลบหมวดของ A ไม่ได้ · B ชี้สินทรัพย์ตัวเองไปหมวดของ A ไม่ได้ (FK แบบ composite) · ใส่ user_id ปลอมไม่ได้
  perform pg_temp.login(ub);
  if (select count(*) from public.asset_categories) <> 0 then raise exception 'FAIL: T6a B เห็นหมวดของ A'; end if;
  update public.asset_categories set name = 'hack' where id = 'c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: T6b B แก้หมวดของ A ได้'; end if;
  delete from public.asset_categories where id = 'c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: T6c B ลบหมวดของ A ได้'; end if;
  r := pg_temp.fails($q$ update public.assets set category_id = 'c1' where id = 'sbx' $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T6d B ชี้สินทรัพย์ไปหมวดของ A ต้อง 23503 (ได้ %)', r; end if;
  r := pg_temp.fails(format($q$ insert into public.asset_categories (user_id, id, name) values (%L, 'forged', 'Forged') $q$, ua));
  if r is null then raise exception 'FAIL: T6e B ใส่ user_id ของ A ได้'; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"b1","name":"B only"}]'::jsonb, '[{"assetId":"sa","categoryId":"b1"}]'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T6f B จัดหมวดสินทรัพย์ของ A ต้อง 23503 (ได้ %)', r; end if;
  perform pg_temp.login(ua);
  if (select count(*) from public.asset_categories) <> 3 then raise exception 'FAIL: T6g หมวดของ A ต้องไม่เปลี่ยน (ได้ %)', (select count(*) from public.asset_categories); end if;

  -- T7 ลบหมวด: สินทรัพย์ในหมวดนั้นกลับเป็น null · ที่เหลือคงเดิม
  perform public.save_categories('[{"id":"c1","name":"Tech","targetBps":6000},{"id":"c2","name":"Health","targetBps":4000}]'::jsonb);
  perform pg_temp.settle();
  if (select category_id from public.assets where id = 'sc') is not null then raise exception 'FAIL: T7 สินทรัพย์ในหมวดที่ถูกลบต้องเป็น null'; end if;
  if (select category_id from public.assets where id = 'sa') is distinct from 'c1' then raise exception 'FAIL: T7 สินทรัพย์หมวดที่เหลือต้องคงเดิม'; end if;
  perform public.save_categories(cats3, '[{"assetId":"sc","categoryId":"c3"}]'::jsonb);
  perform pg_temp.settle();

  -- T8 ด่านเปลี่ยนรหัส (can_use_data) · assignments ไม่พบสินทรัพย์ 23503 · anon เรียกไม่ได้ · สิทธิ์ execute
  perform pg_temp.login(uc);
  r := pg_temp.fails($q$ select public.save_categories('[]'::jsonb) $q$);
  if r is null or r not like '42501|%' then raise exception 'FAIL: T8a ผู้ใช้ที่ยังไม่เปลี่ยนรหัสต้อง 42501 (ได้ %)', r; end if;
  perform pg_temp.login(ua);
  r := pg_temp.fails($q$ select public.save_categories(null) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T8b null ต้อง 22023 (ได้ %)', r; end if;
  r := pg_temp.fails($q$ select public.save_categories('[{"id":"c1","name":"Tech","targetBps":6000},{"id":"c2","name":"Health","targetBps":4000}]'::jsonb, '[{"assetId":"nope","categoryId":"c1"}]'::jsonb) $q$);
  if r is null or r not like '23503|%' then raise exception 'FAIL: T8c สินทรัพย์ไม่มีอยู่ต้อง 23503 (ได้ %)', r; end if;
  perform pg_temp.logout();
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  r := pg_temp.fails($q$ select public.save_categories('[]'::jsonb) $q$);
  execute 'reset role';
  if r is null or r not like '42501|%' then raise exception 'FAIL: T8d anon ต้องเรียกไม่ได้ (ได้ %)', r; end if;
  if (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and p.proname = 'save_categories' and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')) <> 1 then
    raise exception 'FAIL: T8e สิทธิ์ execute ต้องเป็น authenticated เท่านั้น';
  end if;
  if has_table_privilege('anon', 'public.asset_categories', 'select') then raise exception 'FAIL: T8f anon ต้องไม่มีสิทธิ์อ่านตารางหมวด'; end if;

  -- T9 เซสชันนำเข้าเปิดอยู่: save_categories ล้ม 55000 (ไม่พึ่งการกรองเงียบของ RLS)
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);
  perform pg_temp.login(ua);
  r := pg_temp.fails($q$ select public.save_categories('[]'::jsonb) $q$);
  if r is null or r not like '55000|%' then raise exception 'FAIL: T9 ระหว่างนำเข้าต้อง 55000 (ได้ %)', r; end if;
  perform pg_temp.logout();
  delete from private.import_sessions where user_id = ua;

  -- T10 ล้างข้อมูล (reset_my_ledger) ล้างหมวดด้วย · ไม่แตะของผู้ใช้อื่น
  perform pg_temp.login(ub);
  perform public.save_categories('[{"id":"bx","name":"B cat","targetBps":10000}]'::jsonb, '[{"assetId":"sbx","categoryId":"bx"}]'::jsonb);
  perform pg_temp.settle();
  perform pg_temp.login(ua);
  if public.reset_my_ledger('new-password-1') is distinct from true then raise exception 'FAIL: T10 reset_my_ledger ต้องสำเร็จ'; end if;
  perform pg_temp.settle();
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T10 ล้างข้อมูลแล้วหมวดของ A ต้องหมด'; end if;
  if pg_temp.ac(ub, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ub)) <> 1 then raise exception 'FAIL: T10 หมวดของ B ต้องไม่ถูกแตะ'; end if;

  -- T11 ล้างข้อมูลแบบเป็นชุด + ยกเลิกนำเข้า ล้างหมวดด้วย
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  perform public.save_categories('[{"id":"r1","name":"R1","targetBps":10000}]'::jsonb);
  perform pg_temp.settle();
  if public.reset_my_ledger_step('new-password-1') not in ('done', 'more') then raise exception 'FAIL: T11a reset_my_ledger_step'; end if;
  while public.reset_my_ledger_step('new-password-1') = 'more' loop null; end loop;
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T11a reset_my_ledger_step ต้องล้างหมวด'; end if;
  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  perform public.save_categories('[{"id":"r2","name":"R2","targetBps":10000}]'::jsonb);
  perform pg_temp.settle();
  perform pg_temp.logout();
  insert into private.import_sessions (user_id, expected_entries, received_entries) values (ua, 5000, 1200);
  perform pg_temp.login(ua);
  while public.import_ledger_abort() = 'more' loop null; end loop;
  if pg_temp.ac(ua, format($q$ select count(*) from public.asset_categories where user_id = %L $q$, ua)) <> 0 then raise exception 'FAIL: T11b import_ledger_abort ต้องล้างหมวด'; end if;

  -- T12 นำเข้าข้อมูลลงทุนพร้อมหมวด (ผู้ใช้ D สมุดใหม่) · เป้ารวมผิดล้มตอน commit · ไฟล์รุ่นเก่าไม่มีหมวดนำเข้าได้
  perform pg_temp.login(ud);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  insert into public.accounts (id, type, name, currency, kind) values ('inv-d', 'asset', 'หุ้น D', 'USD', 'investment');
  r := pg_temp.fails($q$ select public.import_ledger_investments('{"categories":[{"id":"x1","name":"X","targetBps":5000}],"assets":[{"id":"sd","name":"หุ้น D","kind":"stock","accountId":"inv-d","currency":"USD","categoryId":"x1","sector":"Utilities"}]}'::jsonb) $q$);
  if r is null or r not like '23514|%' then raise exception 'FAIL: T12a เป้ารวมผิดตอนนำเข้าต้อง 23514 (ได้ %)', r; end if;
  if pg_temp.ac(ud, $q$ select count(*) from public.assets $q$) <> 0 then raise exception 'FAIL: T12a ล้มแล้วต้องย้อนกลับ (ไม่มีสินทรัพย์เหลือ)'; end if;
  if (public.import_ledger_investments('{"categories":[{"id":"x1","name":"X","targetBps":10000}],"assets":[{"id":"sd","name":"หุ้น D","kind":"stock","accountId":"inv-d","currency":"USD","categoryId":"x1","sector":"Utilities"}]}'::jsonb)->>'categories')::integer <> 1 then raise exception 'FAIL: T12b นำเข้าหมวดต้องได้ 1'; end if;
  perform pg_temp.settle();
  if (select category_id || '/' || sector from public.assets where id = 'sd') is distinct from 'x1/Utilities' then raise exception 'FAIL: T12b สินทรัพย์ต้องมีหมวดและ sector'; end if;
  r := pg_temp.fails($q$ select public.import_ledger_investments('{"categories":[],"assets":[]}'::jsonb) $q$);
  if r is null or r not like '23505|%' then raise exception 'FAIL: T12c นำเข้าซ้ำทับข้อมูลเดิมต้อง 23505 (ได้ %)', r; end if;
  perform pg_temp.login(ub);
  r := pg_temp.fails($q$ select public.import_ledger_investments('{"categories":"x"}'::jsonb) $q$);
  if r is null or r not like '22023|%' then raise exception 'FAIL: T12d categories ไม่ใช่ array ต้อง 22023 (ได้ %)', r; end if;

  -- T13 ลบผู้ใช้ทั้งบัญชี (cascade ผ่าน auth.users) ด้วยสิทธิ์ผู้ดูแล ไม่ล้มเพราะด่านเป้ารวม · หมวดของผู้ใช้นั้นหายไปหมด
  -- (ฐานข้อมูลจริงลบผู้ใช้ด้วย role supabase_auth_admin ซึ่งอยู่ใน whitelist ของ trigger เหมือน role ผู้ดูแลที่รันไฟล์นี้ · ตัวรันเทสต์สลับเป็น supabase_auth_admin ไม่ได้ จึงลบด้วยสิทธิ์ผู้ดูแล)
  perform pg_temp.logout();
  delete from auth.users where id = ub;
  perform pg_temp.settle();
  if (select count(*) from public.asset_categories where user_id = ub) <> 0 then raise exception 'FAIL: T13 ลบผู้ใช้แล้วหมวดต้องหมด'; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
