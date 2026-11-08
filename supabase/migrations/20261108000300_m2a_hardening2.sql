-- M2-A (แก้จากผลตรวจซ้ำของ security-auditor รอบ 2, 8 พ.ย. 2569)

-- 1) can_use_data(): session ที่หมดอายุ (not_after) ใช้ไม่ได้
create or replace function private.can_use_data() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1 from public.profiles p
            where p.user_id = (select auth.uid()) and not p.must_change_password
         )
     and exists (
           select 1 from auth.sessions s
            where s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
              and s.user_id = (select auth.uid())
              and (s.not_after is null or s.not_after > now())
         )
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
$$;

-- 2) guard: ระบุ role ที่ "อนุญาตให้ข้าม" (ผู้ดูแลระบบ/เจ้าของตาราง) แทนการระบุ role ที่ห้าม
--    role ใหม่ใดๆ (เช่น จาก hook) จะถูกบังคับเสมอ · รายการ source = 'system' สร้างได้เฉพาะใน setup_ledger
create or replace function private.entries_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_found boolean;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source = 'system' and coalesce(current_setting('app.setup_ledger', true), '') <> 'on' then
      raise exception 'รายการยอดยกมา (system) สร้างได้เฉพาะตอนตั้งค่าเริ่มต้น' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.source in ('system', 'recurring') then
      raise exception 'รายการประเภท % แก้ไขไม่ได้', old.source using errcode = '42501';
    end if;
    if new.source in ('system', 'recurring') or new.bill_id is not null then
      raise exception 'เปลี่ยนรายการเป็นประเภท system/recurring หรือผูกบิลภายหลังไม่ได้' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.source = 'system' then
    raise exception 'รายการยอดยกมาลบไม่ได้' using errcode = '42501';
  end if;
  if old.bill_id is not null then
    select b.last_paid_month, true into v_paid, v_found
      from public.bills b where b.user_id = old.user_id and b.id = old.bill_id for update;
    if v_found then
      if v_paid is distinct from old.bill_cycle then
        raise exception 'ยกเลิกการจ่ายได้เฉพาะรอบล่าสุดของบิล' using errcode = '23514';
      end if;
      update public.bills set last_paid_month = old.bill_before
       where user_id = old.user_id and id = old.bill_id;
    end if;
  end if;
  return old;
end
$$;

drop trigger entries_guard_trg on public.entries;
create trigger entries_guard_trg
before insert or update or delete on public.entries
for each row execute function private.entries_guard();

create or replace function private.lines_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_source text;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select e.source into v_source from public.entries e where e.user_id = old.user_id and e.id = old.entry_id;
    if v_source in ('system', 'recurring') then
      raise exception 'บรรทัดของรายการประเภท % แก้ไขไม่ได้', v_source using errcode = '42501';
    end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select e.source into v_source from public.entries e where e.user_id = new.user_id and e.id = new.entry_id;
    if v_source in ('system', 'recurring')
       and coalesce(current_setting('app.entry_insert', true), '') is distinct from new.entry_id then
      raise exception 'เพิ่มบรรทัดเข้ารายการประเภท % โดยตรงไม่ได้', v_source using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function public.setup_ledger(p_accounts jsonb, p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_account jsonb;
  v_entry jsonb;
  v_accounts integer := 0;
  v_entries integer := 0;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_accounts) is distinct from 'array' or jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'accounts และ entries ต้องเป็นอาร์เรย์' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user) then
    raise exception 'มีข้อมูลอยู่แล้ว ตั้งค่าเริ่มต้นซ้ำไม่ได้' using errcode = '23505';
  end if;
  for v_account in select * from jsonb_array_elements(p_accounts) loop
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order)
    values (
      v_user, v_account->>'id', v_account->>'type', v_account->>'name', v_account->>'currency',
      coalesce((v_account->>'archived')::boolean, false), (v_account->>'sortOrder')::integer
    );
    v_accounts := v_accounts + 1;
  end loop;
  perform set_config('app.setup_ledger', 'on', true);
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    perform private.insert_entry(v_entry);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  return jsonb_build_object('accounts', v_accounts, 'entries', v_entries);
end
$$;

-- 3) delete_my_account: ต้องเรียกแบบเขียนได้ (POST) · ล็อกต่อผู้ใช้เพื่อกันยิงพร้อมกัน ·
--    บันทึกการลองก่อนตรวจรหัสเสมอ · ล้างแถวเก่ากว่า 1 วัน
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
