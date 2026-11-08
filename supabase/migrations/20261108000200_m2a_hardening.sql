-- M2-A (แก้จากผลตรวจ security-auditor + money-auditor 8 พ.ย. 2569)

-- 1) can_use_data(): ต้องมี session ที่ยังไม่ถูกเพิกถอน และไม่ใช่ผู้ใช้ anonymous
--    (หลัง logout / reset รหัส access token เก่าใช้อ่านข้อมูลไม่ได้ทันที)
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
         )
     and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
$$;

-- 2) R15: จ่ายได้ครั้งเดียวต่อบิลต่อรอบ ที่ระดับตาราง (ไม่พึ่ง bills.last_paid_month อย่างเดียว)
create unique index entries_bill_cycle_once_idx
  on public.entries (user_id, bill_id, bill_cycle) where bill_id is not null;

-- 3) guard: เลิกใช้ตัวแปร session (app.deleting_account) ใช้ role ของผู้เรียกแทน
--    ผู้ใช้ผ่าน REST เป็น authenticated/anon จึงถูกบังคับเสมอ · การลบ cascade จาก auth.users
--    (delete_my_account, Dashboard, Admin API) ทำงานในนามเจ้าของตาราง จึงผ่าน
create or replace function private.entries_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_found boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
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

-- บรรทัดของ system/recurring: เพิ่ม/แก้/ย้าย/ลบตรงๆ ไม่ได้ · เพิ่มได้เฉพาะผ่าน private.insert_entry (ตั้ง app.entry_insert = id ของ Entry ที่กำลังสร้าง)
create or replace function private.lines_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_source text;
begin
  if current_user not in ('authenticated', 'anon') then
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

drop trigger lines_guard_trg on public.lines;
create trigger lines_guard_trg
before insert or update or delete on public.lines
for each row execute function private.lines_guard();

create or replace function private.insert_entry(p_entry jsonb) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id text := p_entry->>'id';
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or v_id is null then
    raise exception 'รูปแบบรายการไม่ถูกต้อง' using errcode = '22023';
  end if;
  if (p_entry->>'date') is null or (p_entry->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'วันที่ต้องเป็น YYYY-MM-DD' using errcode = '22007';
  end if;
  insert into public.entries (user_id, id, date, memo, source, group_id, created_at, bill_id, bill_cycle, bill_before)
  values (
    v_user, v_id, (p_entry->>'date')::date, coalesce(p_entry->>'memo', ''),
    coalesce(p_entry->>'source', 'manual'), p_entry->>'groupId',
    coalesce((p_entry->>'createdAt')::timestamptz, now()),
    p_entry #>> '{bill,id}', p_entry #>> '{bill,cycle}', p_entry #>> '{bill,before}'
  );
  perform set_config('app.entry_insert', v_id, true);
  perform private.insert_lines(v_user, v_id, p_entry->'lines');
  perform set_config('app.entry_insert', '', true);
  return v_id;
end
$$;

-- 4) record_consent ต้องเปลี่ยนรหัสแล้ว (กันคนถือรหัสชั่วคราวกดยินยอมแทน)
create or replace function public.record_consent() returns void
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
  update public.profiles set consented_at = coalesce(consented_at, now()) where user_id = v_user;
end
$$;

-- 5) delete_my_account: จำกัดการเดารหัส (ผิด 5 ครั้งใน 15 นาที = ล็อก) คืน false เมื่อรหัสผิด (ไม่ raise เพื่อให้ตัวนับถูกบันทึก)
create table private.delete_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index delete_attempts_user_at_idx on private.delete_attempts (user_id, at);
revoke all on private.delete_attempts from public, anon, authenticated;

drop function public.delete_my_account(text);
create function public.delete_my_account(p_password text) returns boolean
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
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
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
  delete from auth.users where id = v_user;
  return true;
end
$$;
revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.delete_my_account(text) to authenticated;

-- 6) ถอนสิทธิ์เริ่มต้นของตาราง/ลำดับ/ฟังก์ชันที่จะสร้างใน migration ต่อไป (ต้อง grant เองเฉพาะที่ต้องใช้)
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
alter default privileges for role postgres revoke execute on functions from public;
