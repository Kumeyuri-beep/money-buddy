-- Invest v2 รอบที่ 2 · basedOn เป็นลายนิ้วมือรายการ (แก้ช่องโหว่: แก้รายการแล้วจำนวนเท่าเดิม แท็บเก่าจับไม่ได้)
-- ที่มา: ผลตรวจ money-auditor ของ #259 (HANDOFF §102.2 ข้อ 1) · เจ้าของสั่ง 23 พ.ย. 2569 ให้ทำก่อนหน้าจอแก้รายการ
-- **migration แบบ "เพิ่ม/แทนที่ฟังก์ชัน" เท่านั้น:** create function 1 ตัว (ตัวช่วย private) + create or replace 3 ฟังก์ชัน (ลายเซ็นเดิม · สิทธิ์เดิมคงอยู่) · ไม่มี drop / delete / เปลี่ยนชนิดคอลัมน์ / เปลี่ยน RLS-trigger
-- ลายนิ้วมือ = sha256 (hex) ของ: จำนวนรายการ + บรรทัดละรายการ เรียงตามรหัส (collate "C") ฟิลด์ id|kind|date|created_at(มิลลิวินาที epoch ปัดลง)|units|price_micro|amount|fee|withholding|fx_rate_micro (ค่าว่าง = ข้อความว่าง)
--   ฝั่งเว็บคำนวณจากแถวเดียวกัน (src/domain/invest/tradesFingerprint.ts) · ต้องตรงกันทุกตัวอักษร (มีเทสต์ทั้งสองฝั่งและ live-contract)
-- ลำดับปล่อย (สำคัญ): ต้องใส่ migration นี้ก่อน merge/ปล่อยเว็บรุ่นใหม่เสมอ (ฐานข้อมูลเดิมแปลง basedOn เป็น integer · เว็บใหม่ส่ง hex จะได้ 22P02 ลงรายการลงทุนไม่ได้เลย)
-- ยังไม่รวมในรอบนี้ (จดใน HANDOFF): ขายต้องมี basedOn เสมอฝั่งฐานข้อมูล · escape ตัวคั่นใน id · ตัดแบบตัวเลขออก
-- basedOn แบบตัวเลข (นับจำนวน) ยังรับอยู่ชั่วคราวเพื่อไม่ให้เว็บรุ่นเก่าพังระหว่างปล่อย · เว็บรุ่นใหม่ส่งลายนิ้วมือเสมอ · ตัดแบบตัวเลขออกใน migration ถัดไปหลังเว็บใหม่ขึ้นแล้ว

create function private.trades_fingerprint(p_user uuid, p_asset text) returns text
language sql stable security invoker set search_path = ''
as $$
  select encode(sha256(convert_to(
    count(*)::text || E'\n' || coalesce(string_agg(
      t.id || '|' || t.kind || '|' || to_char(t.date, 'YYYY-MM-DD') || '|' || floor(extract(epoch from t.created_at) * 1000)::bigint::text || '|' || coalesce(t.units, '') || '|' || coalesce(t.price_micro::text, '')
        || '|' || coalesce(t.amount::text, '') || '|' || t.fee::text || '|' || t.withholding::text || '|' || coalesce(t.fx_rate_micro::text, ''),
      E'\n' order by t.id collate "C"), ''),
    'UTF8')), 'hex')
  from public.trades t where t.user_id = p_user and t.asset_id = p_asset
    and p_user = (select auth.uid()) -- ขอได้เฉพาะของตัวเอง (กันใช้เป็นช่องเดาข้อมูลคนอื่นถ้ามีคนเรียกจาก security definer/service_role ในอนาคต)
$$;
revoke all on function private.trades_fingerprint(uuid, text) from public, anon, authenticated;
grant execute on function private.trades_fingerprint(uuid, text) to authenticated;

-- record_trade (THB)
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
    if jsonb_typeof(p_trade->'basedOn') = 'string' then
      if (p_trade->>'basedOn') !~ '^[0-9a-f]{64}$' then raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023'; end if;
      -- ลายนิ้วมือ: เทียบกับรายการทั้งหมดของสินทรัพย์นี้ ณ ตอนนี้ (หลังล็อกแล้ว) · แก้รายการจำนวนเท่าเดิมก็จับได้
      if (p_trade->>'basedOn') is distinct from private.trades_fingerprint(v_user, p_trade->>'assetId') then
        raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไประหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
      end if;
    elsif jsonb_typeof(p_trade->'basedOn') = 'number' then
      if (p_trade->>'basedOn')::numeric <> trunc((p_trade->>'basedOn')::numeric) or (p_trade->>'basedOn')::numeric not between 0 and 2147483647 then
        raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023';
      end if;
      -- แบบเดิม (นับจำนวน): คงไว้ชั่วคราวให้เว็บรุ่นเก่าที่ยังไม่ได้ปล่อยไม่พัง · เว็บรุ่นใหม่ส่งลายนิ้วมือเสมอ
      v_based := (p_trade->>'basedOn')::integer;
      select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = p_trade->>'assetId';
      if v_count <> v_based then
        raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไประหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
      end if;
    else
      raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023';
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

-- record_trade_fx (USD) · เดิมเป็น create function จึงเปลี่ยนเป็น create or replace
create or replace function public.record_trade_fx(p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_acc jsonb;
  v_id text;
  v_kind text := p_trade->>'kind';
  v_asset_acc text;
  v_cur text;
  v_amount numeric := (p_trade->>'amount')::numeric;
  v_fee numeric := coalesce((p_trade->>'fee')::numeric, 0);
  v_wht numeric := coalesce((p_trade->>'withholding')::numeric, 0);
  v_fx numeric := (p_trade->>'fxRateMicro')::numeric;
  v_based integer;
  v_count integer;
  v_gross numeric;
  v_unknown integer;
  s_asset numeric;
  s_cash numeric;
  s_div numeric;
  s_wht numeric;
  s_gain numeric;
  s_loss numeric;
  s_cash_neg numeric;
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
  if v_kind not in ('buy', 'sell', 'dividend') then
    raise exception 'ชนิดรายการลงทุนสกุล USD ไม่ถูกต้อง (รองรับ ซื้อ ขาย ปันผล)' using errcode = '22023';
  end if;
  if v_fx is null or v_fx < 1 or v_fx > 9007199254740991 or v_fx <> trunc(v_fx) then
    raise exception 'อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0' using errcode = '22023';
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
  select a.account_id, a.instrument_currency into v_asset_acc, v_cur
    from public.assets a where a.user_id = v_user and a.id = p_trade->>'assetId' for update;
  if v_asset_acc is null then
    raise exception 'ไม่พบสินทรัพย์นี้' using errcode = '23503';
  end if;
  if v_cur <> 'USD' then
    raise exception 'ฟังก์ชันนี้ใช้กับสินทรัพย์สกุล USD เท่านั้น (สินทรัพย์สกุลบาทใช้ record_trade)' using errcode = '22023';
  end if;
  if p_trade->>'basedOn' is not null then
    if jsonb_typeof(p_trade->'basedOn') = 'string' then
      if (p_trade->>'basedOn') !~ '^[0-9a-f]{64}$' then raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023'; end if;
      -- ลายนิ้วมือ: เทียบกับรายการทั้งหมดของสินทรัพย์นี้ ณ ตอนนี้ (หลังล็อกแล้ว) · แก้รายการจำนวนเท่าเดิมก็จับได้
      if (p_trade->>'basedOn') is distinct from private.trades_fingerprint(v_user, p_trade->>'assetId') then
        raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
      end if;
    elsif jsonb_typeof(p_trade->'basedOn') = 'number' then
      if (p_trade->>'basedOn')::numeric <> trunc((p_trade->>'basedOn')::numeric) or (p_trade->>'basedOn')::numeric not between 0 and 2147483647 then
        raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023';
      end if;
      -- แบบเดิม (นับจำนวน): คงไว้ชั่วคราวให้เว็บรุ่นเก่าที่ยังไม่ได้ปล่อยไม่พัง · เว็บรุ่นใหม่ส่งลายนิ้วมือเสมอ
      v_based := (p_trade->>'basedOn')::integer;
      select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = p_trade->>'assetId';
      if v_count <> v_based then
        raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
      end if;
    else
      raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023';
    end if;
  end if;

  for v_acc in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_id := v_acc->>'id';
    if v_id is null or v_id not in ('inv-gain-usd', 'inv-loss-usd', 'inv-dividend-usd', 'inv-wht-usd') then
      raise exception 'สร้างบัญชีนี้ผ่านรายการลงทุนไม่ได้' using errcode = '22023';
    end if;
    insert into public.accounts (user_id, id, type, name, currency, kind)
    values (
      v_user, v_id,
      case v_id when 'inv-gain-usd' then 'income' when 'inv-dividend-usd' then 'income' else 'expense' end,
      case v_id when 'inv-gain-usd' then 'กำไรจากการลงทุน (USD)' when 'inv-loss-usd' then 'ขาดทุนจากการลงทุน (USD)'
                when 'inv-dividend-usd' then 'ปันผล (USD)' else 'ภาษีหัก ณ ที่จ่าย (USD)' end,
      'USD', 'normal'
    ) on conflict (user_id, id) do nothing;
  end loop;

  select
    coalesce(sum(c.amt) filter (where c.cls = 'asset'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'cash'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'div'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'wht'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'gain'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'loss'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'cash' and c.amt > 0), 0),
    count(*) filter (where c.cls = 'unknown')
  into s_asset, s_cash, s_div, s_wht, s_gain, s_loss, s_cash_neg, v_unknown
  from (
    select l.amt,
      case
        when l.acc = v_asset_acc then 'asset'
        when l.acc = 'inv-dividend-usd' and a.type = 'income' and a.kind = 'normal' and a.currency = 'USD' then 'div'
        when l.acc = 'inv-gain-usd' and a.type = 'income' and a.kind = 'normal' and a.currency = 'USD' then 'gain'
        when l.acc = 'inv-wht-usd' and a.type = 'expense' and a.kind = 'normal' and a.currency = 'USD' then 'wht'
        when l.acc = 'inv-loss-usd' and a.type = 'expense' and a.kind = 'normal' and a.currency = 'USD' then 'loss'
        when l.acc not in ('inv-dividend-usd', 'inv-gain-usd', 'inv-wht-usd', 'inv-loss-usd')
             and a.type = 'asset' and a.kind = 'investment' and a.currency = 'USD' and not a.archived
             and not exists (select 1 from public.assets s where s.user_id = v_user and s.account_id = a.id) then 'cash'
        else 'unknown'
      end as cls
    from (select l->>'accountId' as acc, (l->>'amount')::numeric as amt from jsonb_array_elements(p_entry->'lines') l) l
    left join public.accounts a on a.user_id = v_user and a.id = l.acc
  ) c;
  if v_unknown > 0 then
    raise exception 'รายการลงทุนสกุล USD ใช้ได้เฉพาะบัญชีลงทุนของสินทรัพย์นี้ เงินสด USD และบัญชีผลลงทุน USD' using errcode = '23514';
  end if;

  if v_kind = 'buy' then
    if s_asset <> v_amount + v_fee or s_cash <> -(v_amount + v_fee) or s_div <> 0 or s_wht <> 0 or s_gain <> 0 or s_loss <> 0 then
      raise exception 'รายการซื้อต้องเดบิตบัญชีลงทุน (เงินซื้อ + ค่าธรรมเนียม) และเครดิตเงินสด USD เท่ากัน' using errcode = '23514';
    end if;
  elsif v_kind = 'dividend' then
    if s_div <> -v_amount or s_wht <> v_wht or s_cash <> v_amount - v_wht or s_asset <> 0 or s_gain <> 0 or s_loss <> 0 then
      raise exception 'ปันผลต้องเครดิตบัญชีปันผล (ยอดปันผล) เดบิตเงินสด USD (หลังหักภาษี) และบัญชีภาษี' using errcode = '23514';
    end if;
  else
    -- ขาย: เงินที่ขายได้ = roundHalfUp(units x price / 10^12) ด้วยจำนวนเต็มล้วน (ตัวหารเดียวกับสตางค์เพราะ 10^8 x 10^6 / 10^14 x 100 เซนต์)
    v_gross := div((p_trade->>'units')::numeric * (p_trade->>'priceMicro')::numeric * 2 + 1000000000000, 2000000000000);
    if s_cash <> v_gross - v_fee or s_cash_neg <> v_gross - v_fee or s_div <> 0 or s_wht <> 0
       or s_asset > 0 or s_gain > 0 or s_loss < 0 or (s_gain <> 0 and s_loss <> 0) then
      raise exception 'รายการขายต้องเดบิตเงินสด USD เท่ากับเงินที่ขายได้หักค่าธรรมเนียม เครดิตบัญชีลงทุน และมีกำไรหรือขาดทุนอย่างเดียว' using errcode = '23514';
    end if;
  end if;

  perform private.insert_entry(p_entry);
  perform set_config('app.record_trade', p_trade->>'id', true);
  insert into public.trades (id, asset_id, kind, date, created_at, units, price_micro, amount, fee, withholding, memo, entry_id, fx_rate_micro)
  values (
    p_trade->>'id', p_trade->>'assetId', v_kind, (p_trade->>'date')::date,
    coalesce((p_trade->>'createdAt')::timestamptz, now()),
    p_trade->>'units', (p_trade->>'priceMicro')::bigint, (p_trade->>'amount')::bigint,
    coalesce((p_trade->>'fee')::bigint, 0), coalesce((p_trade->>'withholding')::bigint, 0),
    coalesce(p_trade->>'memo', ''), p_entry->>'id', v_fx::bigint
  );
  perform set_config('app.record_trade', '', true);
  return jsonb_build_object('tradeId', p_trade->>'id', 'entryId', p_entry->>'id');
end
$$;

-- replace_trade (ลายเซ็นเดิม: p_based_on integer ยังอยู่เพื่อแบบตัวเลขชั่วคราว)
create or replace function public.replace_trade(p_old_id text, p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb, p_based_on integer default null)
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

  -- basedOn = ลายนิ้วมือ (string) ของรายการทั้งหมดของสินทรัพย์นี้ตอนผู้ใช้เปิดฟอร์มแก้ ใน p_trade->'basedOn' · ตรวจก่อนลบ (หลังล็อกแล้ว)
  --   จับการเพิ่ม/ลบ/แก้รายการอื่นระหว่างแก้ แม้จำนวนรายการเท่าเดิม (ต้นทุนที่ตัดออกของรายการขายคำนวณจากรายการเหล่านี้)
  -- p_based_on (จำนวน): แบบเดิม คงไว้ชั่วคราว · ห้ามส่งทั้งสองแบบพร้อมกัน
  if v_trade ? 'basedOn' then
    if jsonb_typeof(v_trade->'basedOn') <> 'string' then raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023'; end if;
    if (v_trade->>'basedOn') !~ '^[0-9a-f]{64}$' then raise exception 'รูปแบบ basedOn ไม่ถูกต้อง' using errcode = '22023'; end if;
    if p_based_on is not null then raise exception 'ส่ง basedOn ได้แบบเดียว (ลายนิ้วมือหรือจำนวน)' using errcode = '22023'; end if;
    if (v_trade->>'basedOn') is distinct from private.trades_fingerprint(v_user, v_old.asset_id) then
      raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001';
    end if;
    v_trade := v_trade - 'basedOn';
  elsif p_based_on is not null then
    select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = v_old.asset_id;
    if v_count <> p_based_on then raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001'; end if;
  end if;

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
