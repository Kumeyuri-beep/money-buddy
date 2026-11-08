-- M2-D: นำเข้าไฟล์สำรอง JSON (บัญชี รายการ บิล ค่าตั้งค่า) ขึ้นบัญชีออนไลน์ในธุรกรรมเดียว
-- - ปฏิเสธถ้าผู้ใช้มีข้อมูลอยู่แล้ว (ไม่ทับ ไม่ซ้ำซ้อน) · ผิดข้อใดข้อหนึ่ง = ย้อนกลับทั้งก้อน
-- - ตรวจ R16/R1 ด้วย trigger เดิมตอน commit · เว็บตรวจไฟล์ล่วงหน้าอีกชั้น (src/domain/backup/parseBackup.ts)
-- - รายการจ่ายบิลในไฟล์เก่า: สถานะ lastPaidMonth มาจากไฟล์โดยตรง จึงข้ามการตรวจ "ลำดับรอบ" ของ entries_bill_link เฉพาะในธุรกรรมนี้
--   (ตัวแปร app.import_ledger ตั้งโดยฟังก์ชันนี้เท่านั้น ผู้ใช้ตั้งเองผ่าน API ไม่ได้ · ใช้ได้เฉพาะตอนไม่มีข้อมูลเดิม)
-- หมายเหตุ M2-G: เมื่อล็อก bills.last_paid_month ต้องยอมให้ฟังก์ชันนี้เขียนค่าได้ (เช็ก app.import_ledger = 'on')

create function public.import_ledger(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_accounts integer := 0;
  v_bills integer := 0;
  v_entries integer := 0;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'accounts') is distinct from 'array'
     or jsonb_typeof(p_data->'entries') is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'bills', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'settings', '{}'::jsonb)) is distinct from 'object' then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(p_data->'accounts') > 2000
     or jsonb_array_length(p_data->'entries') > 20000
     or jsonb_array_length(coalesce(p_data->'bills', '[]'::jsonb)) > 2000 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน' using errcode = '22023';
  end if;

  -- กันกดนำเข้าซ้ำพร้อมกัน แล้วตรวจว่ายังไม่มีข้อมูล
  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if exists (select 1 from public.accounts where user_id = v_user)
     or exists (select 1 from public.entries where user_id = v_user)
     or exists (select 1 from public.bills where user_id = v_user)
     or exists (select 1 from public.settings where user_id = v_user) then
    raise exception 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  for v_item in select * from jsonb_array_elements(p_data->'accounts') loop
    insert into public.accounts (user_id, id, type, name, currency, archived, sort_order)
    values (
      v_user, v_item->>'id', v_item->>'type', v_item->>'name', v_item->>'currency',
      coalesce((v_item->>'archived')::boolean, false), (v_item->>'sortOrder')::integer
    );
    v_accounts := v_accounts + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_data->'bills', '[]'::jsonb)) loop
    insert into public.bills (user_id, id, name, amount, due_day, wallet_id, category_id, last_paid_month, start_month, archived)
    values (
      v_user, v_item->>'id', v_item->>'name', (v_item->>'amount')::bigint, (v_item->>'dueDay')::smallint,
      v_item->>'walletId', v_item->>'categoryId', v_item->>'lastPaidMonth', v_item->>'startMonth',
      coalesce((v_item->>'archived')::boolean, false)
    );
    v_bills := v_bills + 1;
  end loop;

  perform set_config('app.setup_ledger', 'on', true);
  perform set_config('app.import_ledger', 'on', true);
  for v_item in select * from jsonb_array_elements(p_data->'entries') loop
    perform private.insert_entry(v_item);
    v_entries := v_entries + 1;
  end loop;
  perform set_config('app.setup_ledger', '', true);
  perform set_config('app.import_ledger', '', true);

  if p_data->'settings' is not null and p_data->'settings' <> '{}'::jsonb then
    insert into public.settings (user_id, value) values (v_user, p_data->'settings');
  end if;

  return jsonb_build_object('accounts', v_accounts, 'bills', v_bills, 'entries', v_entries);
end
$$;

revoke all on function public.import_ledger(jsonb) from public, anon, authenticated;
grant execute on function public.import_ledger(jsonb) to authenticated;

-- entries_bill_link: ข้ามการตรวจลำดับรอบเฉพาะในธุรกรรมนำเข้า (สถานะบิลมาจากไฟล์) · เส้นทางปกติตรวจเหมือนเดิมทุกข้อ
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
  if coalesce(current_setting('app.import_ledger', true), '') = 'on' then
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
