-- Invest v2 รอบที่ 2 · แก้ไขรายการที่บันทึกแล้ว (replace_trade) + ลบสินทรัพย์ (delete_asset)
-- ที่มา docs/proposals/R2-replace-trade-delete-asset.md (เจ้าของอนุมัติ 21 พ.ย. 2569)
-- **migration แบบ "เพิ่ม" เท่านั้น:** create function สองตัว + grant (ไม่ drop / delete ข้อมูลเดิม / เปลี่ยนชนิดคอลัมน์ / เปลี่ยนนโยบาย RLS)
-- ทั้งสองเป็น security invoker (RLS และด่านเปลี่ยนรหัสบังคับใช้) · ไม่มี service_role

-- ---------------------------------------------------------------------------
-- 1. replace_trade: กลับรายการเดิม (ลบ Entry ที่ผูก) + ลงรายการใหม่ด้วย record_trade / record_trade_fx ในธุรกรรมเดียว
--    กฎ "แก้ได้" เหมือน trade_delete_problem (R17): ซื้อ/ปันผลลงทุนต่อ = ไม่มีรายการขายที่วันที่ ≥ วันของรายการนี้ · ขาย = เป็นรายการขายล่าสุดเท่านั้น · ปันผลเงินสด = เสมอ
--    วันที่ไม่เปลี่ยน → คง created_at เดิม (ลำดับในวันเดียวกันเดิม) · ล้มข้อใด = ย้อนกลับทั้งก้อน (รวมการลบ Entry เดิม)
-- ---------------------------------------------------------------------------
create function public.replace_trade(p_old_id text, p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb, p_based_on integer default null)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_asset text;
  v_old public.trades%rowtype;
  v_cur text;
  v_last_sell date;
  v_count integer;
  v_n integer;
  v_trade jsonb := p_trade;
  v_new jsonb;
begin
  if v_user is null then raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000'; end if;
  if not private.can_use_data() then raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501'; end if;
  if private.import_session_exists() then raise exception 'กำลังนำเข้าข้อมูล ทำรายการนี้ไม่ได้ในตอนนี้' using errcode = '55000'; end if;
  if p_old_id is null or jsonb_typeof(p_trade) is distinct from 'object' or jsonb_typeof(p_entry) is distinct from 'object'
     or jsonb_typeof(coalesce(p_accounts, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_trade) > 16384 or pg_column_size(p_entry) > 65536 or pg_column_size(coalesce(p_accounts, '[]'::jsonb)) > 16384 then
    raise exception 'ข้อมูลมากเกินกำหนด' using errcode = '22023';
  end if;

  -- 1) รู้สินทรัพย์ก่อน (อ่านธรรมดา) 2) ล็อกสินทรัพย์ (ลำดับเดียวกับ record_trade/record_trade_fx) 3) อ่านรายการเดิมซ้ำแบบล็อกแถว
  --    กันแท็บสองแท็บแก้รายการเดียวกัน: แท็บที่รอล็อกจะเห็นผลของแท็บแรก (ไม่พบรายการเดิม) ไม่ใช่ข้อมูลเก่า
  select t.asset_id into v_asset from public.trades t where t.user_id = v_user and t.id = p_old_id;
  if v_asset is null then raise exception 'ไม่พบรายการที่จะแก้' using errcode = '23503'; end if;
  select a.instrument_currency into v_cur from public.assets a where a.user_id = v_user and a.id = v_asset for update;
  select * into v_old from public.trades t where t.user_id = v_user and t.id = p_old_id for update;
  if not found then raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001'; end if;

  if v_old.entry_id is null then raise exception 'แก้รายการที่ไม่ผูกกับสมุดบัญชีไม่ได้ (ลบแล้วบันทึกใหม่)' using errcode = '23514'; end if;
  if (v_trade->>'assetId') is distinct from v_old.asset_id then raise exception 'ย้ายรายการไปสินทรัพย์อื่นไม่ได้' using errcode = '23514'; end if;
  if (v_trade->>'kind') is distinct from v_old.kind then raise exception 'เปลี่ยนชนิดรายการไม่ได้ (ลบแล้วบันทึกใหม่)' using errcode = '23514'; end if;

  -- basedOn: จำนวนรายการของสินทรัพย์นี้ตอนผู้ใช้เปิดฟอร์มแก้ ตรวจก่อนลบ (จับการเพิ่ม/ลบรายการอื่นระหว่างแก้)
  if p_based_on is not null then
    select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = v_old.asset_id;
    if v_count <> p_based_on then raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001'; end if;
  end if;
  -- ช่องทางตรวจ basedOn มีช่องเดียวคือ p_based_on (ถ้า basedOn อยู่ใน p_trade ปฏิเสธ ไม่ตัดทิ้งเงียบๆ)
  if v_trade ? 'basedOn' then raise exception 'ส่ง basedOn ผ่านพารามิเตอร์ p_based_on เท่านั้น' using errcode = '22023'; end if;

  -- กฎ "แก้ได้" (R17 · เหมือน trade_delete_problem)
  select max(t.date) into v_last_sell from public.trades t
   where t.user_id = v_user and t.asset_id = v_old.asset_id and t.kind = 'sell';
  if v_old.kind in ('buy', 'reinvest') and v_last_sell is not null and v_old.date <= v_last_sell then
    raise exception 'แก้รายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (%) ไม่ได้ ให้ลบรายการขายหลังจากนั้นก่อน', v_last_sell using errcode = '23514';
  end if;
  if v_old.kind = 'sell' and exists (
       select 1 from public.trades t
        where t.user_id = v_user and t.asset_id = v_old.asset_id and t.kind = 'sell' and t.id <> v_old.id
          and (t.date, t.created_at, t.id) > (v_old.date, v_old.created_at, v_old.id)) then
    raise exception 'แก้ได้เฉพาะรายการขายล่าสุด' using errcode = '23514';
  end if;

  -- วันที่ไม่เปลี่ยน → คงลำดับเดิมในวันนั้น
  if (v_trade->>'date')::date = v_old.date then
    v_trade := jsonb_set(v_trade, '{createdAt}', to_jsonb(v_old.created_at));
  end if;

  -- กลับรายการเดิม: ลบ Entry ที่ผูก (ฐานข้อมูลลบรายการลงทุนที่ผูกตาม · ผ่าน entries_trade_guard) แล้วตรวจว่าลบได้จริง 1 แถว
  delete from public.entries e where e.user_id = v_user and e.id = v_old.entry_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001'; end if;

  -- ลงรายการใหม่ด้วยฟังก์ชันเดิม (ตรวจ R16/R17/R20 ครบ · ล้มข้อใด = ทั้งฟังก์ชันย้อนกลับ รวมการลบข้างบน)
  if v_cur = 'USD' then
    v_new := public.record_trade_fx(v_trade, p_entry, p_accounts);
  else
    v_new := public.record_trade(v_trade, p_entry, p_accounts);
  end if;
  return v_new || jsonb_build_object('replacedTradeId', p_old_id, 'replacedEntryId', v_old.entry_id);
end $$;
revoke all on function public.replace_trade(text, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.replace_trade(text, jsonb, jsonb, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. delete_asset: ลบสินทรัพย์ที่ไม่เหลือรายการเลย + บัญชีต้นทุนของมัน (ไม่ให้หน้า Cash ตีความเป็นบัญชีเงินสด) ในธุรกรรมเดียว
-- ---------------------------------------------------------------------------
create function public.delete_asset(p_asset_id text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_acc text; v_n integer;
begin
  if v_user is null then raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000'; end if;
  if not private.can_use_data() then raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501'; end if;
  if private.import_session_exists() then raise exception 'กำลังนำเข้าข้อมูล ทำรายการนี้ไม่ได้ในตอนนี้' using errcode = '55000'; end if;
  if p_asset_id is null then raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023'; end if;
  select a.account_id into v_acc from public.assets a where a.user_id = v_user and a.id = p_asset_id for update;
  if not found then raise exception 'ไม่พบสินทรัพย์' using errcode = '23503'; end if;
  if exists (select 1 from public.trades t where t.user_id = v_user and t.asset_id = p_asset_id) then
    raise exception 'สินทรัพย์นี้ยังมีรายการซื้อขายหรือปันผล ลบรายการทั้งหมดก่อน' using errcode = '23514';
  end if;
  if exists (select 1 from public.fx_rates r where r.user_id = v_user and r.account_id = v_acc) then
    raise exception 'มีอัตราแลกเปลี่ยนผูกกับบัญชีต้นทุนของสินทรัพย์นี้ (ข้อมูลผิดปกติ) ลบไม่ได้' using errcode = '23514';
  end if;
  if exists (select 1 from public.lines l where l.user_id = v_user and l.account_id = v_acc) then
    raise exception 'บัญชีต้นทุนของสินทรัพย์นี้ยังมีรายการในสมุดบัญชี' using errcode = '23514';
  end if;
  delete from public.assets where user_id = v_user and id = p_asset_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ลบสินทรัพย์ไม่สำเร็จ' using errcode = '55000'; end if;
  delete from public.accounts where user_id = v_user and id = v_acc;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ลบบัญชีต้นทุนของสินทรัพย์ไม่สำเร็จ' using errcode = '55000'; end if;
  return jsonb_build_object('assetId', p_asset_id, 'accountId', v_acc);
end $$;
revoke all on function public.delete_asset(text) from public, anon, authenticated;
grant execute on function public.delete_asset(text) to authenticated;
