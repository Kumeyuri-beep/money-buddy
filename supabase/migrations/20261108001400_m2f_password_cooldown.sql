-- M2-F: cooldown 24 ชั่วโมงหลังเปลี่ยนรหัสผ่าน ห้ามลบบัญชี/ล้างข้อมูล (เจ้าของตัดสินใจ 9 พ.ย. 2569 · บังคับฝั่งเซิร์ฟเวอร์)
-- เหตุผล (ผล security-auditor M2-E): เปลี่ยนรหัสผ่านผ่าน GoTrue ไม่ถามรหัสเดิมจากเซิร์ฟเวอร์ ผู้ถือ session ที่ขโมยมาจึงตั้งรหัสใหม่เอง
--   แล้วใช้รหัสใหม่ผ่านด่านรหัสผ่านของ delete_my_account / reset_my_ledger ได้ · cooldown กันการ "ยึดบัญชีแล้วลบทันที"
--   ให้เจ้าของตัวจริงมีเวลาสังเกต/ขอให้ผู้ดูแลรีเซ็ต (ไม่กันการยึดบัญชีเอง: นั่นแก้ด้วย CSP กัน XSS ที่เป็นทางขโมย token)
-- ใช้ profiles.password_changed_at ที่ trigger handle_password_change ตั้งทุกครั้งที่ encrypted_password เปลี่ยน (รวมรีเซ็ตโดยผู้ดูแล)
-- ยังไม่เคยเปลี่ยนรหัส (null) = ผ่าน (ผู้ใช้ที่ยังไม่เปลี่ยนรหัสถูก can_use_data() ปิดอยู่แล้ว และไม่มีใครเปลี่ยนรหัสไป)

create function private.assert_password_cooled(p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_changed timestamptz;
begin
  select p.password_changed_at into v_changed from public.profiles p where p.user_id = p_user;
  if v_changed is not null and v_changed > now() - interval '24 hours' then
    raise exception 'เพิ่งเปลี่ยนรหัสผ่านภายใน 24 ชั่วโมง จึงยังลบบัญชีหรือล้างข้อมูลไม่ได้ (มาตรการกันผู้อื่นที่ได้ session ไปเปลี่ยนรหัสแล้วลบข้อมูล) ลองใหม่ภายหลัง'
      using errcode = '55000';
  end if;
end
$$;
revoke all on function private.assert_password_cooled(uuid) from public, anon, authenticated;

create or replace function public.delete_my_account(p_password text) returns boolean
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
  delete from auth.users where id = v_user;
  return true;
end
$$;

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
  return true;
end
$$;

revoke all on function public.delete_my_account(text), public.reset_my_ledger(text) from public, anon, authenticated;
grant execute on function public.delete_my_account(text), public.reset_my_ledger(text) to authenticated;
