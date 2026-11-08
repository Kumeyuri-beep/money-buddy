-- M2-C2 (ตามผล security-auditor/money-auditor):
-- 1) reset_my_ledger ต้องใส่รหัสผ่านและจำกัดการลอง แบบเดียวกับ delete_my_account (กัน session ที่ถูกขโมยล้างสมุดทั้งเล่มได้ในคำขอเดียว)
--    คืน true = ล้างแล้ว · false = รหัสผ่านผิด
-- 2) entries_bill_link: ปฏิเสธการจ่ายบิลที่ถูกเก็บถาวร (เดิมเช็คแค่ lastPaidMonth/รอบ)

drop function public.reset_my_ledger();

create function public.reset_my_ledger(p_password text) returns boolean
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
  perform pg_advisory_xact_lock(hashtext(v_user::text));
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
  -- ลำดับตาม FK: รายการ (บรรทัด cascade) -> บิล -> บัญชี -> ค่าตั้งค่า · แตะเฉพาะแถวของตัวเอง
  delete from public.entries where user_id = v_user;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  return true;
end
$$;

revoke all on function public.reset_my_ledger(text) from public, anon, authenticated;
grant execute on function public.reset_my_ledger(text) to authenticated;

create or replace function private.entries_bill_link() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_archived boolean;
  v_found boolean;
begin
  if new.bill_id is null then
    return null;
  end if;
  select b.last_paid_month, b.archived, true into v_paid, v_archived, v_found
    from public.bills b where b.user_id = new.user_id and b.id = new.bill_id for update;
  if not coalesce(v_found, false) then
    raise exception 'ไม่พบบิลที่ผูก' using errcode = '23503';
  end if;
  if v_archived then
    raise exception 'บิลถูกเก็บถาวรแล้ว จ่ายไม่ได้' using errcode = '23514';
  end if;
  if new.bill_before is distinct from v_paid then
    raise exception 'สถานะบิลเปลี่ยนไปแล้ว (lastPaidMonth ไม่ตรง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001';
  end if;
  if new.bill_cycle <= coalesce(v_paid, '') then
    raise exception 'รอบนี้จ่ายแล้ว' using errcode = '23514';
  end if;
  if new.bill_cycle > private.current_month() then
    raise exception 'จ่ายล่วงหน้าเกินเดือนปัจจุบันไม่ได้' using errcode = '23514';
  end if;
  update public.bills set last_paid_month = new.bill_cycle where user_id = new.user_id and id = new.bill_id;
  return null;
end
$$;
