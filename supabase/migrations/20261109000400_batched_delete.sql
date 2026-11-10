-- ล้างข้อมูล/ลบบัญชีแบบเป็นชุด (backlog ข้อ 3) · เพิ่มฟังก์ชันใหม่ ไม่ลบของเดิม
-- ปัญหา: reset_my_ledger / delete_my_account ลบทั้งก้อนในคำสั่งเดียว วัดจริงบนฐานข้อมูลจริง: 10,000 รายการ/20,000 บรรทัด = 1.4 วินาที,
--   10,000 รายการ/200,000 บรรทัด = 10.9 วินาที แต่ role authenticated มี statement_timeout 8 วินาที → ข้อมูลหนักมากจะลบไม่สำเร็จ
-- ใหม่: reset_my_ledger_step(p_password) และ delete_my_account_step(p_password) คืนข้อความ
--   'wrong' = รหัสผ่านผิด (ไม่ลบอะไร) · 'more' = ลบรายการชุดหนึ่งแล้ว ยังเหลือ เรียกซ้ำ · 'done' = เสร็จ (delete: ลบบัญชีแล้ว)
-- ขนาดชุด (ผลตรวจ security-auditor ข้อ 1): จำกัดทั้ง "≤ 500 รายการ" และ "บรรทัดสะสม ≤ 20,000" (อย่างน้อย 1 รายการเสมอ)
--   ลบ 20,000 บรรทัด ≈ 1.1 วินาที (วัด 54 ไมโครวินาทีต่อบรรทัด) ไม่ว่ารายการจะมีกี่บรรทัด · ใช้ตัวช่วยเดียวกันกับ import_ledger_abort ด้วย
--   (ฉบับเดิมใน 20261109000300 จำกัดแค่ 500 รายการ จึงเสี่ยงชนเพดานเวลาถ้ารายการมีหลายร้อยบรรทัด)
-- ความปลอดภัย: ตรวจรหัสผ่านและด่านอื่น "ทุกชุด" (ไม่มีสถานะ "ได้รับอนุญาตแล้ว" ค้างในฐานข้อมูล ผู้ถือ session ที่ขโมยมาจึงลบต่อโดยไม่รู้รหัสไม่ได้)
--   ด่านใน private.deletion_gate: ต้องล็อกอิน · ไม่ใช่การอ่านอย่างเดียว · เปลี่ยนรหัสผ่านแล้ว · cooldown 24 ชม. · จำกัด 5 ครั้ง/15 นาที · ตรวจรหัสผ่าน
--   เปลี่ยนจากเดิม 1 อย่าง: นับเป็น "ครั้งที่ลอง" เฉพาะเมื่อรหัสผิด (เดิมนับทุกครั้งที่เรียก) ไม่งั้นการวนลูปหลายชุดจะชนเพดาน 5 ครั้งเอง
--   (ผลต่อการเดารหัสเท่าเดิม: เดาถูกก็จบ เดาผิดนับครบ 5 แล้วถูกล็อก · คำขอพร้อมกันถูกจัดคิวด้วย advisory lock ก่อนนับ)
--   ข้อกำหนดการตั้งค่า: PostgREST ต้องไม่ยอมรับ header "Prefer: tx=rollback" (ค่าเริ่มต้นของ Supabase db-tx-end=commit) ไม่งั้นแถวรหัสผิดถูกย้อนกลับและเดารหัสได้ไม่จำกัด
--   (ช่องนี้มีอยู่แล้วกับฟังก์ชันเดิม ไม่ใช่ของใหม่)
-- ฟังก์ชันเดิม (reset_my_ledger, delete_my_account) ยังอยู่ครบและให้ authenticated เรียกได้ เพราะเว็บบน production ที่ยังไม่อัปเดตเรียกอยู่
-- ลบเฉพาะรายการทีละชุด (บรรทัดลบตาม cascade) ทุกชุดสมดุลต่อรายการเสมอ · บัญชี/บิล/ตั้งค่า/เซสชันนำเข้าลบในชุดสุดท้ายหลังรายการหมด

-- ลบรายการชุดหนึ่งของผู้ใช้ (ผู้เรียกคือฟังก์ชัน security definer ที่ผ่านด่านแล้ว) · คืนจริงถ้ายังเหลือรายการ
create function private.delete_entry_batch(p_user uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids text[];
begin
  -- คำนวณรหัสรายการของชุดนี้ครั้งเดียวเป็นอาร์เรย์ แล้วลบด้วย = any(...) (ฉบับ delete ... using cte ค้างเมื่อชุด 500 รายการ)
  select array_agg(t.id) into v_ids from (
    select c.id,
           sum(c.n) over (order by c.id) as s,
           row_number() over (order by c.id) as rn
      from (
        select e.id, (select count(*) from public.lines l where l.user_id = p_user and l.entry_id = e.id) as n
          from (select x.id from public.entries x where x.user_id = p_user order by x.id limit 500) e
      ) c
  ) t
  where t.s <= 20000 or t.rn = 1;
  if v_ids is not null then
    delete from public.entries where user_id = p_user and id = any(v_ids);
  end if;
  return exists (select 1 from public.entries where user_id = p_user);
end
$$;
revoke all on function private.delete_entry_batch(uuid) from public, anon, authenticated;

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
begin
  if not private.deletion_gate(p_password) then
    return 'wrong';
  end if;
  if private.delete_entry_batch(v_user) then
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
begin
  if not private.deletion_gate(p_password) then
    return 'wrong';
  end if;
  if private.delete_entry_batch(v_user) then
    return 'more';
  end if;
  -- รายการหมดแล้ว: ลบบัญชีผู้ใช้ (ตารางที่เหลือ เซสชันนำเข้า และโปรไฟล์ลบตาม cascade)
  delete from auth.users where id = v_user;
  return 'done';
end
$$;

-- import_ledger_abort (จาก 20261109000300): คงลายเซ็น/สิทธิ์/ด่านเดิมทุกข้อ เปลี่ยนเฉพาะการลบเป็นชุดที่จำกัดบรรทัดด้วย (create or replace ไม่ต้อง drop)
create or replace function public.import_ledger_abort() returns text
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
    return 'none';
  end if;
  if private.delete_entry_batch(v_user) then
    return 'more';
  end if;
  delete from public.bills where user_id = v_user;
  delete from public.accounts where user_id = v_user;
  delete from public.settings where user_id = v_user;
  delete from private.import_sessions where user_id = v_user;
  return 'done';
end
$$;

revoke all on function public.reset_my_ledger_step(text), public.delete_my_account_step(text) from public, anon, authenticated;
grant execute on function public.reset_my_ledger_step(text), public.delete_my_account_step(text) to authenticated;
