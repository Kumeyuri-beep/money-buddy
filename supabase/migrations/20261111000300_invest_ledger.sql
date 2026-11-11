-- พอร์ตลงทุน P4: ผูกรายการลงทุนกับสมุดบัญชีคู่ (R4 R6 R16 R17) + กันขายเกินที่ถือ/ผิดลำดับที่ฐานข้อมูล (แก้ความเสี่ยงสองแท็บ)
-- แผน docs/plans/2026-11-11-invest-portfolio-dca.md · **ใส่ในฐานข้อมูลจริงแล้ว (apply_migration ชื่อ invest_ledger) หลัง dry-run แบบ rollback ผ่าน · ต้องใส่หลัง 20261111000100 และ 20261111000200**
--
-- เปลี่ยน 4 อย่าง (ไม่แก้ฟังก์ชันเดิมที่ซับซ้อนอื่น: เพิ่ม trigger ตัวใหม่ + ฟังก์ชันใหม่ + แทน import_ledger_investments ด้วยฉบับที่ตั้งตัวแปรนำเข้า):
--  1) trigger trades_insert_guard (BEFORE INSERT ON trades): ล็อกแถวสินทรัพย์ (FOR UPDATE) เพื่อให้สองแท็บเขียนต่อคิวกัน แล้วตรวจ
--     (ก) รายการที่กระทบหน่วย (ซื้อ ขาย ปันผลลงทุนต่อ) ต้องลงวันที่หลังรายการขายล่าสุด (ข) ขาย: เงินที่ขายได้ > 0 สตางค์ และค่าธรรมเนียม ≤ เงินที่ขายได้
--     (ค) ขายไม่เกินจำนวนหน่วยที่ถือ (ผลรวมซื้อ+ปันผลลงทุนต่อ − ขาย) · ผิด = 23514 ทั้งคำสั่งย้อนกลับ
--  2) trigger trades_delete_guard / entries_trade_guard (BEFORE DELETE): ผู้ใช้ (role authenticated) ลบรายการ/ลบ Entry ที่ผูกได้ตามกติกา
--     เดียวกับฝั่งเว็บ (รายการขายลบได้เฉพาะล่าสุด · รายการอื่นที่กระทบหน่วยลบได้เฉพาะที่ลงวันที่หลังรายการขายล่าสุด · ปันผลเงินสดลบได้เสมอ)
--     ฟังก์ชัน security definer (ล้างข้อมูล/ลบบัญชี/ยกเลิกนำเข้า) รันด้วย role เจ้าของจึงไม่ติดกติกานี้ (cascade ตอนล้างข้อมูลทำงานต่อได้)
--  3) trigger กัน "แก้" Entry/บรรทัดที่ผูกกับรายการลงทุน (ต้องลบรายการลงทุนแล้วบันทึกใหม่) เพราะแก้แล้วยอดในสมุดไม่ตรงกับรายการลงทุน
--  4) record_trade(p_trade, p_entry, p_accounts): บันทึกรายการลงทุน + Entry ในสมุดบัญชีคู่ในธุรกรรมเดียว (อะตอมมิก)
--     ตรวจว่า Entry ตรงกับรายการ (ซื้อ: บัญชีลงทุน +(A+F) ฝั่งกระเป๋า −(A+F) · ปันผลลงทุนต่อ: +ต้นทุนที่เพิ่ม / ปันผล · ปันผลเงินสด ·
--     ขาย: เงินเข้ากระเป๋า = เงินที่ขายได้ − ค่าธรรมเนียม) บัญชีที่ใช้ได้มีแค่ บัญชีลงทุนของสินทรัพย์ · กระเป๋าเงินสดบาท · 4 บัญชีผลลงทุน
--     (inv-gain กำไรจากการลงทุน · inv-loss ขาดทุนจากการลงทุน · inv-dividend ปันผล · inv-wht ภาษีหัก ณ ที่จ่าย) ที่ฟังก์ชันสร้างให้เองถ้ายังไม่มี
--     ส่วนต้นทุนที่ตัดออกตอนขาย (costOut) และกำไร/ขาดทุนคำนวณฝั่งเว็บ (ต้นทุนเฉลี่ย R17) ฐานข้อมูลตรวจเฉพาะว่า Entry สมดุล (R16) และเงินเข้ากระเป๋าตรง
--  SECURITY INVOKER ทั้งหมด: RLS/ด่านเปลี่ยนรหัส/ตัวตรวจ Entry เดิมมีผลเต็ม

-- ---------------------------------------------------------------------------
-- 1. กติกาเมื่อเพิ่มรายการ (BEFORE INSERT)
-- ---------------------------------------------------------------------------
create function private.trades_insert_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_last date;
  v_gross numeric;
  v_held numeric;
begin
  -- นำเข้าไฟล์สำรอง (import_ledger_investments ตั้งตัวแปรนี้): ลำดับแถวในคำสั่งเดียวไม่แน่นอน เว็บตรวจลำดับ/ขายเกินก่อนส่งแล้ว
  if coalesce(current_setting('app.invest_import', true), '') = 'on' then
    return new;
  end if;
  -- ล็อกแถวสินทรัพย์: สองแท็บที่เขียนสินทรัพย์เดียวกันต้องต่อคิว (ตัวที่สองเห็นผลของตัวแรกที่ commit แล้ว)
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
    v_gross := round(new.units::numeric * new.price_micro::numeric / 1000000000000);
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

create trigger trades_insert_guard_trg
before insert on public.trades
for each row execute function private.trades_insert_guard();

-- ---------------------------------------------------------------------------
-- 2. กติกาเมื่อลบ (ผู้ใช้เท่านั้น) · ตัวช่วยใช้ร่วมกันระหว่างลบรายการและลบ Entry
-- ---------------------------------------------------------------------------
-- คืนข้อความปัญหา (null = ลบได้) · กติกาเดียวกับ checkTradeDelete ฝั่งเว็บ
create function private.trade_delete_problem(p_user uuid, p_id text) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  t public.trades%rowtype;
  v_last public.trades%rowtype;
begin
  select * into t from public.trades x where x.user_id = p_user and x.id = p_id;
  if not found or t.kind = 'dividend' then
    return null;
  end if;
  select * into v_last from public.trades x
   where x.user_id = p_user and x.asset_id = t.asset_id and x.kind = 'sell'
   order by x.date desc, x.created_at desc, x.id desc limit 1;
  if t.kind = 'sell' then
    if v_last.id is distinct from t.id then
      return 'ลบได้เฉพาะรายการขายล่าสุด (ลบจากล่าสุดย้อนกลับ)';
    end if;
  elsif v_last.id is not null and t.date <= v_last.date then
    return format('ลบรายการที่ลงวันที่ ณ หรือก่อนรายการขายล่าสุด (%s) ไม่ได้ ให้ลบรายการขายก่อน', v_last.date);
  end if;
  return null;
end
$$;

revoke all on function private.trade_delete_problem(uuid, text) from public, anon, authenticated;
grant execute on function private.trade_delete_problem(uuid, text) to authenticated;

create function private.trades_delete_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_problem text;
begin
  -- เฉพาะผู้ใช้เว็บ (authenticated) · ฟังก์ชัน security definer (ล้างข้อมูล/ลบบัญชี) และ cascade ของ FK รันด้วย role เจ้าของ
  if current_user <> 'authenticated' then
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

create trigger trades_delete_guard_trg
before delete on public.trades
for each row execute function private.trades_delete_guard();

-- ลบ Entry ที่ผูกกับรายการลงทุนโดยตรง: cascade ลบรายการลงทุนด้วย role เจ้าของ (ข้ามด่านด้านบน) จึงตรวจที่ Entry ด้วยกติกาเดียวกัน
create function private.entries_trade_guard() returns trigger
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
  -- DELETE
  if current_user <> 'authenticated' then
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

create trigger entries_trade_guard_trg
before update or delete on public.entries
for each row execute function private.entries_trade_guard();

-- ---------------------------------------------------------------------------
-- 3. กัน "เพิ่ม/แก้" บรรทัดของ Entry ที่ผูกกับรายการลงทุน (record_trade เพิ่มบรรทัดก่อนมีรายการลงทุน จึงไม่ติด)
-- ---------------------------------------------------------------------------
create function private.lines_trade_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.user_id, old.user_id);
  v_entry text := coalesce(new.entry_id, old.entry_id);
begin
  if exists (select 1 from public.trades t where t.user_id = v_user and t.entry_id = v_entry) then
    raise exception 'บรรทัดของรายการที่ผูกกับรายการลงทุน แก้ไขไม่ได้ (ลบรายการลงทุนแล้วบันทึกใหม่)' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger lines_trade_guard_ins_upd_trg
before insert or update on public.lines
for each row execute function private.lines_trade_guard();

-- ---------------------------------------------------------------------------
-- 4. record_trade: บันทึกรายการลงทุน + Entry ในสมุดบัญชีคู่ ในธุรกรรมเดียว
-- ---------------------------------------------------------------------------
create function public.record_trade(p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
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
  select a.account_id into v_asset_acc from public.assets a where a.user_id = v_user and a.id = p_trade->>'assetId';
  if v_asset_acc is null then
    raise exception 'ไม่พบสินทรัพย์นี้' using errcode = '23503';
  end if;

  -- บัญชีผลลงทุน 4 บัญชี: สร้างให้เองเฉพาะรหัส/ชนิด/ชื่อที่กำหนด (ผู้ใช้กำหนดชนิดหรือชื่อเองไม่ได้)
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

  -- แยกบรรทัดของ Entry ตามประเภทบัญชี · บรรทัดที่อยู่นอกประเภทที่อนุญาต = ปฏิเสธ
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

  -- Entry ต้องตรงกับรายการ (ยอดเงินเท่านั้น · ต้นทุนที่ตัดออกตอนขายและกำไรคำนวณฝั่งเว็บ ฐานข้อมูลตรวจความสมดุลโดย R16)
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
    v_gross := round((p_trade->>'units')::numeric * (p_trade->>'priceMicro')::numeric / 1000000000000);
    if s_wallet <> v_gross - v_fee or s_wallet_neg <> v_gross - v_fee or s_div <> 0 or s_wht <> 0
       or s_asset > 0 or s_gain > 0 or s_loss < 0 or (s_gain <> 0 and s_loss <> 0) then
      raise exception 'รายการขายต้องเดบิตกระเป๋าเท่ากับเงินที่ขายได้หักค่าธรรมเนียม เครดิตบัญชีลงทุน และมีกำไรหรือขาดทุนอย่างเดียว' using errcode = '23514';
    end if;
  end if;

  perform private.insert_entry(p_entry);
  insert into public.trades (id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id)
  values (
    p_trade->>'id', p_trade->>'assetId', v_kind, (p_trade->>'date')::date,
    coalesce((p_trade->>'createdAt')::timestamptz, now()),
    p_trade->>'units', (p_trade->>'priceMicro')::bigint, (p_trade->>'amount')::bigint,
    coalesce((p_trade->>'fee')::bigint, 0), coalesce((p_trade->>'withholding')::bigint, 0),
    coalesce(p_trade->>'memo', ''), p_entry->>'id'
  );
  return jsonb_build_object('tradeId', p_trade->>'id', 'entryId', p_entry->>'id');
end
$$;

revoke all on function public.record_trade(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_trade(jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. import_ledger_investments: แทนด้วยฉบับที่ข้ามด่าน trades_insert_guard ตอนนำเข้า (ส่วนอื่นเหมือน 20261111000200 ทุกบรรทัด)
-- ---------------------------------------------------------------------------
create or replace function public.import_ledger_investments(p_data jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_assets integer;
  v_prices integer;
  v_trades integer;
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
     or jsonb_typeof(coalesce(p_data->'trades', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง' using errcode = '22023';
  end if;
  if pg_column_size(p_data) > 20 * 1024 * 1024
     or jsonb_array_length(coalesce(p_data->'assets', '[]'::jsonb)) > 200
     or jsonb_array_length(coalesce(p_data->'prices', '[]'::jsonb)) > 10000
     or jsonb_array_length(coalesce(p_data->'trades', '[]'::jsonb)) > 10000 then
    raise exception 'ข้อมูลลงทุนมากเกินเพดาน (สินทรัพย์ไม่เกิน 200 · รายการและราคาไม่เกิน 10,000)' using errcode = '22023';
  end if;
  if exists (
       select 1 from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb) || coalesce(p_data->'prices', '[]'::jsonb) || coalesce(p_data->'trades', '[]'::jsonb)) x
        where jsonb_typeof(x) is distinct from 'object') then
    raise exception 'รูปแบบข้อมูลลงทุนไม่ถูกต้อง (แต่ละแถวต้องเป็นวัตถุ)' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_ledger:' || v_user::text));
  if private.import_session_exists() then
    raise exception 'มีการนำเข้าสมุดบัญชีค้างอยู่ นำเข้าข้อมูลลงทุนไม่ได้' using errcode = '55000';
  end if;
  if exists (select 1 from public.assets where user_id = v_user) then
    raise exception 'มีข้อมูลลงทุนอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)' using errcode = '23505';
  end if;

  insert into public.assets (user_id, id, name, kind, account_id, archived)
  select v_user, e->>'id', e->>'name', coalesce(e->>'kind', 'fund'), e->>'accountId', coalesce((e->>'archived')::boolean, false)
    from jsonb_array_elements(coalesce(p_data->'assets', '[]'::jsonb)) e;
  get diagnostics v_assets = row_count;

  insert into public.asset_prices (user_id, asset_id, date, price_micro)
  select v_user, e->>'assetId', (e->>'date')::date, (e->>'priceMicro')::bigint
    from jsonb_array_elements(coalesce(p_data->'prices', '[]'::jsonb)) e;
  get diagnostics v_prices = row_count;

  -- นำเข้า: ข้ามด่านลำดับ/ขายเกินของ trades_insert_guard เฉพาะในธุรกรรมนี้ (เว็บตรวจก่อนส่ง · ลำดับแถวในคำสั่งเดียวไม่แน่นอน)
  perform set_config('app.invest_import', 'on', true);
  insert into public.trades (user_id, id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id)
  select v_user, e->>'id', e->>'assetId', e->>'kind', (e->>'date')::date, coalesce((e->>'createdAt')::timestamptz, now()),
         e->>'units', (e->>'priceMicro')::bigint, (e->>'amount')::bigint,
         coalesce((e->>'fee')::bigint, 0), coalesce((e->>'withholding')::bigint, 0), coalesce(e->>'memo', ''), e->>'entryId'
    from jsonb_array_elements(coalesce(p_data->'trades', '[]'::jsonb)) e;
  get diagnostics v_trades = row_count;
  perform set_config('app.invest_import', '', true);

  return jsonb_build_object('assets', v_assets, 'prices', v_prices, 'trades', v_trades);
end
$$;
