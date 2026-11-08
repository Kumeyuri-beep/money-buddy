-- M2-A: ตาราง สมุดบัญชีคู่ RLS และ RPC ของ Money Buddy (หลายผู้ใช้)
-- แผน docs/plans/2026-11-04-m2-multi-user.md (ข้อ 4.1-4.3, 4.6) · กฎ R1 R15 R16
-- ข้อมูลทุกตารางเป็นของผู้ใช้คนเดียว (user_id) แยกด้วย RLS · ยอดเงินเป็นสตางค์จำนวนเต็ม (bigint) ในช่วง ±(2^53-1)

-- ---------------------------------------------------------------------------
-- 0. schema private: ฟังก์ชันภายใน ไม่เปิดผ่าน API (PostgREST เปิดเฉพาะ public)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- เดือนปัจจุบันตามเวลาไทย 'YYYY-MM' (R15: lastPaidMonth ต้องไม่เกินเดือนปัจจุบัน)
create function private.current_month() returns text
language sql stable set search_path = ''
as $$ select to_char(timezone('Asia/Bangkok', now()), 'YYYY-MM') $$;

-- ---------------------------------------------------------------------------
-- 1. profiles: ธงบังคับเปลี่ยนรหัส + วันที่ยินยอม (ผู้ใช้อ่านได้ เขียนไม่ได้)
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  must_change_password boolean not null default true,
  consented_at timestamptz,
  password_changed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ผู้ใช้ใหม่ทุกคนได้แถว profiles อัตโนมัติ โดยธงบังคับเปลี่ยนรหัสเป็น true (ปิดไว้ก่อน)
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- ธงเคลียร์ได้เฉพาะเมื่อรหัสผ่านเปลี่ยนจริง (hash ต่างจากเดิม)
create function private.handle_password_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles
     set must_change_password = false, password_changed_at = now()
   where user_id = new.id;
  return new;
end
$$;

create trigger on_auth_user_password_changed
after update of encrypted_password on auth.users
for each row
when (old.encrypted_password is distinct from new.encrypted_password)
execute function private.handle_password_change();

-- ผ่านเมื่อมีแถว profiles ของผู้ใช้ที่ล็อกอินอยู่ และเปลี่ยนรหัสแล้วเท่านั้น (ไม่มีแถว/ไม่ได้ล็อกอิน = ไม่ผ่าน)
create function private.can_use_data() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = (select auth.uid()) and not p.must_change_password
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. ตารางข้อมูล (user_id ทุกตาราง ลบผู้ใช้ = ลบข้อมูลทั้งหมดตาม cascade)
-- ---------------------------------------------------------------------------
create table public.accounts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  type text not null check (type in ('asset', 'liability', 'income', 'expense', 'equity')),
  name text not null check (char_length(name) between 1 and 200),
  currency text not null check (currency ~ '^[A-Z0-9]{2,10}$'),
  archived boolean not null default false,
  sort_order integer,
  primary key (user_id, id)
);

create table public.entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  date date not null check (date between date '1900-01-01' and date '2999-12-31'),
  memo text not null default '' check (char_length(memo) <= 2000),
  source text not null default 'manual'
    check (source in ('manual', 'ocr', 'quick', 'recurring', 'debt', 'import', 'system')),
  group_id text check (group_id is null or char_length(group_id) between 1 and 100),
  created_at timestamptz not null default now(),
  -- รายการจ่ายบิลประจำ (R15): ผูกกับบิล + รอบ + lastPaidMonth ก่อนจ่าย
  bill_id text,
  bill_cycle text,
  bill_before text,
  primary key (user_id, id),
  constraint entries_bill_all_or_none check ((bill_id is null) = (bill_cycle is null)),
  constraint entries_bill_before_needs_link check (bill_before is null or bill_id is not null),
  constraint entries_bill_only_recurring check (bill_id is null or source = 'recurring'),
  constraint entries_bill_cycle_fmt check (bill_cycle is null or bill_cycle ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint entries_bill_before_fmt check (
    bill_before is null or (bill_before ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and bill_before < bill_cycle)
  )
);
create index entries_user_date_idx on public.entries (user_id, date);
create index entries_user_group_idx on public.entries (user_id, group_id) where group_id is not null;

create table public.lines (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id text not null,
  idx smallint not null check (idx > 0),
  account_id text not null,
  -- เดบิตบวก เครดิตลบ ห้าม 0 และต้องอยู่ในช่วงปลอดภัยของ JavaScript (R1)
  amount bigint not null check (amount <> 0 and amount between -9007199254740991 and 9007199254740991),
  primary key (user_id, entry_id, idx),
  foreign key (user_id, entry_id) references public.entries (user_id, id) on delete cascade,
  foreign key (user_id, account_id) references public.accounts (user_id, id)
);
create index lines_user_account_idx on public.lines (user_id, account_id);

create table public.bills (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  amount bigint not null check (amount > 0 and amount <= 9007199254740991),
  due_day smallint not null check (due_day between 1 and 31),
  wallet_id text,
  category_id text,
  last_paid_month text check (last_paid_month is null or last_paid_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  start_month text check (start_month is null or start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  archived boolean not null default false,
  primary key (user_id, id),
  foreign key (user_id, wallet_id) references public.accounts (user_id, id),
  foreign key (user_id, category_id) references public.accounts (user_id, id)
);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  value jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) < 16384)
);

-- ---------------------------------------------------------------------------
-- 3. R16: Entry ต้องมี ≥ 2 บรรทัด และผลรวมต่อสกุลเงิน = 0 (ตรวจตอน commit)
-- ---------------------------------------------------------------------------
create function private.assert_entry_balanced(p_user uuid, p_entry text) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_count integer;
  v_bad record;
begin
  -- Entry ถูกลบไปแล้ว (เช่น ยกเลิกการจ่าย/ลบบัญชี) ไม่ต้องตรวจ
  if not exists (select 1 from public.entries e where e.user_id = p_user and e.id = p_entry) then
    return;
  end if;
  select count(*) into v_count from public.lines l where l.user_id = p_user and l.entry_id = p_entry;
  if v_count < 2 then
    raise exception 'Entry ต้องมีอย่างน้อย 2 บรรทัด' using errcode = '23514';
  end if;
  for v_bad in
    select a.currency
      from public.lines l
      join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
     where l.user_id = p_user and l.entry_id = p_entry
     group by a.currency
    having sum(l.amount) <> 0
        or coalesce(sum(l.amount) filter (where l.amount > 0), 0) > 9007199254740991
  loop
    raise exception 'Entry ไม่สมดุลหรือยอดเกินช่วงปลอดภัยในสกุลเงิน %', v_bad.currency using errcode = '23514';
  end loop;
end
$$;

create function private.check_entry_balance() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_table_name = 'entries' then
    perform private.assert_entry_balanced(new.user_id, new.id);
  elsif tg_op = 'DELETE' then
    perform private.assert_entry_balanced(old.user_id, old.entry_id);
  else
    perform private.assert_entry_balanced(new.user_id, new.entry_id);
    if tg_op = 'UPDATE' and old.entry_id <> new.entry_id then
      perform private.assert_entry_balanced(old.user_id, old.entry_id);
    end if;
  end if;
  return null;
end
$$;

create constraint trigger lines_balance_check
after insert or update or delete on public.lines
deferrable initially deferred
for each row execute function private.check_entry_balance();

create constraint trigger entries_balance_check
after insert on public.entries
deferrable initially deferred
for each row execute function private.check_entry_balance();

-- ---------------------------------------------------------------------------
-- 4. R15/R16 ที่ตาราง: ไม่ว่าเขียนผ่าน RPC หรือ REST ตรง กฎเดียวกันมีผล
-- ---------------------------------------------------------------------------
-- รายการ system (ยอดยกมา) แก้/ลบไม่ได้ · recurring (จ่ายบิล) แก้ไม่ได้ · ลบรายการจ่ายบิล = คืน lastPaidMonth ในธุรกรรมเดียว
-- ตัวแปร app.deleting_account ตั้งโดย delete_my_account เท่านั้น (ไว้ให้ cascade ลบผู้ใช้ผ่านได้)
create function private.entries_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_found boolean;
begin
  if coalesce(current_setting('app.deleting_account', true), '') = 'on' then
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
  -- DELETE
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

create trigger entries_guard_trg
before update or delete on public.entries
for each row execute function private.entries_guard();

-- จ่ายบิล: Entry ที่ผูกบิลต้องตรงกับสถานะบิลปัจจุบัน และตั้ง lastPaidMonth ให้ในธุรกรรมเดียวกัน
create function private.entries_bill_link() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_paid text;
  v_found boolean;
begin
  if new.bill_id is null then
    return null;
  end if;
  select b.last_paid_month, true into v_paid, v_found
    from public.bills b where b.user_id = new.user_id and b.id = new.bill_id for update;
  if not coalesce(v_found, false) then
    raise exception 'ไม่พบบิลที่ผูก' using errcode = '23503';
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

create trigger entries_bill_link_trg
after insert on public.entries
for each row execute function private.entries_bill_link();

-- บรรทัดของ system/recurring แก้/ลบไม่ได้ (Entry แม่ถูกลบไปแล้วจาก cascade = ผ่าน)
create function private.lines_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_source text;
begin
  if coalesce(current_setting('app.deleting_account', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  select e.source into v_source from public.entries e where e.user_id = old.user_id and e.id = old.entry_id;
  if v_source in ('system', 'recurring') then
    raise exception 'บรรทัดของรายการประเภท % แก้ไขไม่ได้', v_source using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger lines_guard_trg
before update or delete on public.lines
for each row execute function private.lines_guard();

-- R15: lastPaidMonth ต้องไม่เกินเดือนปัจจุบัน ในทุกเส้นทางที่เขียนค่านี้
create function private.bills_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.last_paid_month is not null and new.last_paid_month > private.current_month() then
    raise exception 'lastPaidMonth เกินเดือนปัจจุบัน' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger bills_guard_trg
before insert or update on public.bills
for each row execute function private.bills_guard();

-- เปลี่ยนชนิด/สกุลเงินของบัญชีที่มีรายการแล้วไม่ได้ (จะทำให้ผลรวมต่อสกุลเงินเพี้ยน)
create function private.accounts_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.type <> old.type or new.currency <> old.currency)
     and exists (select 1 from public.lines l where l.user_id = old.user_id and l.account_id = old.id) then
    raise exception 'เปลี่ยนชนิดหรือสกุลเงินของบัญชีที่มีรายการแล้วไม่ได้' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger accounts_guard_trg
before update on public.accounts
for each row execute function private.accounts_guard();

-- ---------------------------------------------------------------------------
-- 5. RLS: เจ้าของแถวเท่านั้น + ต้องเปลี่ยนรหัสแล้ว (restrictive) · anon ไม่มีสิทธิ์ใดๆ
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles
  as permissive for select to authenticated
  using (user_id = (select auth.uid()));

do $$
declare
  t text;
begin
  foreach t in array array['accounts', 'entries', 'lines', 'bills', 'settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I as permissive for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select private.can_use_data())) with check ((select private.can_use_data()))',
      t || '_gate', t);
  end loop;
end
$$;

-- สิทธิ์ระดับตาราง (RLS ไม่คุม TRUNCATE จึงถอนสิทธิ์ทั้งหมดก่อนแล้วให้เฉพาะที่จำเป็น)
revoke all on public.profiles, public.accounts, public.entries, public.lines, public.bills, public.settings
  from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete
  on public.accounts, public.entries, public.lines, public.bills, public.settings to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC (SECURITY INVOKER: RLS และ trigger มีผลเต็ม) รับ jsonb รูปแบบเดียวกับ Entry ฝั่งเว็บ
--    { id, date, memo, source, groupId, createdAt, bill:{id,cycle,before}, lines:[{accountId,amount}] }
-- ---------------------------------------------------------------------------
create function private.insert_lines(p_user uuid, p_entry text, p_lines jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_line jsonb;
  v_idx integer := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'lines ต้องเป็นอาร์เรย์' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_line->'amount') is distinct from 'number' or jsonb_typeof(v_line->'accountId') is distinct from 'string' then
      raise exception 'บรรทัดที่ % รูปแบบไม่ถูกต้อง', v_idx using errcode = '22023';
    end if;
    insert into public.lines (user_id, entry_id, idx, account_id, amount)
    values (p_user, p_entry, v_idx, v_line->>'accountId', (v_line->>'amount')::bigint);
  end loop;
end
$$;

create function private.insert_entry(p_entry jsonb) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id text := p_entry->>'id';
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
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
  perform private.insert_lines(v_user, v_id, p_entry->'lines');
  return v_id;
end
$$;

create function public.create_entry(p_entry jsonb) returns text
language sql security invoker set search_path = ''
as $$ select private.insert_entry(p_entry) $$;

-- แก้ไขรายการ: วันที่ memo groupId และบรรทัด (ไม่เปลี่ยน source / การผูกบิล) · system/recurring แก้ไม่ได้
create function public.update_entry(p_entry jsonb) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id text := p_entry->>'id';
  v_source text;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if jsonb_typeof(p_entry) is distinct from 'object' or v_id is null then
    raise exception 'รูปแบบรายการไม่ถูกต้อง' using errcode = '22023';
  end if;
  if (p_entry->>'date') is null or (p_entry->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'วันที่ต้องเป็น YYYY-MM-DD' using errcode = '22007';
  end if;
  select e.source into v_source from public.entries e where e.user_id = v_user and e.id = v_id for update;
  if not found then
    raise exception 'ไม่พบรายการ' using errcode = 'P0002';
  end if;
  if v_source in ('system', 'recurring') then
    raise exception 'รายการประเภท % แก้ไขไม่ได้', v_source using errcode = '42501';
  end if;
  update public.entries
     set date = (p_entry->>'date')::date, memo = coalesce(p_entry->>'memo', ''), group_id = p_entry->>'groupId'
   where user_id = v_user and id = v_id;
  delete from public.lines where user_id = v_user and entry_id = v_id;
  perform private.insert_lines(v_user, v_id, p_entry->'lines');
end
$$;

-- ตั้งค่าเริ่มต้น / นำเข้า: ทำได้เมื่อผู้ใช้ยังไม่มีบัญชีและรายการเลย (ธุรกรรมเดียว ผิดที่ใดที่หนึ่ง = ไม่เขียนอะไรเลย)
create function public.setup_ledger(p_accounts jsonb, p_entries jsonb) returns jsonb
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
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    perform private.insert_entry(v_entry);
    v_entries := v_entries + 1;
  end loop;
  return jsonb_build_object('accounts', v_accounts, 'entries', v_entries);
end
$$;

-- ยินยอม PDPA: ตั้งเวลาฝั่งเซิร์ฟเวอร์ (ไม่รับเวลาจากเว็บ) ครั้งแรกเท่านั้น
create function public.record_consent() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  update public.profiles set consented_at = coalesce(consented_at, now()) where user_id = v_user;
end
$$;

-- ลบบัญชีตัวเองและข้อมูลทั้งหมด: ต้องเปลี่ยนรหัสแล้ว และยืนยันรหัสผ่านปัจจุบันฝั่งเซิร์ฟเวอร์
create function public.delete_my_account(p_password text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  select u.encrypted_password into v_hash from auth.users u where u.id = v_user;
  if v_hash is null or p_password is null or extensions.crypt(p_password, v_hash) <> v_hash then
    raise exception 'รหัสผ่านไม่ถูกต้อง' using errcode = '28P01';
  end if;
  perform set_config('app.deleting_account', 'on', true);
  delete from auth.users where id = v_user;
end
$$;

-- สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ที่ล็อกอิน (ไม่ใช่ anon / public)
revoke all on function
  private.current_month(), private.can_use_data(), private.insert_lines(uuid, text, jsonb), private.insert_entry(jsonb),
  public.create_entry(jsonb), public.update_entry(jsonb), public.setup_ledger(jsonb, jsonb),
  public.record_consent(), public.delete_my_account(text)
  from public, anon, authenticated;
grant execute on function
  private.current_month(), private.can_use_data(), private.insert_lines(uuid, text, jsonb), private.insert_entry(jsonb),
  public.create_entry(jsonb), public.update_entry(jsonb), public.setup_ledger(jsonb, jsonb),
  public.record_consent(), public.delete_my_account(text)
  to authenticated;
-- ฟังก์ชัน trigger ไม่ต้องให้ใครเรียกตรง
revoke all on function
  private.handle_new_user(), private.handle_password_change(), private.assert_entry_balanced(uuid, text),
  private.check_entry_balance(), private.entries_guard(), private.entries_bill_link(), private.lines_guard(),
  private.bills_guard(), private.accounts_guard()
  from public, anon, authenticated;
-- ฟังก์ชันที่ trigger ฝั่ง INVOKER เรียกภายใน ต้องให้ authenticated เรียกได้
grant execute on function private.assert_entry_balanced(uuid, text) to authenticated;
