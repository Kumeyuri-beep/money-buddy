-- ทดสอบ migration 20261205000100_retire_legacy_rpc: ฟังก์ชันรุ่นเก่าเรียกผ่าน API ไม่ได้ (อยู่ใน private) ตัวห่อ _as เรียกปลายทางใหม่
-- วิธีรัน: **หลังใส่ migration** · จบด้วย raise TESTS_PASSED · พฤติกรรมของตัวห่อทดสอบใน expected_user_guard_test.sql

do $t$
declare
  sig text;
  sigs text[] := array[
    'setup_ledger(jsonb, jsonb)',
    'import_ledger(jsonb)',
    'import_ledger_begin(jsonb, integer)',
    'import_ledger_append(jsonb)',
    'import_ledger_abort()',
    'import_ledger_investments(jsonb)',
    'import_ledger_investments_replacing_categories(jsonb, integer)',
    'reset_my_ledger_step(text)',
    'delete_my_account_step(text)',
    'reset_my_ledger(text)',
    'delete_my_account(text)'];
  wrapper text;
  r text;
begin
  -- T1 ไม่เหลือชื่อเดิมใน public (ทุกรูปแบบอาร์กิวเมนต์) · อยู่ใน private ครบ สิทธิ์เดิม
  select string_agg(p.proname, ', ') into r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (array['setup_ledger', 'import_ledger', 'import_ledger_begin', 'import_ledger_append', 'import_ledger_abort', 'import_ledger_investments', 'import_ledger_investments_replacing_categories', 'reset_my_ledger_step', 'delete_my_account_step', 'reset_my_ledger', 'delete_my_account']);
  if r is not null then raise exception 'FAIL: T1a ยังเรียกผ่าน API ได้: %', r; end if;
  foreach sig in array sigs loop
    if to_regprocedure('private.' || sig) is null then raise exception 'FAIL: T1b ไม่พบ private.%', sig; end if;
    if has_function_privilege('anon', 'private.' || sig, 'execute') then raise exception 'FAIL: T1c anon เรียกได้ %', sig; end if;
    if not has_function_privilege('authenticated', 'private.' || sig, 'execute') then raise exception 'FAIL: T1d ตัวห่อจะเรียกไม่ได้ %', sig; end if;
  end loop;

  -- T2 ตัวห่อ 9 ตัวยังเป็น security invoker และเรียกปลายทางใน private เท่านั้น
  for wrapper in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (array['setup_ledger_as', 'import_ledger_as', 'import_ledger_begin_as', 'import_ledger_append_as', 'import_ledger_abort_as', 'import_ledger_investments_as', 'import_ledger_investments_replacing_categories_as', 'reset_my_ledger_step_as', 'delete_my_account_step_as'])
  loop
    if (select p.prosecdef from pg_proc p where p.oid = wrapper::regprocedure) then raise exception 'FAIL: T2a ต้องเป็น security invoker %', wrapper; end if;
    if (select p.prosrc from pg_proc p where p.oid = wrapper::regprocedure) !~ 'return private[.][a-z_]' then raise exception 'FAIL: T2b ต้องเรียก private %', wrapper; end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['%ledger%_as', 'delete_my_account_step_as'])) <> 9 then
    raise exception 'FAIL: T2c ตัวห่อต้องมี 9 ตัว';
  end if;

  -- T3 ไม่มีฟังก์ชันใดยังอ้างชื่อเดิมใน public
  select string_agg(p.oid::regprocedure::text, ', ') into r
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prosrc ~ 'public[.](import_ledger_investments_replacing_categories|import_ledger_investments|delete_my_account_step|import_ledger_append|reset_my_ledger_step|import_ledger_begin|import_ledger_abort|delete_my_account|reset_my_ledger|import_ledger|setup_ledger)[(]';
  if r is not null then raise exception 'FAIL: T3 ยังอ้างชื่อเดิม: %', r; end if;

  raise exception 'TESTS_PASSED (rollback แล้ว ไม่มีข้อมูลทดสอบเหลือ)';
end
$t$;
