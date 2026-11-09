-- ล้างข้อมูล/ลบบัญชีแบบเป็นชุด (backlog ข้อ 3) · เพิ่มฟังก์ชันใหม่ ไม่แก้/ไม่ลบของเดิม
-- ปัญหา: reset_my_ledger / delete_my_account ลบทั้งก้อนในคำสั่งเดียว วัดจริงบนฐานข้อมูลจริง: 10,000 รายการ/20,000 บรรทัด = 1.4 วินาที,
--   10,000 รายการ/200,000 บรรทัด = 10.9 วินาที แต่ role authenticated มี statement_timeout 8 วินาที → ข้อมูลหนักมากจะลบไม่สำเร็จ
-- ใหม่: reset_my_ledger_step(p_password) และ delete_my_account_step(p_password) คืนข้อความ
--   'wrong' = รหัสผ่านผิด (ไม่ลบอะไร) · 'more' = ลบรายการชุดละ ≤ 500 แล้ว ยังเหลือ เรียกซ้ำ · 'done' = เสร็จ (delete: ลบบัญชีแล้ว)
-- ความปลอดภัย: ตรวจรหัสผ่านและด่านอื่น "ทุกชุด" (ไม่มีสถานะ "ได้รับอนุญาตแล้ว" ค้างในฐานข้อมูล ผู้ถือ session ที่ขโมยมาจึงลบต่อโดยไม่รู้รหัสไม่ได้)
--   ด่านใน private.deletion_gate: ต้องล็อกอิน · ไม่ใช่การอ่านอย่างเดียว · เปลี่ยนรหัสผ่านแล้ว · cooldown 24 ชม. · จำกัด 5 ครั้ง/15 นาที · ตรวจรหัสผ่าน
--   เปลี่ยนจากเดิม 1 อย่าง: นับเป็น "ครั้งที่ลอง" เฉพาะเมื่อรหัสผิด (เดิมนับทุกครั้งที่เรียก) ไม่งั้นการวนลูปหลายชุดจะชนเพดาน 5 ครั้งเอง
--   (ผลต่อการเดารหัสเท่าเดิม: เดาถูกก็จบ เดาผิดนับครบ 5 แล้วถูกล็อก)
-- ฟังก์ชันเดิมยังอยู่ครบและให้ authenticated เรียกได้ เพราะเว็บบน production ที่ยังไม่อัปเดตเรียกอยู่ (จะถอดทีหลังเมื่อเว็บใหม่ขึ้นแล้ว)
-- ลบเฉพาะรายการทีละชุด (บรรทัดลบตาม cascade) ทุกชุดสมดุลต่อรายการเสมอ · บัญชี/บิล/ตั้งค่า/เซสชันนำเข้าลบในชุดสุดท้ายหลังรายการหมด

create function private.deletion_gate(p_password text) returns boolean
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
  select u.encrypted_password into v_hash from auth.users u where u.id = v_user;
  if v_hash is null or p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    insert into private.delete_attempts (user_id) values (v_user);
    return false;
  end if;
  return true;
end
$$;
revoke all on function private.deletion_gate(text) from public, anon, authenticated;

create function public.reset_my_ledger_step(p_password text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_deleted integer;
begin
  if not private.deletion_gate(p_password) then
    return 'wrong';
  end if;
  with batch as (
    select e.id from public.entries e where e.user_id = v_user order by e.id limit 500
  )
  delete from public.entries e using batch b where e.user_id = v_user and e.id = b.id;
  get diagnostics v_deleted = row_count;
  if v_deleted >= 500 then
    return 'more';
  end if;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;

create function public.delete_my_account_step(p_password text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_deleted integer;
begin
  if not private.deletion_gate(p_password) then
    return 'wrong';
  end if;
  with batch as (
    select e.id from public.entries e where e.user_id = v_user order by e.id limit 500
  )
  delete from public.entries e using batch b where e.user_id = v_user and e.id = b.id;
  get diagnostics v_deleted = row_count;
  if v_deleted >= 500 then
    return 'more';
  end if;
  -- รายการหมดแล้ว: ลบบัญชีผู้ใช้ (ตารางที่เหลือ เซสชันนำเข้า และโปรไฟล์ลบตาม cascade)
  delete from auth.users where id = v_user;
  return 'done';
end
$$;

revoke all on function public.reset_my_ledger_step(text), public.delete_my_account_step(text) from public, anon, authenticated;
grant execute on function public.reset_my_ledger_step(text), public.delete_my_account_step(text) to authenticated;
