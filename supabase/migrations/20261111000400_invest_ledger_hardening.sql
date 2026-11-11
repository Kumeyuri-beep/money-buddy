-- พอร์ตลงทุน P4 เสริมความแข็งแรง (แก้ตามผล money-auditor + security-auditor) · migration แบบ "เพิ่ม" เท่านั้น (create or replace function / create trigger)
--  1) กันแก้ trades ตรงๆ (UPDATE) ยกเว้นหมายเหตุ · กัน INSERT ตรงที่ใส่ entry_id เอง (ต้องมาจาก record_trade)
--  2) ด่านที่ข้ามได้ใช้ "รายชื่อ role ที่อนุญาต" (postgres, supabase_admin, supabase_auth_admin, service_role) แทน "ทุก role ยกเว้น authenticated"
--  3) กันลบสินทรัพย์ที่มีรายการลงทุนผูกสมุด (ไม่ให้ Entry ค้างในสมุด)
--  4) record_trade: ล็อกแถวสินทรัพย์ตั้งแต่ต้น · เทียบ "จำนวนรายการเดิม" (basedOn) ที่เว็บเห็นตอนคำนวณต้นทุน กับที่ฐานข้อมูลเห็น (กันสองแท็บ) ·
--     เพดาน p_accounts ≤ 4 และบรรทัดของ Entry ≤ 10 · คำนวณเงินที่ขายได้ด้วยจำนวนเต็มล้วน (ไม่ปัดสองรอบ ตรงกับ roundHalfUp ฝั่งเว็บ)
--  ใส่หลัง 20261111000300

-- ---------------------------------------------------------------------------
-- 1. กติกาเมื่อเพิ่มรายการ (แทนฉบับเดิม): + เงินที่ขายได้ด้วยจำนวนเต็ม + ห้าม entry_id ที่ไม่ได้มาจาก record_trade
-- ---------------------------------------------------------------------------
create or replace function private.trades_insert_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_last date;
  v_gross numeric;
  v_held numeric;
begin
  -- นำเข้าไฟล์สำรอง (import_ledger_investments ตั้งตัวแปรนี้)
  if coalesce(current_setting('app.invest_import', true), '') = 'on' then
    return new;
  end if;
  -- รายการที่ผูกสมุดต้องมาจาก record_trade (ตั้ง app.record_trade = รหัสรายการ) ไม่ให้ผู้ใช้ชี้ entry_id ไป Entry อื่นเอง
  if new.entry_id is not null and coalesce(current_setting('app.record_trade', true), '') is distinct from new.id then
    raise exception 'รายการลงทุนที่ผูกกับสมุดบัญชีต้องบันทึกผ่านหน้าพอร์ตเท่านั้น' using errcode = '42501';
  end if;
  perform 1 from public.assets a where a.user_id = new.user_id and a.id = new.asset_id for update;
  if new.kind <> 'dividend' then
    select max(t.date) into v_last from public.trades t
     where t.user_id = new.user_id and t.asset_id = new.asset_id and t.kind = 'sell';
    if v_last is not null and new.date <= v_last then
      raise exception 'ต้องลงวันที่หลังรายการขายล่าสุด (%) เพราะต้นทุนเฉลี่ยขึ้นกับลำดับ ถ้าต้องการบันทึกย้อนหลังให้ลบรายการขายก่อน', v_last
        using errcode = '23514';
    end if;
  end if;
  if new.kind = 'sell' then
    -- ปัดครึ่งขึ้นครั้งเดียวด้วยจำนวนเต็มล้วน: floor((2xP + 10^12) / 2x10^12) เท่ากับ roundHalfUp(P / 10^12) ของเว็บ (P > 0 เสมอ)
    v_gross := div(new.units::numeric * new.price_micro::numeric * 2 + 1000000000000, 2000000000000);
    if v_gross = 0 then
      raise exception 'ขายแล้วได้เงิน 0 สตางค์ (หน่วยน้อยหรือราคาต่ำเกินไป) บันทึกไม่ได้' using errcode = '23514';
    end if;
    if new.fee > v_gross then
      raise exception 'ค่าธรรมเนียมขายเกินเงินที่ขายได้' using errcode = '23514';
    end if;
    select coalesce(sum(case when t.kind in ('buy', 'reinvest') then t.units::numeric when t.kind = 'sell' then -t.units::numeric else 0 end), 0)
      into v_held from public.trades t where t.user_id = new.user_id and t.asset_id = new.asset_id;
    if new.units::numeric > v_held then
      raise exception 'ขายเกินจำนวนหน่วยที่ถืออยู่' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. กันแก้รายการลงทุนตรงๆ: แก้ได้เฉพาะหมายเหตุ (ต้นทุน/จำนวน/วันที่/ผูกสมุดเปลี่ยน = ลบแล้วบันทึกใหม่)
-- ---------------------------------------------------------------------------
create function private.trades_update_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return new;
  end if;
  if (to_jsonb(new) - 'memo') is distinct from (to_jsonb(old) - 'memo') then
    raise exception 'แก้รายการลงทุนไม่ได้ (แก้ได้เฉพาะหมายเหตุ) ให้ลบรายการแล้วบันทึกใหม่' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger trades_update_guard_trg
before update on public.trades
for each row execute function private.trades_update_guard();

-- ---------------------------------------------------------------------------
-- 3. ด่านลบ/แก้ (แทนฉบับเดิม): ข้ามเฉพาะ role ในรายชื่อที่อนุญาต
-- ---------------------------------------------------------------------------
create or replace function private.trades_delete_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_problem text;
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return old;
  end if;
  if old.entry_id is not null then
    raise exception 'รายการลงทุนที่ผูกกับสมุดบัญชี ลบได้ผ่านการลบรายการในสมุดเท่านั้น' using errcode = '23514';
  end if;
  perform 1 from public.assets a where a.user_id = old.user_id and a.id = old.asset_id for update;
  v_problem := private.trade_delete_problem(old.user_id, old.id);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '23514';
  end if;
  return old;
end
$$;

create or replace function private.entries_trade_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_trade public.trades%rowtype;
  v_problem text;
begin
  if tg_op = 'UPDATE' then
    if exists (select 1 from public.trades t where t.user_id = old.user_id and t.entry_id = old.id) then
      raise exception 'รายการนี้ผูกกับรายการลงทุน แก้ไขไม่ได้ (ลบรายการลงทุนแล้วบันทึกใหม่)' using errcode = '42501';
    end if;
    return new;
  end if;
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return old;
  end if;
  select * into v_trade from public.trades t where t.user_id = old.user_id and t.entry_id = old.id;
  if found then
    perform 1 from public.assets a where a.user_id = v_trade.user_id and a.id = v_trade.asset_id for update;
    v_problem := private.trade_delete_problem(v_trade.user_id, v_trade.id);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '23514';
    end if;
  end if;
  return old;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. กันลบสินทรัพย์ที่ยังมีรายการลงทุนผูกสมุด (ไม่ให้ Entry ค้างในสมุดโดยไม่มีรายการลงทุนคู่)
-- ---------------------------------------------------------------------------
create function private.assets_delete_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return old;
  end if;
  if exists (select 1 from public.trades t where t.user_id = old.user_id and t.asset_id = old.id and t.entry_id is not null) then
    raise exception 'สินทรัพย์นี้ยังมีรายการซื้อขายที่ผูกกับสมุดบัญชี ลบรายการเหล่านั้นก่อน' using errcode = '23514';
  end if;
  return old;
end
$$;

create trigger assets_delete_guard_trg
before delete on public.assets
for each row execute function private.assets_delete_guard();

-- ---------------------------------------------------------------------------
-- 5. record_trade (แทนฉบับเดิม): ล็อกสินทรัพย์ก่อน · basedOn · เพดานขนาดข้อมูล · เงินที่ขายได้ด้วยจำนวนเต็ม · ตั้ง app.record_trade
-- ---------------------------------------------------------------------------
create or replace function public.record_trade(p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_acc jsonb;
  v_id text;
  v_kind text := p_trade->>'kind';
  v_asset_acc text;
  v_amount numeric := (p_trade->>'amount')::numeric;
  v_fee numeric := coalesce((p_trade->>'fee')::numeric, 0);
  v_wht numeric := coalesce((p_trade->>'withholding')::numeric, 0);
  v_based integer;
  v_count integer;
  v_gross numeric;
  v_unknown integer;
  s_asset numeric;
  s_wallet numeric;
  s_div numeric;
  s_wht numeric;
  s_gain numeric;
  s_loss numeric;
  s_wallet_neg numeric;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_trade) is distinct from 'object' or jsonb_typeof(p_entry) is distinct from 'object'
     or jsonb_typeof(coalesce(p_accounts, '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(p_entry->'lines') is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_accounts, '[]'::jsonb)) > 4 or jsonb_array_length(p_entry->'lines') > 10 then
    raise exception 'ข้อมูลรายการมากเกินกำหนด' using errcode = '22023';
  end if;
  if v_kind not in ('buy', 'sell', 'dividend', 'reinvest') then
    raise exception 'ชนิดรายการลงทุนไม่ถูกต้อง' using errcode = '22023';
  end if;
  if (p_entry->>'date') is distinct from (p_trade->>'date') then
    raise exception 'วันที่ของรายการในสมุดต้องตรงกับรายการลงทุน' using errcode = '22023';
  end if;
  if coalesce(p_entry->>'source', 'manual') <> 'manual' then
    raise exception 'รายการลงทุนใช้ชนิดรายการ manual เท่านั้น' using errcode = '22023';
  end if;
  if v_kind <> 'sell' and v_amount is null then
    raise exception 'รายการนี้ต้องระบุยอดเงิน' using errcode = '22023';
  end if;
  select a.account_id into v_asset_acc from public.assets a where a.user_id = v_user and a.id = p_trade->>'assetId' for update;
  if v_asset_acc is null then
    raise exception 'ไม่พบสินทรัพย์นี้' using errcode = '23503';
  end if;
  -- สองแท็บ: เว็บคำนวณต้นทุนจากรายการเดิม N รายการ ถ้าตอนนี้ (หลังล็อกแล้ว) จำนวนไม่เท่า N = มีคนเปลี่ยนระหว่างทาง ให้โหลดใหม่
  if p_trade->>'basedOn' is not null then
    v_based := (p_trade->>'basedOn')::integer;
    select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = p_trade->>'assetId';
    if v_count <> v_based then
      raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไประหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
    end if;
  end if;

  for v_acc in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_id := v_acc->>'id';
    if v_id is null or v_id not in ('inv-gain', 'inv-loss', 'inv-dividend', 'inv-wht') then
      raise exception 'สร้างบัญชีนี้ผ่านรายการลงทุนไม่ได้' using errcode = '22023';
    end if;
    insert into public.accounts (user_id, id, type, name, currency, kind)
    values (
      v_user, v_id,
      case v_id when 'inv-gain' then 'income' when 'inv-dividend' then 'income' else 'expense' end,
      case v_id when 'inv-gain' then 'กำไรจากการลงทุน' when 'inv-loss' then 'ขาดทุนจากการลงทุน' when 'inv-dividend' then 'ปันผล' else 'ภาษีหัก ณ ที่จ่าย' end,
      'THB', 'normal'
    ) on conflict (user_id, id) do nothing;
  end loop;

  select
    coalesce(sum(c.amt) filter (where c.cls = 'asset'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'wallet'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'div'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'wht'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'gain'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'loss'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'wallet' and c.amt > 0), 0),
    count(*) filter (where c.cls = 'unknown')
  into s_asset, s_wallet, s_div, s_wht, s_gain, s_loss, s_wallet_neg, v_unknown
  from (
    select l.amt,
      case
        when l.acc = v_asset_acc then 'asset'
        when l.acc = 'inv-dividend' and a.type = 'income' and a.kind = 'normal' then 'div'
        when l.acc = 'inv-gain' and a.type = 'income' and a.kind = 'normal' then 'gain'
        when l.acc = 'inv-wht' and a.type = 'expense' and a.kind = 'normal' then 'wht'
        when l.acc = 'inv-loss' and a.type = 'expense' and a.kind = 'normal' then 'loss'
        when l.acc not in ('inv-dividend', 'inv-gain', 'inv-wht', 'inv-loss')
             and a.type = 'asset' and a.kind = 'normal' and a.currency = 'THB' and not a.archived then 'wallet'
        else 'unknown'
      end as cls
    from (select l->>'accountId' as acc, (l->>'amount')::numeric as amt from jsonb_array_elements(p_entry->'lines') l) l
    left join public.accounts a on a.user_id = v_user and a.id = l.acc
  ) c;
  if v_unknown > 0 then
    raise exception 'รายการลงทุนใช้ได้เฉพาะบัญชีลงทุนของสินทรัพย์นี้ กระเป๋าเงินสดบาท และบัญชีผลลงทุน' using errcode = '23514';
  end if;

  if v_kind = 'buy' then
    if s_asset <> v_amount + v_fee or s_wallet <> -(v_amount + v_fee) or s_div <> 0 or s_wht <> 0 or s_gain <> 0 or s_loss <> 0 then
      raise exception 'รายการซื้อต้องเดบิตบัญชีลงทุน (เงินซื้อ + ค่าธรรมเนียม) และเครดิตกระเป๋าเท่ากัน' using errcode = '23514';
    end if;
  elsif v_kind = 'reinvest' then
    if s_asset <> v_amount or s_div <> -v_amount or s_wallet <> 0 or s_wht <> 0 or s_gain <> 0 or s_loss <> 0 then
      raise exception 'ปันผลลงทุนต่อต้องเดบิตบัญชีลงทุนและเครดิตบัญชีปันผลเท่ากัน (ไม่มีเงินสด)' using errcode = '23514';
    end if;
  elsif v_kind = 'dividend' then
    if s_div <> -v_amount or s_wht <> v_wht or s_wallet <> v_amount - v_wht or s_asset <> 0 or s_gain <> 0 or s_loss <> 0 then
      raise exception 'ปันผลเงินสดต้องเครดิตบัญชีปันผล (ยอดปันผล) เดบิตกระเป๋า (หลังหักภาษี) และบัญชีภาษี' using errcode = '23514';
    end if;
  else
    v_gross := div((p_trade->>'units')::numeric * (p_trade->>'priceMicro')::numeric * 2 + 1000000000000, 2000000000000);
    if s_wallet <> v_gross - v_fee or s_wallet_neg <> v_gross - v_fee or s_div <> 0 or s_wht <> 0
       or s_asset > 0 or s_gain > 0 or s_loss < 0 or (s_gain <> 0 and s_loss <> 0) then
      raise exception 'รายการขายต้องเดบิตกระเป๋าเท่ากับเงินที่ขายได้หักค่าธรรมเนียม เครดิตบัญชีลงทุน และมีกำไรหรือขาดทุนอย่างเดียว' using errcode = '23514';
    end if;
  end if;

  perform private.insert_entry(p_entry);
  perform set_config('app.record_trade', p_trade->>'id', true);
  insert into public.trades (id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id)
  values (
    p_trade->>'id', p_trade->>'assetId', v_kind, (p_trade->>'date')::date,
    coalesce((p_trade->>'createdAt')::timestamptz, now()),
    p_trade->>'units', (p_trade->>'priceMicro')::bigint, (p_trade->>'amount')::bigint,
    coalesce((p_trade->>'fee')::bigint, 0), coalesce((p_trade->>'withholding')::bigint, 0),
    coalesce(p_trade->>'memo', ''), p_entry->>'id'
  );
  perform set_config('app.record_trade', '', true);
  return jsonb_build_object('tradeId', p_trade->>'id', 'entryId', p_entry->>'id');
end
$$;
