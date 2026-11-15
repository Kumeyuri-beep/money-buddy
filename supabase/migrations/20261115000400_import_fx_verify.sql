-- A3-1b: เสริมความปลอดภัยตามผลตรวจ security-auditor ของ A3-1 (กลาง ก1 + ต่ำ ต1)
--   ก1: import_ledger_investments ตรวจรายการแลกเงินกับบรรทัดของ Entry ที่ผูกฝั่งเซิร์ฟเวอร์ (เดิมพึ่งเว็บตรวจก่อนส่ง) · ผิด = ปฏิเสธทั้งก้อน 23514
--   ต1: set_account_kind ปฏิเสธเมื่อมีการนำเข้าสมุดค้างอยู่ (55000) เพราะเป็น security definer ข้ามนโยบายล็อกระหว่างนำเข้า
-- ทั้งสองข้อเป็น create or replace function เท่านั้น (ไม่มี drop/delete/truncate/GRANT/REVOKE/เปลี่ยนนโยบาย RLS หรือ trigger · สิทธิ์ execute เดิมคงอยู่ตามธรรมชาติของ create or replace)
-- ส่วนที่เหลือจากผลตรวจ: ต2 (แข่งกันสร้างบิลกับเปลี่ยนป้าย) รับความเสี่ยงไว้ ดู docs/decisions/2026-11-15-a3-1b-accepted-risks.md · ต3 เป็นเทสต์เพิ่ม (supabase/tests/import_fx_verify_test.sql)

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

  -- A3-1b (ผลตรวจ security-auditor A3-1 ก1): รายการแลกเงินที่นำเข้าต้องตรงกับบรรทัดของ Entry ที่ผูกฝั่งเซิร์ฟเวอร์ด้วย (เดิมเชื่อเว็บอย่างเดียว)
  --   Entry ต้องวันที่ตรง มี 4 บรรทัดพอดี: กระเป๋าบาท 1 · บัญชีพักบาท 1 · เงินสด USD (บัญชีลงทุน USD) 1 · บัญชีพัก USD 1 · จำนวนและเครื่องหมายตามทิศทาง (เหมือน record_fx_exchange และ exchangeEntryProblem ฝั่งเว็บ)
  --   กระเป๋าบาทรับได้ทั้งป้าย normal และ investment (R23: ป้ายเป็นแค่การแสดงผล)
  if exists (
    select 1 from public.fx_exchanges x
     where x.user_id = v_user
       and not exists (
         select 1 from public.entries e
          where e.user_id = x.user_id and e.id = x.entry_id and e.date = x.date
            and (select count(*) from public.lines l where l.user_id = e.user_id and l.entry_id = e.id) = 4
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'asset' and a.currency = 'THB'
                    and l.amount = case when x.direction = 'thb_to_usd' then -x.thb_satang else x.thb_satang end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'equity' and a.currency = 'THB'
                    and l.amount = case when x.direction = 'thb_to_usd' then x.thb_satang else -x.thb_satang end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'asset' and a.currency = 'USD' and a.kind = 'investment'
                    and l.amount = case when x.direction = 'thb_to_usd' then x.usd_cents else -x.usd_cents end) = 1
            and (select count(*) from public.lines l join public.accounts a on a.user_id = l.user_id and a.id = l.account_id
                  where l.user_id = e.user_id and l.entry_id = e.id and a.type = 'equity' and a.currency = 'USD'
                    and l.amount = case when x.direction = 'thb_to_usd' then -x.usd_cents else x.usd_cents end) = 1)
  ) then
    raise exception 'รายการแลกเงินที่นำเข้าไม่ตรงกับรายการในสมุดบัญชีที่ผูกอยู่ (วันที่ จำนวน หรือบัญชีไม่ตรง)' using errcode = '23514';
  end if;

  v_out := jsonb_build_object('assets', v_assets, 'prices', v_prices, 'trades', v_trades);
  if v_fx_rates > 0 then v_out := v_out || jsonb_build_object('fxRates', v_fx_rates); end if;
  if v_fx_exchanges > 0 then v_out := v_out || jsonb_build_object('fxExchanges', v_fx_exchanges); end if;
  return v_out;
end
$$;

create or replace function public.set_account_kind(p_id text, p_kind text) returns text
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
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ เปลี่ยนป้ายบัญชีไม่ได้' using errcode = '55000';
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
