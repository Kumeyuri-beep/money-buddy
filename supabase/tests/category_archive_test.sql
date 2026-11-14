-- ทดสอบ migration 20261114000100: public.set_category_archived (ซ่อน/เปิดกลับหมวดรายรับ-รายจ่าย)
-- วิธีรัน: วางทั้งไฟล์ใน Supabase SQL Editor (หรือ execute_sql) **หลังใส่ migration 20261114000100_set_category_archived** · จบด้วย rollback: TESTS_PASSED
-- ไม่ใช้ข้อมูลการเงินจริง

create function pg_temp.settle() returns void language plpgsql as $$ begin execute 'set constraints all immediate'; execute 'set constraints all deferred'; end $$;
create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$ begin execute p_sql; perform pg_temp.settle(); return null; exception when others then return sqlstate; end $$;
create function pg_temp.login(p_user uuid) returns void language plpgsql as $$
declare v_sid uuid := md5(p_user::text)::uuid;
begin
  execute 'reset role';
  insert into auth.sessions (id, user_id) values (v_sid, p_user) on conflict (id) do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v_sid, 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
grant execute on function pg_temp.settle(), pg_temp.state_of(text), pg_temp.login(uuid), pg_temp.logout() to public;

do $t$
declare
  ua uuid := gen_random_uuid();
  ub uuid := gen_random_uuid();
  uc uuid := gen_random_uuid();
  st text;
  n integer;
  v boolean;
  acc jsonb := '[
    {"id":"w1","type":"asset","name":"w1","currency":"THB"},
    {"id":"food","type":"expense","name":"food","currency":"THB"},
    {"id":"fun","type":"expense","name":"fun","currency":"THB"},
    {"id":"salary","type":"income","name":"salary","currency":"THB"},
    {"id":"inv-gain","type":"income","name":"gain","currency":"THB"},
    {"id":"open","type":"equity","name":"open","currency":"THB"}]';
  ent jsonb := '[{"id":"sys","date":"2026-11-01","memo":"o","source":"system","lines":[{"accountId":"w1","amount":1000},{"accountId":"open","amount":-1000}]},{"id":"e1","date":"2026-11-02","memo":"x","lines":[{"accountId":"food","amount":100},{"accountId":"w1","amount":-100}]}]';
begin
  insert into auth.users (id, email, encrypted_password, aud, role, instance_id)
  values (ua, 'a-cat@users.money-buddy.internal', extensions.crypt('old-password-1', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (ub, 'b-cat@users.money-buddy.internal', extensions.crypt('old-password-2', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (uc, 'c-cat@users.money-buddy.internal', extensions.crypt('old-password-3', extensions.gen_salt('bf')), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  update auth.users set encrypted_password = extensions.crypt('new-password-1', extensions.gen_salt('bf')) where id = ua;
  update auth.users set encrypted_password = extensions.crypt('new-password-2', extensions.gen_salt('bf')) where id = ub;
  -- uc ยังไม่เปลี่ยนรหัสผ่าน (ด่าน can_use_data ต้องกัน)

  -- T1 สิทธิ์เรียกฟังก์ชัน: authenticated เรียกได้ · anon/public เรียกไม่ได้ · สิทธิ์ update ของตารางไม่ถูกเปิดเพิ่ม
  if not has_function_privilege('authenticated', 'public.set_category_archived(text, boolean)', 'execute') then raise exception 'FAIL: T1 authenticated เรียกไม่ได้'; end if;
  if has_function_privilege('anon', 'public.set_category_archived(text, boolean)', 'execute') then raise exception 'FAIL: T1 anon เรียกได้'; end if;
  if has_column_privilege('authenticated', 'public.accounts', 'archived', 'update') then raise exception 'FAIL: T1 authenticated แก้ archived ตรงๆ ได้'; end if;

  perform pg_temp.login(ua);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();
  -- ผู้ใช้ B มีหมวดรหัสเดียวกัน (กันรั่วข้ามผู้ใช้)
  perform pg_temp.login(ub);
  perform public.setup_ledger(acc, ent);
  perform pg_temp.settle();

  -- T2 ซ่อนหมวดที่มีรายการแล้ว: archived เปลี่ยน · ชื่อ/ชนิด/สกุลเงินและรายการเดิมไม่เปลี่ยน
  perform pg_temp.login(ua);
  v := public.set_category_archived('food', true);
  if v is not true then raise exception 'FAIL: T2 คืนค่าไม่ใช่ true'; end if;
  if (select archived from public.accounts where id = 'food') is not true then raise exception 'FAIL: T2 archived ไม่เปลี่ยน'; end if;
  if (select name || type || currency from public.accounts where id = 'food') is distinct from 'foodexpenseTHB' then raise exception 'FAIL: T2 คอลัมน์อื่นเปลี่ยน'; end if;
  select count(*) into n from public.lines where account_id = 'food';
  if n <> 1 then raise exception 'FAIL: T2 รายการเดิมหาย (% บรรทัด)', n; end if;

  -- T3 ซ่อนตัวสุดท้ายของประเภทไม่ได้ (23514) · เปิดกลับได้
  st := pg_temp.state_of($q$select public.set_category_archived('fun', true)$q$);
  if st is distinct from '23514' then raise exception 'FAIL: T3 ซ่อนตัวสุดท้ายต้อง 23514 ได้ %', st; end if;
  v := public.set_category_archived('food', false);
  if (select archived from public.accounts where id = 'food') is not false then raise exception 'FAIL: T3 เปิดกลับไม่ได้'; end if;
  -- หมวดรายรับมีแค่ salary (inv-gain ไม่นับ): ซ่อน salary ไม่ได้
  st := pg_temp.state_of($q$select public.set_category_archived('salary', true)$q$);
  if st is distinct from '23514' then raise exception 'FAIL: T3 ซ่อน salary (ตัวเดียวที่ใช้ได้) ต้อง 23514 ได้ %', st; end if;

  -- T4 ซ่อนสิ่งที่ไม่ใช่หมวดไม่ได้: กระเป๋า ยอดยกมา หมวดผลการลงทุน ไม่มีอยู่
  st := pg_temp.state_of($q$select public.set_category_archived('w1', true)$q$);
  if st is distinct from 'P0002' then raise exception 'FAIL: T4 กระเป๋า ต้อง P0002 ได้ %', st; end if;
  st := pg_temp.state_of($q$select public.set_category_archived('open', true)$q$);
  if st is distinct from 'P0002' then raise exception 'FAIL: T4 ยอดยกมา ต้อง P0002 ได้ %', st; end if;
  st := pg_temp.state_of($q$select public.set_category_archived('inv-gain', true)$q$);
  if st is distinct from '42501' then raise exception 'FAIL: T4 inv-gain ต้อง 42501 ได้ %', st; end if;
  st := pg_temp.state_of($q$select public.set_category_archived('no-such', true)$q$);
  if st is distinct from 'P0002' then raise exception 'FAIL: T4 ไม่มีอยู่ ต้อง P0002 ได้ %', st; end if;
  st := pg_temp.state_of($q$select public.set_category_archived(null, true)$q$);
  if st is distinct from '22023' then raise exception 'FAIL: T4 id null ต้อง 22023 ได้ %', st; end if;
  st := pg_temp.state_of($q$select public.set_category_archived('food', null)$q$);
  if st is distinct from '22023' then raise exception 'FAIL: T4 archived null ต้อง 22023 ได้ %', st; end if;

  -- T5 ไม่รั่วข้ามผู้ใช้: B ซ่อนหมวดของตัวเองได้ ไม่กระทบของ A · A ซ่อน food (ซ่อนได้เพราะมี fun) ไม่กระทบของ B
  perform pg_temp.login(ub);
  v := public.set_category_archived('fun', true);
  perform pg_temp.login(ua);
  if (select archived from public.accounts where id = 'fun') is not false then raise exception 'FAIL: T5 การซ่อนของ B กระทบหมวดของ A'; end if;
  v := public.set_category_archived('fun', true); -- A ซ่อน fun ได้เมื่อ food เปิดอยู่
  perform pg_temp.login(ub);
  if (select archived from public.accounts where id = 'food') is not false then raise exception 'FAIL: T5 การซ่อนของ A กระทบหมวดของ B'; end if;

  -- T6 ต้องล็อกอิน และต้องเปลี่ยนรหัสผ่านแล้ว
  perform pg_temp.logout();
  st := pg_temp.state_of($q$select public.set_category_archived('food', true)$q$);
  if st not in ('28000', '42501') then raise exception 'FAIL: T6 ไม่ล็อกอินต้องถูกปฏิเสธ ได้ %', st; end if;
  perform pg_temp.login(uc);
  st := pg_temp.state_of($q$select public.set_category_archived('food', true)$q$);
  if st is distinct from '42501' then raise exception 'FAIL: T6 ยังไม่เปลี่ยนรหัสผ่านต้อง 42501 ได้ %', st; end if;

  -- T7 แก้ archived ตรงๆ ยังถูกปฏิเสธ (สิทธิ์คอลัมน์) และเพิ่มหมวดใหม่ผ่าน insert ยังทำได้
  perform pg_temp.login(ua);
  st := pg_temp.state_of($q$update public.accounts set archived = true where id = 'food'$q$);
  if st is distinct from '42501' then raise exception 'FAIL: T7 update archived ตรงๆ ต้อง 42501 ได้ %', st; end if;
  insert into public.accounts (id, type, name, currency, kind) values ('cat-new', 'expense', 'หมวดใหม่', 'THB', 'normal');
  if not exists (select 1 from public.accounts where id = 'cat-new' and archived is false) then raise exception 'FAIL: T7 เพิ่มหมวดใหม่ไม่ได้'; end if;

  -- T8 ผลตรวจ security-auditor: ฟังก์ชันเป็น security definer และตั้ง search_path ว่าง (กันมีคนเขียนทับแล้วลืมตั้ง)
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_category_archived' and p.prosecdef
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
  ) then raise exception 'FAIL: T8 set_category_archived ต้องเป็น security definer และตั้ง search_path'; end if;

  -- T9 A เรียกด้วยรหัสที่มีแต่ B มี = P0002 และแถวของ B ไม่เปลี่ยน (ไม่รั่วข้ามผู้ใช้แบบตรงๆ)
  perform pg_temp.login(ub);
  insert into public.accounts (id, type, name, currency, kind) values ('b-only', 'expense', 'ของ B', 'THB', 'normal');
  perform pg_temp.login(ua);
  st := pg_temp.state_of($q$select public.set_category_archived('b-only', true)$q$);
  if st is distinct from 'P0002' then raise exception 'FAIL: T9 รหัสของ B ต้อง P0002 ได้ %', st; end if;
  perform pg_temp.login(ub);
  if (select archived from public.accounts where id = 'b-only') is not false then raise exception 'FAIL: T9 แถวของ B ถูกแก้'; end if;

  -- T10 ซ่อนหมวดที่ซ่อนอยู่แล้วซ้ำ/เปิดหมวดที่เปิดอยู่ซ้ำ ไม่พัง (idempotent ฝั่งฐานข้อมูล · เว็บเป็นด่านบอกผู้ใช้)
  perform pg_temp.login(ub);
  v := public.set_category_archived('fun', true);
  v := public.set_category_archived('fun', true);
  if (select archived from public.accounts where id = 'fun') is not true then raise exception 'FAIL: T10 ซ่อนซ้ำแล้วสถานะผิด'; end if;
  v := public.set_category_archived('food', false);
  if (select archived from public.accounts where id = 'food') is not false then raise exception 'FAIL: T10 เปิดซ้ำแล้วสถานะผิด'; end if;

  -- หมายเหตุ: การกันสองแท็บซ่อนคนละหมวดพร้อมกัน (ล็อกแถว) พิสูจน์ในธุรกรรมเดียวไม่ได้ · ตรวจจากการออกแบบ (for update เรียง id) เท่านั้น

  perform pg_temp.logout();
  raise exception 'TESTS_PASSED';
end
$t$;
