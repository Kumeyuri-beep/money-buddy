-- พอร์ตลงทุน P2: ป้ายประเภทบัญชี (accounts.kind) + ตาราง assets / trades / asset_prices + RLS
-- แผน docs/plans/2026-11-11-invest-portfolio-dca.md · กฎ R3 R9 R11 R16 R17 (ดู docs/money-rules.md)
-- **ฉบับร่าง (DRAFT) รอเจ้าของอนุมัติก่อนใส่ฐานข้อมูล** · ไม่แตะข้อมูลเดิม: เพิ่มคอลัมน์ที่มีค่าตั้งต้น + ตารางใหม่ (ว่าง)
--
-- ออกแบบ:
--  * accounts.kind: 'normal' (ค่าตั้งต้น ทุกบัญชีเดิม) | 'investment' (บัญชีเก็บต้นทุนสินทรัพย์ลงทุน)
--    บัญชีลงทุนต้องเป็น type = 'asset' · เปลี่ยน kind ของบัญชีที่มีรายการแล้วไม่ได้ (ยอดเงินสดเดิมจะเปลี่ยนเงียบๆ)
--    เว็บต้องไม่นับ kind = 'investment' ใน cashBalance/SAFE-TO-SPEND/RUNWAY (R17 · มีเทสต์ฝั่งเว็บ)
--  * จำนวนหน่วย (units) เก็บเป็น text ของจำนวนเต็ม x 10^8 ไม่เกิน 2^63-1 (R17): supabase-js/PostgREST ส่ง bigint เป็น
--    JSON number ซึ่งเสียความแม่นยำเกิน 2^53 จึงใช้ text (เทียบเลขด้วยความยาวแล้วตัวอักษร ไม่ cast)
--  * ราคาต่อหน่วย = micro-baht (bigint ≤ 2^53-1) · เงิน = สตางค์ (bigint ≤ 2^53-1) ตาม R1
--  * รุ่นแรก THB เท่านั้น (currency = 'THB')
--  * ลบ cascade: ลบผู้ใช้ → ทุกตาราง · ลบบัญชีลงทุน → สินทรัพย์ → รายการ/ราคา · ลบ Entry → รายการลงทุนที่ผูกกับ Entry นั้น
--    (ฟังก์ชันล้างข้อมูล/ลบบัญชี/ยกเลิกนำเข้าเดิมจึงทำงานต่อได้โดยไม่ต้องแก้: ลบ entries → bills → accounts ตามลำดับเดิม)
--  * เพดานแถวต่อผู้ใช้: assets 200 · trades 10,000 · asset_prices 10,000 (กันลบไม่ทัน 8 วินาที · ดูหัวข้อ 2.1)
--  * trades.entry_id: ยังไม่ตรวจว่า Entry เป็นรายการที่ถูกต้อง (ทำ guard ตอน P4 ที่เริ่มผูกจริง)
--  * ข้อมูลมาจากฝั่งผู้ใช้: ตรวจรูปแบบที่ฐานข้อมูล (check) ไม่พึ่งเว็บ · RLS เจ้าของแถว + ด่านเปลี่ยนรหัส เหมือนตารางเดิม

-- ---------------------------------------------------------------------------
-- 1. accounts.kind
-- ---------------------------------------------------------------------------
alter table public.accounts
  add column kind text not null default 'normal' check (kind in ('normal', 'investment'));
alter table public.accounts
  add constraint accounts_investment_is_asset check (kind = 'normal' or type = 'asset');

create or replace function private.accounts_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if (new.type <> old.type or new.currency <> old.currency or new.kind <> old.kind)
     and (exists (select 1 from public.lines l where l.user_id = old.user_id and l.account_id = old.id)
          or exists (select 1 from public.assets s where s.user_id = old.user_id and s.account_id = old.id)) then
    raise exception 'เปลี่ยนชนิด สกุลเงิน หรือประเภทบัญชีที่มีรายการหรือสินทรัพย์ผูกอยู่แล้วไม่ได้' using errcode = '23514';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. ตารางลงทุน
-- ---------------------------------------------------------------------------
create table public.assets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 200),
  kind text not null default 'fund' check (kind in ('fund', 'stock', 'other')),
  currency text not null default 'THB' check (currency = 'THB'),
  -- บัญชีลงทุนที่เก็บต้นทุนของสินทรัพย์นี้ (หนึ่งสินทรัพย์ต่อหนึ่งบัญชี)
  account_id text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, account_id),
  foreign key (user_id, account_id) references public.accounts (user_id, id) on delete cascade
);

-- บัญชีของสินทรัพย์ต้องเป็นบัญชีลงทุนสกุลบาท (FK ธรรมดาตรวจประเภทไม่ได้)
create function private.assets_guard() returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.accounts a
     where a.user_id = new.user_id and a.id = new.account_id
       and a.kind = 'investment' and a.type = 'asset' and a.currency = 'THB'
  ) then
    raise exception 'บัญชีของสินทรัพย์ต้องเป็นบัญชีลงทุนสกุลบาท' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger assets_guard_trg
before insert or update of account_id on public.assets
for each row execute function private.assets_guard();

create table public.trades (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 100),
  asset_id text not null,
  -- buy = ซื้อ · sell = ขาย · dividend = ปันผลเป็นเงินสด · reinvest = ปันผลลงทุนต่อ (หน่วยเพิ่ม ไม่มีเงินสด)
  kind text not null check (kind in ('buy', 'sell', 'dividend', 'reinvest')),
  date date not null check (date between date '1900-01-01' and date '2999-12-31'),
  created_at timestamptz not null default now(),
  -- จำนวนหน่วย x 10^8 เป็น text ของจำนวนเต็มบวก ไม่ขึ้นต้นด้วย 0 ไม่เกิน 9223372036854775807 (R17)
  units text check (
    units is null or (
      units ~ '^[1-9][0-9]{0,18}$'
      and (char_length(units) < 19 or units collate "C" <= '9223372036854775807')
    )
  ),
  -- ราคาต่อหน่วย micro-baht (ขายต้องมี · ซื้อมีเพื่อแสดงผลได้)
  price_micro bigint check (price_micro is null or (price_micro > 0 and price_micro <= 9007199254740991)),
  -- เงินที่เกี่ยวข้อง (สตางค์): ซื้อ = มูลค่าซื้อ A · ปันผล = ยอดปันผล D · ปันผลลงทุนต่อ = D−W (ต้นทุนที่เพิ่ม)
  amount bigint check (amount is null or (amount >= 1 and amount <= 9007199254740991)),
  -- ค่าธรรมเนียม (สตางค์ ≥ 0): ซื้อรวมเข้าต้นทุน · ขายหักจากเงินที่ได้
  fee bigint not null default 0 check (fee >= 0 and fee <= 9007199254740991),
  -- ภาษีหัก ณ ที่จ่ายของปันผล (สตางค์ ≥ 0)
  withholding bigint not null default 0 check (withholding >= 0 and withholding <= 9007199254740991),
  memo text not null default '' check (char_length(memo) <= 2000),
  -- รายการในสมุดบัญชีคู่ที่ผูกกับรายการลงทุนนี้ (ใช้ใน P4) ลบ Entry = ลบรายการลงทุนที่ผูก
  entry_id text,
  primary key (user_id, id),
  foreign key (user_id, asset_id) references public.assets (user_id, id) on delete cascade,
  foreign key (user_id, entry_id) references public.entries (user_id, id) on delete cascade,
  constraint trades_buy_shape check (
    kind <> 'buy' or (units is not null and amount is not null and withholding = 0)
  ),
  constraint trades_sell_shape check (
    kind <> 'sell' or (units is not null and price_micro is not null and amount is null and withholding = 0)
  ),
  constraint trades_dividend_shape check (
    kind <> 'dividend' or (units is null and price_micro is null and amount is not null and fee = 0 and withholding < amount)
  ),
  constraint trades_reinvest_shape check (
    kind <> 'reinvest' or (units is not null and amount is not null and fee = 0 and withholding = 0)
  )
);
create index trades_user_asset_date_idx on public.trades (user_id, asset_id, date);
create index trades_user_entry_idx on public.trades (user_id, entry_id) where entry_id is not null;

-- ราคาล่าสุดที่ผู้ใช้กรอกเอง (ไม่ดึงจากเว็บ) · หนึ่งราคาต่อสินทรัพย์ต่อวัน
create table public.asset_prices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asset_id text not null,
  date date not null check (date between date '1900-01-01' and date '2999-12-31'),
  price_micro bigint not null check (price_micro > 0 and price_micro <= 9007199254740991),
  primary key (user_id, asset_id, date),
  foreign key (user_id, asset_id) references public.assets (user_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- 2.1 เพดานจำนวนแถวต่อผู้ใช้ (ผลตรวจ security-auditor ข้อ 1): ฟังก์ชันล้างข้อมูล/ลบบัญชีลบตารางเหล่านี้ตามลำดับท้ายๆ
--     ในคำสั่งเดียว ถ้าไม่มีเพดานผู้ใช้สร้างแถวได้ไม่จำกัดจนลบไม่ทันเพดานเวลา 8 วินาทีของ authenticated (ลบข้อมูลตาม PDPA ไม่ได้)
--     ตรวจระดับคำสั่ง (นับครั้งเดียวต่อคำสั่ง ไม่ใช่ต่อแถว) · เพดานอาจเกินได้เล็กน้อยเมื่อสองคำสั่งเขียนพร้อมกัน ไม่กระทบเป้าหมาย
-- ---------------------------------------------------------------------------
create function private.enforce_invest_limits() returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_cap integer := case tg_table_name when 'assets' then 200 else 10000 end;
  v_user uuid;
  v_n bigint;
begin
  for v_user in select distinct user_id from new_rows loop
    execute format('select count(*) from public.%I where user_id = $1', tg_table_name) into v_n using v_user;
    if v_n > v_cap then
      raise exception 'จำนวนข้อมูลลงทุนเกินเพดาน (% แถวต่อผู้ใช้ในตาราง %)', v_cap, tg_table_name using errcode = '54000';
    end if;
  end loop;
  return null;
end
$$;

create trigger assets_limit_trg after insert on public.assets
  referencing new table as new_rows for each statement execute function private.enforce_invest_limits();
create trigger trades_limit_trg after insert on public.trades
  referencing new table as new_rows for each statement execute function private.enforce_invest_limits();
create trigger asset_prices_limit_trg after insert on public.asset_prices
  referencing new table as new_rows for each statement execute function private.enforce_invest_limits();

-- ---------------------------------------------------------------------------
-- 3. RLS: เจ้าของแถวเท่านั้น + ต้องเปลี่ยนรหัสแล้ว (restrictive) · anon ไม่มีสิทธิ์ เหมือนตารางเดิม
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['assets', 'trades', 'asset_prices'] loop
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

-- ขณะเซสชันนำเข้าเปิด เขียนข้อมูลได้เฉพาะทางนำเข้า (เหมือนห้าตารางเดิมใน 20261109000200) · ฟังก์ชัน security definer ไม่ติดนโยบายนี้
do $do$
declare
  t text;
  c text := '(not (select private.import_session_exists())) or coalesce(current_setting(''app.import_ledger'', true), '''') = ''on''';
begin
  foreach t in array array['assets', 'trades', 'asset_prices'] loop
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (%s)', t || '_import_lock_ins', t, c);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (%s) with check (%s)', t || '_import_lock_upd', t, c, c);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (%s)', t || '_import_lock_del', t, c);
  end loop;
end
$do$;

revoke all on public.assets, public.trades, public.asset_prices from public, anon, authenticated;
grant select, insert, update, delete on public.assets, public.trades, public.asset_prices to authenticated;
