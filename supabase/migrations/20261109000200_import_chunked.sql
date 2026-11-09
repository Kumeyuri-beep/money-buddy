-- นำเข้าแบบแบ่งก้อน (backlog หลัง M2): ไฟล์สำรองเกิน 1,500 รายการนำเข้าได้ โดยไม่เกินเพดานเวลาของคำสั่งเดียว (~8 วินาที, วัดจริง 2,000 รายการ = 5.2 วินาที)
-- import_ledger เดิม (ธุรกรรมเดียว ≤ 1,500 รายการ) ไม่เปลี่ยน · ไฟล์เล็กยังใช้ทางเดิม
--
-- หลายก้อน = หลายธุรกรรม จึงไม่อะตอมมิกทั้งไฟล์ ใช้ "เซสชันนำเข้า" (private.import_sessions) ครอบแทน:
--   1) import_ledger_begin(ข้อมูลหลัก + รายการก้อนแรก, จำนวนรายการทั้งหมด): เหมือน import_ledger (ปฏิเสธถ้ามีข้อมูลอยู่แล้ว ไม่ทับ) แล้วเปิดเซสชัน
--   2) import_ledger_append(รายการก้อนถัดไป): ต้องมีเซสชันเปิดอยู่ และจำนวนสะสมต้องไม่เกินที่ประกาศ · ครบพอดี = ปิดเซสชัน
--   3) import_ledger_abort(): ล้างข้อมูลที่นำเข้าค้าง · ใช้ได้เฉพาะขณะเซสชันเปิดอยู่ (ไม่ถามรหัสผ่าน ไม่ติด cooldown 24 ชม.)
--      เหตุผล: ผู้ใช้ใหม่ที่เพิ่งเปลี่ยนรหัสติด cooldown ของ reset_my_ledger นาน 24 ชม. จะแก้ข้อมูลค้างเองไม่ได้ · เปิดเซสชันได้เฉพาะตอนสมุดว่าง
--      จึงไม่มีข้อมูลเดิมให้เสีย (ผู้ถือ session ที่ขโมยมาเปิดเซสชันบนสมุดที่มีข้อมูลไม่ได้ จึงลบสมุดจริงทางนี้ไม่ได้)
--   4) import_ledger_status(): เว็บถามตอนเปิดแอป ถ้ายังเปิดอยู่ = นำเข้าไม่เสร็จ แสดงหน้าให้ล้างแล้วลองใหม่ ไม่ปล่อยเข้าแอปด้วยข้อมูลครึ่งเดียว
--   5) ขณะเซสชันเปิด การเขียนข้อมูลทุกทางที่ไม่ใช่การนำเข้า (create_entry, REST, อุปกรณ์/แท็บอื่น) ถูกปฏิเสธด้วย RLS แบบ restrictive
--      เหตุผล (ผล security-auditor): ไม่งั้น abort จะลบข้อมูลจริงที่ผู้ใช้เพิ่มระหว่างเซสชันค้างได้ และผู้ถือ session ที่ขโมยมาเปิดเซสชันค้างไว้
--      เป็น "ระเบิดเวลา" ได้ · ผลคือระหว่างเซสชันเปิดไม่มีข้อมูลจริงให้ abort ลบ (มีแต่ข้อมูลที่นำเข้า) · อ่านข้อมูลยังได้ตามปกติ
-- ทุกรายการยังผ่าน private.insert_entry เดิม (R16 สมดุล, R15 รอบบิลไม่เกินเดือนปัจจุบัน, trigger ของบิล)
-- เพดานรวม 10,000 รายการ (ต้องตรงกับ MAX_IMPORT_ENTRIES ใน src/domain/backup/parseBackup.ts) · ต่อคำสั่งยังไม่เกิน 1,500 รายการ

create table private.import_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  expected_entries integer not null check (expected_entries between 1 and 10000),
  received_entries integer not null default 0 check (received_entries >= 0 and received_entries <= expected_entries),
  started_at timestamptz not null default now()
);
revoke all on private.import_sessions from public, anon, authenticated;

-- ตรวจรูปแบบ/เพดานของก้อนรายการ (ใช้ร่วม begin/append)
create function private.check_import_entries(p_entries jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_lines integer;
  v_max_lines integer;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_entries) > 20 * 1024 * 1024 or jsonb_array_length(p_entries) > 1500 then
    raise exception 'ก้อนข้อมูลนำเข้ามากเกินเพดาน (ไม่เกิน 1,500 รายการต่อก้อน)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_entries) e where jsonb_typeof(e->'lines') is distinct from 'array') then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง (lines)' using errcode = '22023';
  end if;
  select coalesce(sum(jsonb_array_length(e->'lines')), 0), coalesce(max(jsonb_array_length(e->'lines')), 0)
    into v_lines, v_max_lines from jsonb_array_elements(p_entries) e;
  if v_lines > 20000 or v_max_lines > 200 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (บรรทัดต่อรายการไม่เกิน 200 รวมไม่เกิน 20,000 ต่อก้อน)' using errcode = '22023';
  end if;
end
$$;

-- ตัวช่วยจัดการเซสชัน (security definer: ผู้ใช้เข้าตารางใน private ตรงๆ ไม่ได้) · ผู้เรียกต้องผ่านด่านใน public.* แล้วเท่านั้น
create function private.import_session_open(p_expected integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  -- ป้องกันอีกชั้น: เปิดเซสชันได้เฉพาะตอนสมุดว่างจริง (ถ้าใครเปิด schema private ให้ API เรียกตรงๆ ก็เปิดเซสชันบนสมุดที่มีข้อมูลไม่ได้ จึงใช้ abort ลบสมุดจริงไม่ได้)
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user)
     or exists (select 1 from public.bills where user_id = v_user)
     or exists (select 1 from public.settings where user_id = v_user) then
    raise exception 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;
  insert into private.import_sessions (user_id, expected_entries) values (v_user, p_expected);
end
$$;


-- เพิ่มจำนวนที่รับแล้ว · คืนจริงเมื่อครบและปิดเซสชันแล้ว
create function private.import_session_advance(p_count integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  p_user uuid := (select auth.uid());
  v_expected integer;
  v_received integer;
begin
  if p_count is null or p_count <= 0 then
    raise exception 'จำนวนรายการต้องมากกว่าศูนย์' using errcode = '22023';
  end if;
  select expected_entries, received_entries into v_expected, v_received from private.import_sessions where user_id = p_user for update;
  if not found then
    raise exception 'ไม่มีการนำเข้าที่เปิดค้างอยู่' using errcode = '55000';
  end if;
  if v_received + p_count > v_expected then
    raise exception 'รายการเกินจำนวนที่ประกาศไว้ตอนเริ่มนำเข้า' using errcode = '22023';
  end if;
  update private.import_sessions set received_entries = v_received + p_count where user_id = p_user;
  if v_received + p_count = v_expected then
    delete from private.import_sessions where user_id = p_user;
    return true;
  end if;
  return false;
end
$$;


create function private.import_session_exists() returns boolean
language sql security definer set search_path = ''
as $$ select exists (select 1 from private.import_sessions where user_id = (select auth.uid())) $$;

-- ฟังก์ชัน private ที่ฟังก์ชัน public ฝั่ง INVOKER เรียกต้องให้ authenticated เรียกได้ (ตัวช่วยเซสชันใช้ auth.uid() ของผู้เรียกเอง ไม่รับรหัสผู้ใช้จากข้างนอก)
revoke all on function private.check_import_entries(jsonb), private.import_session_open(integer), private.import_session_advance(integer), private.import_session_exists() from public, anon, authenticated;
grant execute on function private.check_import_entries(jsonb), private.import_session_open(integer), private.import_session_advance(integer), private.import_session_exists() to authenticated;

-- ก้อนแรก: เหมือน import_ledger ทุกข้อ (บัญชี บิล รายการก้อนแรก ตั้งค่า) + เปิดเซสชัน
create function public.import_ledger_begin(p_data jsonb, p_total_entries integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_accounts integer := 0;
  v_bills integer := 0;
  v_entries integer := 0;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'accounts') is distinct from 'array'
     or jsonb_typeof(p_data->'entries') is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'bills', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'settings', '{}'::jsonb)) is distinct from 'object' then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if p_total_entries is null or p_total_entries < 1 or p_total_entries > 10000
     or jsonb_array_length(p_data->'entries') > p_total_entries then
    raise exception 'จำนวนรายการทั้งหมดไม่ถูกต้อง (1-10,000)' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'accounts') < 1 then
    raise exception 'ต้องมีอย่างน้อย 1 บัญชี' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'accounts') > 2000 or jsonb_array_length(coalesce(p_data->'bills', '[]'::jsonb)) > 2000 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (บัญชี/บิลไม่เกิน 2,000)' using errcode = '22023';
  end if;
  perform private.check_import_entries(p_data->'entries');

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user)
     or exists (select 1 from public.bills where user_id = v_user)
     or exists (select 1 from public.settings where user_id = v_user)
     or private.import_session_exists() then
    raise exception 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  perform private.import_session_open(p_total_entries);

  perform set_config('app.setup_ledger', 'on', true);
  perform set_config('app.import_ledger', 'on', true);

  for v_item in select * from jsonb_array_elements(p_data->'accounts') loop
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order)
    values (
      v_user, v_item->>'id', v_item->>'type', v_item->>'name', v_item->>'currency',
      coalesce((v_item->>'archived')::boolean, false), (v_item->>'sortOrder')::integer
    );
    v_accounts := v_accounts + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_data->'bills', '[]'::jsonb)) loop
    insert into public.bills (user_id, id, name, amount, due_day, wallet_id, category_id, last_paid_month, start_month, archived)
    values (
      v_user, v_item->>'id', v_item->>'name', (v_item->>'amount')::bigint, (v_item->>'dueDay')::smallint,
      v_item->>'walletId', v_item->>'categoryId', v_item->>'lastPaidMonth', v_item->>'startMonth',
      coalesce((v_item->>'archived')::boolean, false)
    );
    v_bills := v_bills + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(p_data->'entries') loop
    perform private.insert_entry(v_item);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  if p_data->'settings' is not null and p_data->'settings' <> '{}'::jsonb then
    insert into public.settings (user_id, value) values (v_user, p_data->'settings');
  end if;

  -- ก้อนแรกครบทั้งไฟล์พอดี = ปิดเซสชันทันที
  return jsonb_build_object(
    'accounts', v_accounts, 'bills', v_bills, 'entries', v_entries,
    'done', case when v_entries > 0 then private.import_session_advance(v_entries) else false end
  );
end
$$;

-- ก้อนถัดไป: เฉพาะรายการ · ต้องมีเซสชันเปิดอยู่
create function public.import_ledger_append(p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_entries integer := 0;
  v_done boolean;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform private.check_import_entries(p_entries);
  if jsonb_array_length(p_entries) = 0 then
    raise exception 'ก้อนข้อมูลว่าง' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if not private.import_session_exists() then
    raise exception 'ไม่มีการนำเข้าที่เปิดค้างอยู่' using errcode = '55000';
  end if;

  perform set_config('app.setup_ledger', 'on', true);
  perform set_config('app.import_ledger', 'on', true);
  for v_item in select * from jsonb_array_elements(p_entries) loop
    perform private.insert_entry(v_item);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  v_done := private.import_session_advance(v_entries);
  return jsonb_build_object('entries', v_entries, 'done', v_done);
end
$$;

-- ล้างข้อมูลที่นำเข้าค้าง (security definer ล้างตารางของตัวเองเหมือน reset_my_ledger แต่ใช้ได้เฉพาะขณะเซสชันเปิด)
create function public.import_ledger_abort() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'ต้องเรียกแบบเขียนได้ (POST) เท่านั้น' using errcode = '25006';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if not exists (select 1 from private.import_sessions where user_id = v_user) then
    return false;
  end if;
  delete from public.entries where user_id = v_user;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return true;
end
$$;

create function public.import_ledger_status() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  return exists (select 1 from private.import_sessions where user_id = v_user);
end
$$;

revoke all on function public.import_ledger_begin(jsonb, integer), public.import_ledger_append(jsonb), public.import_ledger_abort(), public.import_ledger_status() from public, anon, authenticated;
grant execute on function public.import_ledger_begin(jsonb, integer), public.import_ledger_append(jsonb), public.import_ledger_abort(), public.import_ledger_status() to authenticated;

-- ขณะเซสชันนำเข้าเปิด: เขียนข้อมูลได้เฉพาะทางนำเข้า (app.import_ledger) · RLS แบบ restrictive แยกตามคำสั่ง (อ่านไม่ถูกกระทบ)
-- ฟังก์ชัน security definer (abort, reset_my_ledger, delete_my_account) เป็นเจ้าของตาราง จึงไม่ติดนโยบายนี้
do $do$
declare
  t text;
begin
  foreach t in array array['accounts', 'entries', 'lines', 'bills', 'settings'] loop
    execute format(
      'create policy %I on public.%I as restrictive for insert to authenticated with check (%s)',
      t || '_import_lock_ins', t, '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''');
    execute format(
      'create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)',
      t || '_import_lock_upd', t, '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''', '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''');
    execute format(
      'create policy %I on public.%I as restrictive for delete to authenticated using (%s)',
      t || '_import_lock_del', t, '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''');
  end loop;
end
$do$;

-- reset_my_ledger: เหมือนเดิมทุกข้อ + ล้างเซสชันนำเข้าที่ค้าง และใช้ advisory lock ตัวเดียวกับนำเข้า (ไม่ทำงานซ้อนกับ append)
create or replace function public.reset_my_ledger(p_password text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
  v_recent integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'ต้องเรียกแบบเขียนได้ (POST) เท่านั้น' using errcode = '25006';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  perform private.assert_password_cooled(v_user);
  perform pg_advisory_xact_lock(hashtext(v_user::text));
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  delete from private.delete_attempts where user_id = v_user and at < now() - interval '1 day';
  select count(*) into v_recent from private.delete_attempts
   where user_id = v_user and at > now() - interval '15 minutes';
  if v_recent >= 5 then
    raise exception 'ลองผิดหลายครั้งเกินไป ลองใหม่ภายหลัง' using errcode = '53400';
  end if;
  insert into private.delete_attempts (user_id) values (v_user);
  select u.encrypted_password into v_hash from auth.users u where u.id = v_user;
  if v_hash is null or p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    return false;
  end if;
  delete from public.entries where user_id = v_user;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return true;
end
$$;
