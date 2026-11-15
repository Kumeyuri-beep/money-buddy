-- เนื้อหาในไฟล์นี้ (เรียงตามลำดับ): (1) import_ledger_investments รองรับ USD (2) revoke สิทธิ์ trigger function ของ A2 (3) trades_fx_guard ตรวจต้นทุนบาทต่อรายการ ตาม R20.3 ถ้อยคำใหม่ (4) accounts_guard + set_account_kind: เปลี่ยนป้าย kind แม้มีรายการ ตาม R23
-- ทุกข้อเป็น create or replace function / create function / revoke / grant เท่านั้น (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ · ไม่แตะตาราง นโยบาย RLS หรือนิยาม trigger)
-- A3-1: นำเข้าไฟล์สำรองที่มีข้อมูล USD (assets สกุล/ticker/exchange · trades fx_rate_micro · fx_rates · fx_exchanges) + revoke สิทธิ์ trigger function ของ A2
-- migration แบบ "เพิ่ม" เท่านั้น: create or replace function (import_ledger_investments) + revoke (ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ · ไม่แตะตาราง/นโยบาย RLS/trigger)
--
-- import_ledger_investments ฉบับใหม่ = ฉบับ 20261111000300 ทุกบรรทัด + ส่วน USD:
--   * assets: instrumentCurrency ('currency' ในไฟล์ ไม่ใส่ = THB), ticker, exchange
--   * trades: fxRateMicro
--   * fxRates[] {accountId,date,rateMicro} · fxExchanges[] {id,date,createdAt,direction,thbSatang,usdCents,rateMicro,memo,entryId}
--   * ผลที่คืน: {assets, prices, trades} เหมือนเดิมทุกประการเมื่อไม่มีข้อมูล USD · เพิ่มคีย์ fxRates/fxExchanges เฉพาะเมื่อไฟล์มีแถวเหล่านั้น (เทสต์เดิมไม่เปลี่ยน)
--   * ไม่ทับข้อมูลเดิม: มีสินทรัพย์/อัตรา/การแลกเงินอยู่แล้ว = ปฏิเสธ
--   * ด่านของตารางยังทำงานเต็ม (สกุลบัญชี/สินทรัพย์ตรงกัน, อัตราแลกเงินตรงกับสองจำนวน, FK ไป Entry ของผู้ใช้เอง) · ข้ามเฉพาะด่านลำดับ/ขายเกิน/ผูกสมุดผ่าน app.invest_import ตามเดิม (เว็บตรวจก่อนส่ง)

create or replace function public.import_ledger_investments(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_assets integer;
  v_prices integer;
  v_trades integer;
  v_fx_rates integer := 0;
  v_fx_exchanges integer := 0;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(coalesce(p_data->'assets', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'prices', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'trades', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'fxRates', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_data->'fxExchanges', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(coalesce(p_data->'assets', '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_data->'prices', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'trades', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'fxRates', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'fxExchanges', '[]'::jsonb)) > 10000 then
    raise exception 'ข้อมูลลงทุนมากเกินเพดาน (สินทรัพย์ไม่เกิน 200 · รายการ ราคา อัตรา และการแลกเงินอย่างละไม่เกิน 10,000)' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(
         coalesce(p_data->'assets', '[]'::jsonb) || coalesce(p_data->'prices', '[]'::jsonb) || coalesce(p_data->'trades', '[]'::jsonb)
         || coalesce(p_data->'fxRates', '[]'::jsonb) || coalesce(p_data->'fxExchanges', '[]'::jsonb)) x
        where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง (แต่ละแถวต้องเป็นวัตถุ)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ นำเข้าข้อมูลลงทุนไม่ได้' using errcode = '55000';
  end if;
  if exists (select 1 from public.assets where user_id = v_user)
     or exists (select 1 from public.fx_rates where user_id = v_user)
     or exists (select 1 from public.fx_exchanges where user_id = v_user) then
    raise exception 'มีข้อมูลลงทุนอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  insert into public.assets (user_id, id, name, kind, account_id, archived, instrument_currency, ticker, exchange)
  select v_user, e->>'id', e->>'name', coalesce(e->>'kind', 'fund'), e->>'accountId', coalesce((e->>'archived')::boolean, false),
         coalesce(e->>'currency', 'THB'), e->>'ticker', e->>'exchange'
    from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb)) e;
  get diagnostics v_assets = row_count;

  insert into public.asset_prices (user_id, asset_id, date, price_micro)
  select v_user, e->>'assetId', (e->>'date')::date, (e->>'priceMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'prices', '[]'::jsonb)) e;
  get diagnostics v_prices = row_count;

  -- นำเข้า: ข้ามด่านลำดับ/ขายเกิน/ผูกสมุดของ trades_insert_guard และด่านเพิ่มแถวของ fx_exchanges เฉพาะในธุรกรรมนี้ (เว็บตรวจก่อนส่ง · ลำดับแถวในคำสั่งเดียวไม่แน่นอน)
  perform set_config('app.invest_import', 'on', true);
  insert into public.trades (user_id, id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id, fx_rate_micro)
  select v_user, e->>'id', e->>'assetId', e->>'kind', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()),
         e->>'units', (e->>'priceMicro')::bigint, (e->>'amount')::bigint,
         coalesce((e->>'fee')::bigint, 0), coalesce((e->>'withholding')::bigint, 0), coalesce(e->>'memo', ''), e->>'entryId',
         (e->>'fxRateMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'trades', '[]'::jsonb)) e;
  get diagnostics v_trades = row_count;

  insert into public.fx_rates (user_id, account_id, date, rate_micro)
  select v_user, e->>'accountId', (e->>'date')::date, (e->>'rateMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'fxRates', '[]'::jsonb)) e;
  get diagnostics v_fx_rates = row_count;

  insert into public.fx_exchanges (user_id, id, date, created_at, direction, thb_satang, usd_cents, rate_micro, memo, entry_id)
  select v_user, e->>'id', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()), e->>'direction',
         (e->>'thbSatang')::bigint, (e->>'usdCents')::bigint, (e->>'rateMicro')::bigint, coalesce(e->>'memo', ''), e->>'entryId'
    from jsonb_array_elements(coalesce(p_data->'fxExchanges', '[]'::jsonb)) e;
  get diagnostics v_fx_exchanges = row_count;
  perform set_config('app.invest_import', '', true);

  v_out := jsonb_build_object('assets', v_assets, 'prices', v_prices, 'trades', v_trades);
  if v_fx_rates > 0 then v_out := v_out || jsonb_build_object('fxRates', v_fx_rates); end if;
  if v_fx_exchanges > 0 then v_out := v_out || jsonb_build_object('fxExchanges', v_fx_exchanges); end if;
  return v_out;
end
$$;

revoke all on function public.import_ledger_investments(jsonb) from public, anon, authenticated;
grant execute on function public.import_ledger_investments(jsonb) to authenticated;

-- ผลตรวจ security-auditor (A2 ข้อ 5): trigger function ใหม่ของ A2 ใน schema private ไม่ได้ revoke จาก PUBLIC (ไม่มีผลจริงเพราะเรียกตรงไม่ได้ แต่ให้ตรงแบบแผนเดิม)
-- trigger ยังทำงานตามปกติ: สิทธิ์ execute ของ trigger function ถูกตรวจตอนสร้าง trigger เท่านั้น ไม่ใช่ตอนทำงาน
revoke all on function private.assets_currency_guard() from public, anon, authenticated;
revoke all on function private.trades_fx_guard() from public, anon, authenticated;
revoke all on function private.fx_rates_guard() from public, anon, authenticated;
revoke all on function private.fx_exchanges_insert_guard() from public, anon, authenticated;
revoke all on function private.fx_exchanges_update_guard() from public, anon, authenticated;
revoke all on function private.fx_exchanges_delete_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- R20.3 (ถ้อยคำใหม่ 15 พ.ย. 2569): ปฏิเสธซื้อ USD ที่ต้นทุนบาทของรายการนั้น roundHalfUp((A+F) x fx / 10^6) ปัดเป็น 0 สตางค์
-- เทียบเท่า (A+F) x fx < 500,000 · ใส่ที่ trigger เดิม trades_fx_guard (create or replace ฟังก์ชัน · ส่วนอื่นเหมือน 20261115000100 ทุกบรรทัด)
-- ก่อนหน้านี้ฐานข้อมูลไม่ตรวจข้อนี้ (ผลตรวจ money-auditor F2) เว็บตรวจก่อนส่งอย่างเดียว
-- ---------------------------------------------------------------------------
create or replace function private.trades_fx_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_cur text;
begin
  select a.instrument_currency into v_cur from public.assets a where a.user_id = new.user_id and a.id = new.asset_id;
  if v_cur is null then
    return new; -- ไม่พบสินทรัพย์: ให้ FK ของตารางรายงานข้อผิดพลาดเอง
  end if;
  if v_cur = 'USD' then
    if new.fx_rate_micro is null then
      raise exception 'รายการของสินทรัพย์สกุล USD ต้องมีอัตราแลกเปลี่ยน' using errcode = '23514';
    end if;
    if new.kind = 'reinvest' then
      raise exception 'ปันผลลงทุนต่อของสินทรัพย์สกุล USD ยังไม่รองรับ' using errcode = '23514';
    end if;
    if new.kind = 'buy' and (new.amount::numeric + new.fee::numeric) * new.fx_rate_micro::numeric < 500000 then
      raise exception 'ต้นทุนบาทของรายการซื้อปัดเป็น 0 สตางค์ (อัตราต่ำหรือจำนวนเงินน้อยเกินไป) บันทึกไม่ได้' using errcode = '23514';
    end if;
    if new.entry_id is null
       and coalesce(current_setting('app.invest_import', true), '') <> 'on'
       and current_user not in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
      raise exception 'รายการสกุล USD ต้องบันทึกผ่านหน้าพอร์ตและผูกกับสมุดบัญชี' using errcode = '23514';
    end if;
  elsif new.fx_rate_micro is not null then
    raise exception 'รายการของสินทรัพย์สกุลบาทต้องไม่มีอัตราแลกเปลี่ยน' using errcode = '23514';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- R23 (เจ้าของอนุมัติ 15 พ.ย. 2569): เปลี่ยนป้าย accounts.kind (normal <-> investment) ได้แม้มีรายการแล้ว เพราะไม่กระทบสมุดบัญชี (ไม่แตะ Entry/Line)
--   * accounts_guard: ปล่อยเฉพาะ "เปลี่ยน kind อย่างเดียว" ที่มีรายการ เมื่อมาจาก set_account_kind (ตัวแปร app.set_account_kind = รหัสบัญชี) · ที่เหลือเหมือนเดิมทุกกรณี
--     (เปลี่ยนชนิด/สกุลของบัญชีที่มีรายการ หรือเปลี่ยน kind ของบัญชีที่ผูกสินทรัพย์ ยังถูกปฏิเสธ 23514)
--   * set_account_kind(p_id, p_kind): เฉพาะบัญชีเงินสด asset สกุลบาท ที่ไม่ผูกสินทรัพย์ และไม่ใช่กระเป๋าจ่ายของบิล · บัญชี USD/ที่ผูกสินทรัพย์ต้องเป็นลงทุนเสมอ
--     security definer (ผู้ใช้ไม่มีสิทธิ์ update คอลัมน์ kind) แต่แก้เฉพาะแถวของ auth.uid() · search_path ว่าง · ต้องเปลี่ยนรหัสผ่านแล้ว
-- ---------------------------------------------------------------------------
create or replace function private.accounts_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.type <> old.type or new.currency <> old.currency or new.kind <> old.kind)
     and (exists (select 1 from public.lines l where l.user_id = old.user_id and l.account_id = old.id)
          or exists (select 1 from public.assets s where s.user_id = old.user_id and s.account_id = old.id)) then
    -- ยกเว้นเดียว: เปลี่ยน kind อย่างเดียว ผ่าน set_account_kind และบัญชีไม่ผูกสินทรัพย์ (R23)
    if new.type = old.type and new.currency = old.currency and new.kind <> old.kind
       and coalesce(current_setting('app.set_account_kind', true), '') = old.id
       and not exists (select 1 from public.assets s where s.user_id = old.user_id and s.account_id = old.id) then
      return new;
    end if;
    raise exception 'เปลี่ยนชนิด สกุลเงิน หรือประเภทบัญชีที่มีรายการหรือสินทรัพย์ผูกอยู่แล้วไม่ได้' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.set_account_kind(p_id text, p_kind text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_acc public.accounts%rowtype;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('normal', 'investment') then
    raise exception 'ข้อมูลไม่ครบหรือป้ายไม่ถูกต้อง (ต้องเป็น normal หรือ investment)' using errcode = '22023';
  end if;
  select * into v_acc from public.accounts a where a.user_id = v_user and a.id = p_id for update;
  if not found then
    raise exception 'ไม่พบบัญชีนี้' using errcode = 'P0002';
  end if;
  if v_acc.type <> 'asset' or v_acc.currency <> 'THB' then
    raise exception 'เปลี่ยนป้ายได้เฉพาะบัญชีเงินสด (ชนิดสินทรัพย์) สกุลบาท · บัญชี USD เป็นเงินลงทุนเสมอ' using errcode = '23514';
  end if;
  if exists (select 1 from public.assets s where s.user_id = v_user and s.account_id = p_id) then
    raise exception 'บัญชีที่ผูกกับสินทรัพย์ต้องเป็นเงินลงทุนเสมอ เปลี่ยนป้ายไม่ได้' using errcode = '23514';
  end if;
  if p_kind = 'investment' and exists (select 1 from public.bills b where b.user_id = v_user and b.wallet_id = p_id and not b.archived) then
    raise exception 'มีบิลที่จ่ายจากกระเป๋านี้อยู่ เปลี่ยนเป็นเงินลงทุนไม่ได้ (เปลี่ยนกระเป๋าของบิลก่อน)' using errcode = '23514';
  end if;
  if v_acc.kind = p_kind then
    return p_kind; -- ป้ายเดิมอยู่แล้ว (ทำซ้ำได้ ไม่แก้อะไร)
  end if;
  perform set_config('app.set_account_kind', p_id, true);
  update public.accounts set kind = p_kind where user_id = v_user and id = p_id;
  perform set_config('app.set_account_kind', '', true);
  return p_kind;
end
$$;

revoke all on function public.set_account_kind(text, text) from public, anon, authenticated;
grant execute on function public.set_account_kind(text, text) to authenticated;
