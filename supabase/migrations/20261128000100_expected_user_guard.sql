-- ปิดช่องว่างระหว่าง "ตรวจบัญชี" กับ "เขียน" ตอนนำเข้า ตั้งต้น และล้างข้อมูล (เจ้าของอนุมัติให้ "เตรียม" 28 พ.ย. 2569 · HANDOFF §123 ข้อ ข)
-- ใส่ฐานข้อมูลแล้ว 28 พ.ย. 2569 (เจ้าของอนุมัติ · ใส่หลัง 20261128000200) · เทสต์ SQL หลังใส่ผ่านครบ 33/33 ไฟล์
--
-- ปัญหา: เบราว์เซอร์ใช้เซสชันร่วมกันทุกแท็บ เว็บตรวจบัญชีก่อนเรียกได้ แต่เซสชันอาจเปลี่ยนระหว่างตรวจกับเรียก
-- ทางแก้: ฟังก์ชันตัวห่อ <ชื่อเดิม>_as(p_expected_user, ...) ตรวจว่า auth.uid() ตรงกับผู้ใช้ที่หน้าจอตั้งใจ แล้วเรียกฟังก์ชันเดิมในธุรกรรมเดียวกัน
-- เป็นการเพิ่มอย่างเดียว: ฟังก์ชันเดิม สิทธิ์เดิม ตารางและ policy ไม่ถูกแตะ เว็บรุ่นเก่าใช้ต่อได้
-- ตัวห่อเป็น security invoker (ไม่เพิ่มสิทธิ์): ด่านของฟังก์ชันเดิมทุกข้อยังทำงานเหมือนเดิม
-- ไม่ตรง = PT412 (เว็บแปลงเป็น "บัญชีที่เข้าสู่ระบบเปลี่ยนไป") ก่อนฟังก์ชันเดิมจะทำอะไร รวมถึงก่อนนับรหัสผ่านผิด

create function private.assert_expected_user(p_expected_user uuid) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if p_expected_user is distinct from v_user then
    raise exception 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป ยังไม่ได้ทำอะไร' using errcode = 'PT412';
  end if;
end
$$;
revoke all on function private.assert_expected_user(uuid) from public, anon, authenticated;
grant execute on function private.assert_expected_user(uuid) to authenticated;

create function public.setup_ledger_as(p_expected_user uuid, p_accounts jsonb, p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.setup_ledger(p_accounts, p_entries);
end
$$;

create function public.import_ledger_as(p_expected_user uuid, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger(p_data);
end
$$;

create function public.import_ledger_begin_as(p_expected_user uuid, p_data jsonb, p_total_entries integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger_begin(p_data, p_total_entries);
end
$$;

create function public.import_ledger_append_as(p_expected_user uuid, p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger_append(p_entries);
end
$$;

create function public.import_ledger_abort_as(p_expected_user uuid) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger_abort();
end
$$;

create function public.import_ledger_investments_as(p_expected_user uuid, p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger_investments(p_data);
end
$$;

create function public.import_ledger_investments_replacing_categories_as(p_expected_user uuid, p_data jsonb, p_expected_categories integer) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.import_ledger_investments_replacing_categories(p_data, p_expected_categories);
end
$$;

create function public.reset_my_ledger_step_as(p_expected_user uuid, p_password text) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.reset_my_ledger_step(p_password);
end
$$;

create function public.delete_my_account_step_as(p_expected_user uuid, p_password text) returns text
language plpgsql security invoker set search_path = ''
as $$
begin
  perform private.assert_expected_user(p_expected_user);
  return public.delete_my_account_step(p_password);
end
$$;

revoke all on function
  public.setup_ledger_as(uuid, jsonb, jsonb),
  public.import_ledger_as(uuid, jsonb),
  public.import_ledger_begin_as(uuid, jsonb, integer),
  public.import_ledger_append_as(uuid, jsonb),
  public.import_ledger_abort_as(uuid),
  public.import_ledger_investments_as(uuid, jsonb),
  public.import_ledger_investments_replacing_categories_as(uuid, jsonb, integer),
  public.reset_my_ledger_step_as(uuid, text),
  public.delete_my_account_step_as(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.setup_ledger_as(uuid, jsonb, jsonb),
  public.import_ledger_as(uuid, jsonb),
  public.import_ledger_begin_as(uuid, jsonb, integer),
  public.import_ledger_append_as(uuid, jsonb),
  public.import_ledger_abort_as(uuid),
  public.import_ledger_investments_as(uuid, jsonb),
  public.import_ledger_investments_replacing_categories_as(uuid, jsonb, integer),
  public.reset_my_ledger_step_as(uuid, text),
  public.delete_my_account_step_as(uuid, text)
to authenticated;
