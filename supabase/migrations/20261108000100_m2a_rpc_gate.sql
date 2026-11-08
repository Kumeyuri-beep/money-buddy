-- M2-A (แก้จากผลเทสต์ T2): RPC เขียนข้อมูลต้องปฏิเสธผู้ที่ยังไม่เปลี่ยนรหัสตั้งแต่ต้นฟังก์ชัน
-- (เดิมพึ่ง RLS อย่างเดียว: ส่งอาร์เรย์ว่างเข้า setup_ledger จึงไม่ error แม้ไม่ได้เขียนอะไร)
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
  perform private.insert_lines(v_user, v_id, p_entry->'lines');
  return v_id;
end
$$;

create or replace function public.update_entry(p_entry jsonb) returns void
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
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
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
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    perform private.insert_entry(v_entry);
    v_entries := v_entries + 1;
  end loop;
  return jsonb_build_object('accounts', v_accounts, 'entries', v_entries);
end
$$;
