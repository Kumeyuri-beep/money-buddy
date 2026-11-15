-- เฟส A หุ้นสหรัฐและหลายสกุลเงิน (กฎ R20 · เจ้าของอนุมัติ 15 พ.ย. 2569 · แผน docs/plans/phase-a-us-stocks.md ข้อ ข.)
-- **migration แบบ "เพิ่ม" เท่านั้น:** add column / create table / create function / create trigger / create or replace function (เพิ่มความสามารถ)
-- ไม่มี drop · ไม่เปลี่ยนชนิดคอลัมน์ · ไม่ถอด constraint เดิม · ข้อมูลเงินบาทเดิมไม่เปลี่ยน (ทุกแถวเดิม instrument_currency = 'THB', fx_rate_micro = null)
--
-- ออกแบบ:
--  * assets.instrument_currency ('THB' | 'USD') สกุลของสินทรัพย์ · คอลัมน์ currency เดิมคงไว้ (check = 'THB' เดิมไม่แตะ) = "สกุลที่รายงาน" ไม่ใช้ตัดสินสกุลของสินทรัพย์
--  * trades.amount / fee / withholding / price_micro ตีความเป็นหน่วยย่อยของ instrument_currency ของสินทรัพย์นั้น (USD = เซนต์ / micro-USD) · ไม่เปลี่ยนชนิดคอลัมน์
--  * trades.fx_rate_micro = บาทต่อ 1 USD x 10^6 ณ วันที่รายการ (R20.3) · สินทรัพย์ USD ต้องมี · สินทรัพย์ THB ห้ามมี · รายการ USD ต้องผูกสมุดผ่าน record_trade_fx
--  * record_trade เดิมไม่แตะ (เส้นทางเงินบาทเดิมเหมือนเดิมทุกประการ) · USD ใช้ record_trade_fx ฟังก์ชันใหม่ · แลกเงินใช้ record_fx_exchange
--  * fx_rates: อัตราที่ผู้ใช้กรอก ผูกกับบัญชี USD (cascade ตามบัญชี → ฟังก์ชันล้างข้อมูล/ลบบัญชีเดิมทำงานต่อได้โดยไม่ต้องแก้)
--  * fx_exchanges: การแลกเงิน เก็บบาท (สตางค์) และดอลลาร์ (เซนต์) เป็นข้อมูลหลัก rate_micro คำนวณจากสองค่า (R20.2) ผูก Entry (ลบ Entry = ลบแถวตาม)
--  * ผลลงทุน USD ใช้บัญชีชื่อเฉพาะ inv-gain-usd / inv-loss-usd / inv-dividend-usd / inv-wht-usd (สกุล USD) · บัญชีพักอัตรา fx-suspense-thb / fx-suspense-usd (equity ฝั่งละสกุล R16)
--  * เงินสด USD = บัญชี type asset, kind investment, currency USD ที่ไม่ผูกกับสินทรัพย์ใด (ไม่นับใน cashBalance/SAFE-TO-SPEND/RUNWAY ตาม R17/R20)
--  * ตารางใหม่: RLS เจ้าของแถว + ด่านเปลี่ยนรหัส + ล็อกนำเข้า (5 นโยบายต่อตาราง) · anon ไม่มีสิทธิ์ · เพดาน 10,000 แถวต่อผู้ใช้ (กันลบไม่ทัน)
--  * ใส่หลัง 20261114000200

-- ---------------------------------------------------------------------------
-- 1. คอลัมน์ใหม่ (ทุกแถวเดิมได้ค่าตั้งต้น: THB / null)
-- ---------------------------------------------------------------------------
alter table public.assets
  add column instrument_currency text not null default 'THB' check (instrument_currency in ('THB', 'USD')),
  add column ticker text check (ticker is null or char_length(ticker) between 1 and 20),
  add column exchange text check (exchange is null or exchange in ('NYSE', 'NASDAQ', 'OTHER'));

alter table public.trades
  add column fx_rate_micro bigint check (fx_rate_micro is null or (fx_rate_micro > 0 and fx_rate_micro <= 9007199254740991));

-- ---------------------------------------------------------------------------
-- 2. สินทรัพย์: บัญชีลงทุนต้องสกุลเดียวกับสินทรัพย์ (แทนฉบับเดิมที่บังคับ THB · ผลกับสินทรัพย์ THB เหมือนเดิม) · สกุลของสินทรัพย์เปลี่ยนไม่ได้
-- ---------------------------------------------------------------------------
create or replace function private.assets_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.accounts a
     where a.user_id = new.user_id and a.id = new.account_id
       and a.kind = 'investment' and a.type = 'asset' and a.currency = new.instrument_currency
  ) then
    raise exception 'บัญชีของสินทรัพย์ต้องเป็นบัญชีลงทุนสกุลเดียวกับสินทรัพย์' using errcode = '23514';
  end if;
  return new;
end
$$;

create function private.assets_currency_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if new.instrument_currency is distinct from old.instrument_currency
     and current_user not in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    raise exception 'สกุลของสินทรัพย์เปลี่ยนไม่ได้ ให้สร้างสินทรัพย์ใหม่' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger assets_currency_guard_trg
before update of instrument_currency on public.assets
for each row execute function private.assets_currency_guard();

-- ---------------------------------------------------------------------------
-- 3. รายการลงทุน: อัตราแลกเปลี่ยนต้องสอดคล้องกับสกุลของสินทรัพย์
--    (trigger แยก ไม่แก้ trades_insert_guard เดิม · ทำงานก่อน trades_insert_guard_trg ตามลำดับชื่อ)
-- ---------------------------------------------------------------------------
create function private.trades_fx_guard() returns trigger
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

create trigger trades_fx_guard_trg
before insert on public.trades
for each row execute function private.trades_fx_guard();

-- ---------------------------------------------------------------------------
-- 4. fx_rates: อัตราที่ผู้ใช้กรอก (ผูกบัญชี USD) · หนึ่งอัตราต่อบัญชีต่อวัน
-- ---------------------------------------------------------------------------
create table public.fx_rates (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id text not null,
  date date not null check (date between date '1900-01-01' and date '2999-12-31'),
  -- บาทต่อ 1 USD x 10^6 (R10/R20.2)
  rate_micro bigint not null check (rate_micro > 0 and rate_micro <= 9007199254740991),
  primary key (user_id, account_id, date),
  foreign key (user_id, account_id) references public.accounts (user_id, id) on delete cascade
);

create function private.fx_rates_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.accounts a
     where a.user_id = new.user_id and a.id = new.account_id and a.kind = 'investment' and a.type = 'asset' and a.currency = 'USD'
  ) then
    raise exception 'อัตราแลกเปลี่ยนต้องผูกกับบัญชีลงทุนสกุล USD' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger fx_rates_guard_trg
before insert or update of account_id on public.fx_rates
for each row execute function private.fx_rates_guard();

-- ---------------------------------------------------------------------------
-- 5. fx_exchanges: การแลกเงิน (บาทและดอลลาร์เป็นข้อมูลหลัก · อัตราคำนวณจากสองค่า) ผูก Entry
-- ---------------------------------------------------------------------------
create table public.fx_exchanges (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  date date not null check (date between date '1900-01-01' and date '2999-12-31'),
  created_at timestamptz not null default now()
    check (created_at >= timestamptz '1900-01-01 00:00:00+00' and created_at < timestamptz '3000-01-01 00:00:00+00'),
  -- thb_to_usd = จ่ายบาทได้ดอลลาร์ · usd_to_thb = จ่ายดอลลาร์ได้บาท
  direction text not null check (direction in ('thb_to_usd', 'usd_to_thb')),
  thb_satang bigint not null check (thb_satang >= 1 and thb_satang <= 9007199254740991),
  usd_cents bigint not null check (usd_cents >= 1 and usd_cents <= 9007199254740991),
  -- อัตราอ้างอิง = roundHalfUp(thb_satang x 10^6 / usd_cents) (ปัดครึ่งขึ้นด้วยจำนวนเต็มล้วน ตรงกับ fxRateFromExchange ฝั่งเว็บ)
  rate_micro bigint not null check (
    rate_micro >= 1 and rate_micro <= 9007199254740991
    and rate_micro = div(thb_satang::numeric * 2000000 + usd_cents::numeric, usd_cents::numeric * 2)
  ),
  memo text not null default '' check (char_length(memo) <= 2000),
  entry_id text not null,
  primary key (user_id, id),
  foreign key (user_id, entry_id) references public.entries (user_id, id) on delete cascade
);
create index fx_exchanges_user_date_idx on public.fx_exchanges (user_id, date);

-- เพิ่มได้เฉพาะผ่าน record_fx_exchange (หรือนำเข้า/ผู้ดูแล) · แก้ได้เฉพาะหมายเหตุ · ลบตรงๆ ไม่ได้ (ลบผ่านการลบ Entry: cascade ทำงานด้วยสิทธิ์เจ้าของตาราง)
create function private.fx_exchanges_insert_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if coalesce(current_setting('app.invest_import', true), '') = 'on'
     or current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return new;
  end if;
  if coalesce(current_setting('app.record_fx_exchange', true), '') is distinct from new.id then
    raise exception 'รายการแลกเงินต้องบันทึกผ่านหน้าพอร์ตเท่านั้น' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger fx_exchanges_insert_guard_trg
before insert on public.fx_exchanges
for each row execute function private.fx_exchanges_insert_guard();

create function private.fx_exchanges_update_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return new;
  end if;
  if (to_jsonb(new) - 'memo') is distinct from (to_jsonb(old) - 'memo') then
    raise exception 'แก้รายการแลกเงินไม่ได้ (แก้ได้เฉพาะหมายเหตุ) ให้ลบรายการในสมุดแล้วบันทึกใหม่' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger fx_exchanges_update_guard_trg
before update on public.fx_exchanges
for each row execute function private.fx_exchanges_update_guard();

create function private.fx_exchanges_delete_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return old;
  end if;
  raise exception 'รายการแลกเงินลบได้ผ่านการลบรายการในสมุดเท่านั้น' using errcode = '23514';
end
$$;

create trigger fx_exchanges_delete_guard_trg
before delete on public.fx_exchanges
for each row execute function private.fx_exchanges_delete_guard();

-- ---------------------------------------------------------------------------
-- 6. เพดานแถวต่อผู้ใช้ (ฟังก์ชันเดิมรองรับตารางใดก็ได้: เพดาน 10,000) · RLS · สิทธิ์
-- ---------------------------------------------------------------------------
create trigger fx_rates_limit_trg after insert on public.fx_rates
  referencing new table as new_rows for each statement execute function private.enforce_invest_limits();
create trigger fx_exchanges_limit_trg after insert on public.fx_exchanges
  referencing new table as new_rows for each statement execute function private.enforce_invest_limits();

do $$
declare
  t text;
begin
  foreach t in array array['fx_rates', 'fx_exchanges'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I as permissive for all to authenticated '
      'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using ((select private.can_use_data())) with check ((select private.can_use_data()))',
      t || '_gate', t);
  end loop;
end
$$;

do $do$
declare
  t text;
  c text := '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''';
begin
  foreach t in array array['fx_rates', 'fx_exchanges'] loop
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', t || '_import_lock_ins', t, c);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t || '_import_lock_upd', t, c, c);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', t || '_import_lock_del', t, c);
  end loop;
end
$do$;

revoke all on public.fx_rates, public.fx_exchanges from public, anon, authenticated;
grant select, insert, update, delete on public.fx_rates, public.fx_exchanges to authenticated;

-- ---------------------------------------------------------------------------
-- 7. record_trade_fx: บันทึกซื้อ/ขาย/ปันผลของสินทรัพย์สกุล USD พร้อม Entry ในธุรกรรมเดียว (อะตอมมิก)
--    รูปแบบเดียวกับ record_trade (ฉบับ hardening) · ต่างที่: สินทรัพย์ต้องเป็น USD · บัญชีเป็นสกุล USD (เงินสด USD = บัญชีลงทุนที่ไม่ผูกสินทรัพย์)
--    · ต้องมี fxRateMicro · บัญชีผลลงทุนเป็น inv-*-usd · ไม่รองรับ reinvest
-- ---------------------------------------------------------------------------
create function public.record_trade_fx(p_trade jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
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
    v_based := (p_trade->>'basedOn')::integer;
    select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = p_trade->>'assetId';
    if v_count <> v_based then
      raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดหน้าใหม่แล้วลองอีกครั้ง' using errcode = '40001';
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

revoke all on function public.record_trade_fx(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_trade_fx(jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. record_fx_exchange: แลกเงิน THB <-> USD พร้อม Entry 4 บรรทัดในธุรกรรมเดียว
--    บรรทัด: กระเป๋าเงินบาท · บัญชีพักอัตรา (บาท) · เงินสด USD · บัญชีพักอัตรา (USD) · ผลรวมต่อสกุล = 0 (R16)
-- ---------------------------------------------------------------------------
create function public.record_fx_exchange(p_exchange jsonb, p_entry jsonb, p_accounts jsonb default '[]'::jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_acc jsonb;
  v_id text;
  v_dir text := p_exchange->>'direction';
  v_thb numeric := (p_exchange->>'thbSatang')::numeric;
  v_usd numeric := (p_exchange->>'usdCents')::numeric;
  v_rate numeric;
  v_unknown integer;
  v_lines integer;
  s_wallet numeric;
  s_fxthb numeric;
  s_cash numeric;
  s_fxusd numeric;
  n_wallet integer;
  n_fxthb integer;
  n_cash integer;
  n_fxusd integer;
begin
  if v_user is null then
    raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000';
  end if;
  if not private.can_use_data() then
    raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501';
  end if;
  if jsonb_typeof(p_exchange) is distinct from 'object' or jsonb_typeof(p_entry) is distinct from 'object'
     or jsonb_typeof(coalesce(p_accounts, '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(p_entry->'lines') is distinct from 'array' then
    raise exception 'รูปแบบข้อมูลไม่ถูกต้อง' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_accounts, '[]'::jsonb)) > 2 or jsonb_array_length(p_entry->'lines') <> 4 then
    raise exception 'รายการแลกเงินต้องมี 4 บรรทัดและสร้างบัญชีพักได้ไม่เกิน 2 บัญชี' using errcode = '22023';
  end if;
  if v_dir not in ('thb_to_usd', 'usd_to_thb') then
    raise exception 'ทิศทางการแลกเงินไม่ถูกต้อง' using errcode = '22023';
  end if;
  if v_thb is null or v_usd is null or v_thb < 1 or v_usd < 1 or v_thb <> trunc(v_thb) or v_usd <> trunc(v_usd)
     or v_thb > 9007199254740991 or v_usd > 9007199254740991 then
    raise exception 'จำนวนเงินที่แลกต้องเป็นจำนวนเต็มสตางค์/เซนต์ตั้งแต่ 1' using errcode = '22023';
  end if;
  if (p_entry->>'date') is distinct from (p_exchange->>'date') then
    raise exception 'วันที่ของรายการในสมุดต้องตรงกับรายการแลกเงิน' using errcode = '22023';
  end if;
  if coalesce(p_entry->>'source', 'manual') <> 'manual' then
    raise exception 'รายการแลกเงินใช้ชนิดรายการ manual เท่านั้น' using errcode = '22023';
  end if;
  v_rate := div(v_thb * 2000000 + v_usd, v_usd * 2);
  if v_rate < 1 then
    raise exception 'อัตราแลกเปลี่ยนที่คำนวณได้ต่ำกว่า 0.000001 บาทต่อดอลลาร์' using errcode = '22023';
  end if;

  for v_acc in select * from jsonb_array_elements(coalesce(p_accounts, '[]'::jsonb)) loop
    v_id := v_acc->>'id';
    if v_id is null or v_id not in ('fx-suspense-thb', 'fx-suspense-usd') then
      raise exception 'สร้างบัญชีนี้ผ่านรายการแลกเงินไม่ได้' using errcode = '22023';
    end if;
    insert into public.accounts (user_id, id, type, name, currency, kind)
    values (
      v_user, v_id, 'equity',
      case v_id when 'fx-suspense-thb' then 'บัญชีพักอัตราแลกเปลี่ยน (บาท)' else 'บัญชีพักอัตราแลกเปลี่ยน (USD)' end,
      case v_id when 'fx-suspense-thb' then 'THB' else 'USD' end, 'normal'
    ) on conflict (user_id, id) do nothing;
  end loop;

  select
    coalesce(sum(c.amt) filter (where c.cls = 'wallet'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'fxthb'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'cash'), 0),
    coalesce(sum(c.amt) filter (where c.cls = 'fxusd'), 0),
    count(*) filter (where c.cls = 'wallet'),
    count(*) filter (where c.cls = 'fxthb'),
    count(*) filter (where c.cls = 'cash'),
    count(*) filter (where c.cls = 'fxusd'),
    count(*) filter (where c.cls = 'unknown')
  into s_wallet, s_fxthb, s_cash, s_fxusd, n_wallet, n_fxthb, n_cash, n_fxusd, v_unknown
  from (
    select l.amt,
      case
        when l.acc = 'fx-suspense-thb' and a.type = 'equity' and a.currency = 'THB' then 'fxthb'
        when l.acc = 'fx-suspense-usd' and a.type = 'equity' and a.currency = 'USD' then 'fxusd'
        when l.acc not in ('fx-suspense-thb', 'fx-suspense-usd') and a.type = 'asset' and a.kind = 'normal' and a.currency = 'THB' and not a.archived then 'wallet'
        when l.acc not in ('fx-suspense-thb', 'fx-suspense-usd') and a.type = 'asset' and a.kind = 'investment' and a.currency = 'USD' and not a.archived
             and not exists (select 1 from public.assets s where s.user_id = v_user and s.account_id = a.id) then 'cash'
        else 'unknown'
      end as cls
    from (select l->>'accountId' as acc, (l->>'amount')::numeric as amt from jsonb_array_elements(p_entry->'lines') l) l
    left join public.accounts a on a.user_id = v_user and a.id = l.acc
  ) c;
  if v_unknown > 0 or n_wallet <> 1 or n_fxthb <> 1 or n_cash <> 1 or n_fxusd <> 1 then
    raise exception 'รายการแลกเงินต้องใช้กระเป๋าเงินบาท บัญชีพักบาท เงินสด USD และบัญชีพัก USD อย่างละหนึ่งบรรทัด' using errcode = '23514';
  end if;
  if v_dir = 'thb_to_usd' then
    if s_wallet <> -v_thb or s_fxthb <> v_thb or s_cash <> v_usd or s_fxusd <> -v_usd then
      raise exception 'รายการแลกเงิน (บาทเป็นดอลลาร์) ยอดเงินในสมุดไม่ตรงกับจำนวนที่ระบุ' using errcode = '23514';
    end if;
  else
    if s_wallet <> v_thb or s_fxthb <> -v_thb or s_cash <> -v_usd or s_fxusd <> v_usd then
      raise exception 'รายการแลกเงิน (ดอลลาร์เป็นบาท) ยอดเงินในสมุดไม่ตรงกับจำนวนที่ระบุ' using errcode = '23514';
    end if;
  end if;

  perform private.insert_entry(p_entry);
  perform set_config('app.record_fx_exchange', p_exchange->>'id', true);
  insert into public.fx_exchanges (id, date, created_at, direction, thb_satang, usd_cents, rate_micro, memo, entry_id)
  values (
    p_exchange->>'id', (p_exchange->>'date')::date, coalesce((p_exchange->>'createdAt')::timestamptz, now()),
    v_dir, v_thb::bigint, v_usd::bigint, v_rate::bigint, coalesce(p_exchange->>'memo', ''), p_entry->>'id'
  );
  perform set_config('app.record_fx_exchange', '', true);
  return jsonb_build_object('exchangeId', p_exchange->>'id', 'entryId', p_entry->>'id', 'rateMicro', v_rate::bigint);
end
$$;

revoke all on function public.record_fx_exchange(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_fx_exchange(jsonb, jsonb, jsonb) to authenticated;
