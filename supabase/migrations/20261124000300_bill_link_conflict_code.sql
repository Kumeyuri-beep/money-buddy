-- private.entries_bill_link: รหัส error "สถานะบิลเปลี่ยนไปแล้ว (lastPaidMonth ไม่ตรง)" จาก 40001 เป็น PT409 (PostgREST ตอบ HTTP 409)
-- เหตุผล: 40001 ที่ raise เองใน RPC ถูก PostgREST ถือว่า "ลองใหม่ได้" แล้วลองซ้ำอัตโนมัติจนค้างราว 60 วินาที (Supabase KB "SQLSTATE 40001 in an RPC function causes infinite retries")
-- เคยแก้กับ merge_settings_if (20261113000400) และ record_trade/record_trade_fx/replace_trade (20261124000200) · แก้เฉพาะรหัส ตรรกะเหมือนฟังก์ชันที่ใช้อยู่ในฐานข้อมูลทุกบรรทัด
-- create or replace ฟังก์ชัน trigger เดิม (ตัว trigger entries_bill_link_trg ไม่เปลี่ยน) · ไม่มี drop/delete/GRANT/REVOKE
create or replace function private.entries_bill_link() returns trigger
language plpgsql
set search_path = ''
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
    raise exception 'สถานะบิลเปลี่ยนไปแล้ว (lastPaidMonth ไม่ตรง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = 'PT409';
  end if;
  if new.bill_cycle <= coalesce(v_paid, '') then
    raise exception 'รอบนี้จ่ายแล้ว' using errcode = '23514';
  end if;
  if new.bill_cycle > private.current_month() then
    raise exception 'จ่ายล่วงหน้าเกินเดือนปัจจุบันไม่ได้' using errcode = '23514';
  end if;
  perform set_config('app.bill_paid_path', 'on', true);
  update public.bills set last_paid_month = new.bill_cycle where user_id = new.user_id and id = new.bill_id;
  perform set_config('app.bill_paid_path', '', true);
  return null;
end
$$;
