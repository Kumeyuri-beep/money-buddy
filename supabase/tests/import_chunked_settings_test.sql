-- ทดสอบ migration 20261128000200_import_begin_settings: นำเข้าแบบแบ่งก้อนที่ไฟล์มีค่าตั้งค่าต้องสำเร็จ และด่านกันเขียนขณะเซสชันเปิดยังอยู่
-- วิธีรัน: **หลังใส่ migration** · จบด้วย raise TESTS_PASSED (ย้อนกลับทั้งหมด ไม่มีข้อมูลทดสอบเหลือ)
-- ก่อนแก้ ข้อ T1 ล้มด้วย 42501 (settings_import_lock_ins)

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
grant execute on function pg_temp.settle(), pg_temp.fails(text), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid(); -- แบ่งก้อนจริง (ก้อนแรกไม่ครบ)
  ub uuid := gen_random_uuid(); -- ก้อนแรกครบทั้งไฟล์ และกรณียกเลิก
  r text;
  v jsonb;
  acc jsonb := '[{"id":"w1","type":"asset","name":"w1","currency":"THB"},{"id":"open","type":"equity","name":"open","currency":"THB"}]';
  e1 jsonb := '[{"id":"e1","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":500000},{"accountId":"open","amount":-500000}]}]';
  e2 jsonb := '[{"id":"e2","date":"2026-11-02","memo":"x","source":"manual","createdAt":"2026-11-02T03:00:00.000Z","lines":[{"accountId":"w1","amount":100},{"accountId":"open","amount":-100}]}]';
  data jsonb;
begin
  data := jsonb_build_object('accounts', acc, 'bills', '[]'::jsonb, 'entries', e1, 'settings', '{"payDay":25}'::jsonb);
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  select u, e || '@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
    from (values (ua, 'a-set'), (ub, 'b-set')) x(u, e);
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id in (ua, ub);
  update public.profiles set password_changed_at = now() - interval '2 days' where user_id in (ua, ub);

  -- T1 ก้อนแรกจาก 2 รายการพร้อมค่าตั้งค่า = สำเร็จ เซสชันเปิด ค่าตั้งค่าถูกบันทึก
  perform pg_temp.login(ua);
  v := private.import_ledger_begin(data, 2);
  perform pg_temp.settle();
  if (v->>'done')::boolean or not public.import_ledger_status() then raise exception 'FAIL: T1a เซสชันต้องยังเปิด %', v; end if;
  if (select value->>'payDay' from public.settings) is distinct from '25' then raise exception 'FAIL: T1b ค่าตั้งค่าต้องถูกบันทึก'; end if;

  -- T2 ด่านยังอยู่: ขณะเซสชันเปิด เขียนค่าตั้งค่าทางอื่นไม่ได้ (ตัวแปรนำเข้าถูกปิดแล้ว)
  if coalesce(current_setting('app.import_ledger', true), '') = 'on' or coalesce(current_setting('app.setup_ledger', true), '') = 'on' then raise exception 'FAIL: T2a ตัวแปรนำเข้าต้องถูกปิด'; end if;
  update public.settings set value = '{"payDay":1}'::jsonb;
  if (select value->>'payDay' from public.settings) is distinct from '25' then raise exception 'FAIL: T2b แก้ค่าตั้งค่าขณะเซสชันเปิดได้'; end if;
  delete from public.settings;
  if (select count(*) from public.settings) <> 1 then raise exception 'FAIL: T2c ลบค่าตั้งค่าขณะเซสชันเปิดได้'; end if;

  -- T3 ก้อนสุดท้ายครบ: ปิดเซสชัน ค่าตั้งค่ายังอยู่
  perform private.import_ledger_append(e2);
  perform pg_temp.settle();
  if public.import_ledger_status() then raise exception 'FAIL: T3a เซสชันต้องปิด'; end if;
  if (select count(*) from public.entries) <> 2 or (select value->>'payDay' from public.settings) is distinct from '25' then raise exception 'FAIL: T3b รายการหรือค่าตั้งค่าไม่ครบ'; end if;

  -- T4 ก้อนแรกครบทั้งไฟล์พร้อมค่าตั้งค่า
  perform pg_temp.logout();
  perform pg_temp.login(ub);
  v := private.import_ledger_begin(data, 1);
  perform pg_temp.settle();
  if not (v->>'done')::boolean or public.import_ledger_status() then raise exception 'FAIL: T4a ต้องเสร็จในก้อนเดียว %', v; end if;
  if (select value->>'payDay' from public.settings) is distinct from '25' then raise exception 'FAIL: T4b ค่าตั้งค่าต้องถูกบันทึก'; end if;
  r := private.reset_my_ledger_step('new-password-1');
  perform pg_temp.settle();
  if r <> 'done' then raise exception 'FAIL: T4c ล้างไม่สำเร็จ (%)', r; end if;

  -- T5 ยกเลิกกลางทาง: ค่าตั้งค่าที่นำเข้าค้างถูกล้างด้วย
  perform private.import_ledger_begin(data, 3);
  perform pg_temp.settle();
  if private.import_ledger_abort() <> 'done' then raise exception 'FAIL: T5a ล้างส่วนค้างไม่สำเร็จ'; end if;
  perform pg_temp.settle();
  if (select count(*) from public.settings) <> 0 or (select count(*) from public.accounts) <> 0 then raise exception 'FAIL: T5b ต้องไม่เหลือข้อมูลค้าง'; end if;

  -- T6 ค่าตั้งค่าผิดรูป = ย้อนกลับทั้งก้อน ไม่มีเซสชันค้าง
  r := pg_temp.fails(format('select private.import_ledger_begin(%L::jsonb, 2)', data || '{"settings":[1]}'::jsonb));
  if r is null or r not like '22023|%' then raise exception 'FAIL: T6a ต้อง 22023 (ได้ %)', r; end if;
  if public.import_ledger_status() or (select count(*) from public.accounts) <> 0 then raise exception 'FAIL: T6b ต้องไม่เหลือเซสชันหรือข้อมูล'; end if;

  perform pg_temp.logout();
  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
