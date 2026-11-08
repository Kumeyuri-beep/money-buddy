-- M2-D1 (ตามผล money-auditor / security-auditor):
-- 1) เพดานนำเข้า: วัดจริงบนโปรเจกต์ 2,000 รายการ = 5.2 วินาที (เพดานเวลาของ role authenticated ~8 วินาที) จึงตั้ง 1,500 รายการ
--    + จำกัดบรรทัดต่อรายการ (200) และบรรทัดรวม (20,000) + ขนาดข้อมูล (20 MB) กันรายการเดียวที่มีบรรทัดมหาศาลเลี่ยงเพดาน
--    (ไฟล์ใหญ่กว่านี้ต้องนำเข้าแบบแบ่งชุด: backlog)
-- 2) entries_bill_link ตอนนำเข้า: ยังปฏิเสธรอบบิลเกินเดือนปัจจุบัน (R15) ข้ามเฉพาะการเทียบ before/ลำดับรอบกับ lastPaidMonth
--    และการตรวจบิลที่เก็บถาวร (ข้อมูลจริงอาจเก็บถาวรบิลหลังจ่ายแล้ว) · รายการที่ผูกกับบิลที่ถูกลบไปแล้วนำเข้าได้ (ยกเลิกจากสมุดบัญชีได้)
-- ข้อควรระวังสำหรับ migration อนาคต: ห้ามให้ฟังก์ชันใน schema public ตั้ง app.* ตามค่าที่ผู้ใช้ส่งมา หรือรัน EXECUTE จากข้อความของผู้ใช้
--   (ความปลอดภัยของ app.setup_ledger / app.import_ledger พึ่งข้อนี้) และ schema private ต้องไม่อยู่ใน Exposed schemas ของ Dashboard

create or replace function public.import_ledger(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_item jsonb;
  v_accounts integer := 0;
  v_bills integer := 0;
  v_entries integer := 0;
  v_lines integer;
  v_max_lines integer;
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
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(p_data->'accounts') > 2000
     or jsonb_array_length(p_data->'entries') > 1500
     or jsonb_array_length(coalesce(p_data->'bills', '[]'::jsonb)) > 2000 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (รายการไม่เกิน 1,500)' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_data->'entries') e where jsonb_typeof(e->'lines') is distinct from 'array') then
    raise exception 'รูปแบบข้อมูลนำเข้าไม่ถูกต้อง (lines)' using errcode = '22023';
  end if;
  select coalesce(sum(jsonb_array_length(e->'lines')), 0), coalesce(max(jsonb_array_length(e->'lines')), 0)
    into v_lines, v_max_lines
    from jsonb_array_elements(p_data->'entries') e;
  if v_lines > 20000 or v_max_lines > 200 then
    raise exception 'ข้อมูลนำเข้ามากเกินเพดาน (บรรทัดต่อรายการไม่เกิน 200 รวมไม่เกิน 20,000)' using errcode = '22023';
  end if;

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
    if new.bill_cycle > private.current_month() then
      raise exception 'จ่ายล่วงหน้าเกินเดือนปัจจุบันไม่ได้' using errcode = '23514';
    end if;
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
