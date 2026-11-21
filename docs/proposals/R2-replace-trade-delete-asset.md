# ข้อเสนอ R2-2: แก้ไขรายการที่บันทึกแล้ว (`replace_trade`) + ลบสินทรัพย์ (`delete_asset`)

สถานะ: **ร่าง รออนุมัติจากเจ้าของ · ยังไม่แก้โค้ด ไม่รัน migration ไม่แตะ `docs/money-rules.md`** (เจ้าของสั่ง 21 พ.ย. 2569 ขั้นที่ 0)
ต่อยอดข้อตัดสินใน `docs/proposals/edit-recorded-transactions.md` (#238 · เจ้าของตัดสินแล้ว 20 พ.ย. 2569): **กลับรายการเดิม + ลงรายการใหม่ในธุรกรรมเดียว · ห้ามแก้รายการซื้อที่มีรายการขายตามหลัง (R17) · วันที่เดิมคงลำดับเดิม**
งานนี้แตะฐานข้อมูล จึงเป็นงานของ GM (migration แบบ "เพิ่ม" `create function` + GRANT → ต้องรันเทสต์ SQL ครบทุกไฟล์ · dry-run rollback · `admin:live-contract` บน branch และบน `main`)

## 1. สิ่งที่สำรวจพบในฐานข้อมูล (มีผลต่อการออกแบบ)
| จุด | ที่มา | ผลต่อ `replace_trade` |
|---|---|---|
| รายการซื้อขายที่ผูกสมุด ลบตรงๆ ไม่ได้ ต้องลบ **Entry** ที่ผูก (ลบตามแบบ cascade) | `trades_delete_guard` · `entries_trade_guard` (hardening 20261111000400, fx lock 20261115000200) | ฟังก์ชันลบ Entry เดิม แล้วลงรายการใหม่ในธุรกรรมเดียว (วิธีเดียวกับ `deleteTrade` ที่ใช้อยู่และผ่าน live-contract) |
| ด่านลบ `trade_delete_problem`: ซื้อที่วันที่ ≤ วันขายล่าสุดลบไม่ได้ · ขายลบได้เฉพาะรายการขายล่าสุด · ปันผลลบได้เสมอ | `20261111000300_invest_ledger.sql` | ใช้กฎชุดเดียวกันเป็นเงื่อนไข "แก้ได้" → ตรงกับข้อตัดสินข้อ 1 (R17) โดยไม่ต้องแก้ R17 |
| ด่านลงใหม่ `trades_insert_guard`: ซื้อ/ขาย/ปันผลลงทุนต่อ ต้องลงวันที่ **หลัง** (>) วันขายล่าสุด · ขายต้องไม่เกินหน่วยที่ถือ · ค่าธรรมเนียมขายไม่เกินเงินที่ขายได้ | hardening 20261111000400 | รายการใหม่ผ่านด่านนี้เอง จึงเลื่อนวันซื้อไปก่อนรายการขายล่าสุดไม่ได้ |
| `record_trade` (THB) / `record_trade_fx` (USD) ตรวจสมดุล Entry · ผลรวมศูนย์ต่อสกุล (R16) · เงินสด USD · `basedOn` · เพดานขนาดข้อมูล · รับ `createdAt` ในข้อมูลรายการ | 20261111000400 / 20261115000100 | `replace_trade` เรียกฟังก์ชันเดิมแทนเขียนตรรกะซ้ำ → ทุกการตรวจ R16/R17/R20 ใช้ของเดิม |
| คอลัมน์ `trades.created_at` กำหนดลำดับในวันเดียวกัน (date, created_at, id) | `trade_delete_problem` / เล่นซ้ำ | ถ้าวันที่ไม่เปลี่ยน ส่ง `createdAt` เดิมไปด้วย → ลำดับเดิมคงอยู่ (ข้อตัดสินข้อ 2) |
| `trades_update_guard`: แก้ตรงๆ ได้เฉพาะ memo | hardening | ไม่เปลี่ยน (แก้ผ่าน `replace_trade` เท่านั้น) |

## 2. กฎ "แก้ได้" (บังคับที่ฐานข้อมูล · เหมือน R17 เดิม)
| ชนิดรายการ | แก้ได้เมื่อ | ข้อความปฏิเสธ (errcode 23514) |
|---|---|---|
| ซื้อ (`buy`) / ปันผลลงทุนต่อ (`reinvest`) | ไม่มีรายการขายของหุ้นนั้นที่วันที่ ≥ วันของรายการนี้ | "ลบรายการขายหลังจากนั้นก่อน" |
| ขาย (`sell`) | เป็นรายการขายล่าสุดของหุ้นนั้น (date, created_at, id) | "แก้ได้เฉพาะรายการขายล่าสุด" |
| ปันผลเงินสด (`dividend`) | เสมอ (ไม่กระทบต้นทุน) | — |
| แลกเงิน (`fx_exchanges`) · ฝาก/ถอนเงินสด | **ไม่อยู่ในรอบนี้** (ลบแล้วลงใหม่เหมือนเดิม) | — |
- แก้ได้: จำนวน ราคา วันที่ ค่าธรรมเนียม ภาษีหัก อัตรา หมายเหตุ · **เปลี่ยนชนิดรายการ (ซื้อ ↔ ขาย) หรือย้ายไปหุ้นอื่นไม่ได้** (ให้ลบแล้วลงใหม่)
- รายการเก่าที่ไม่ผูกสมุด (`entry_id` ว่าง · ข้อมูลสกุลบาทยุคแรก) ฟังก์ชันนี้ปฏิเสธ (ข้อ 7 ข้อ 1 ให้เจ้าของยืนยัน)

## 3. ร่าง SQL `replace_trade` (ยังไม่ได้รัน ยังไม่ได้ทดสอบ · ปรับตามผล security-auditor 21 พ.ย. 2569)
```sql
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
  if jsonb_typeof(p_trade) is distinct from 'object' or jsonb_typeof(p_entry) is distinct from 'object'
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

  -- basedOn: จำนวนรายการของสินทรัพย์นี้ตอนผู้ใช้เปิดฟอร์มแก้ ตรวจก่อนลบ (ไม่บังคับ แต่หน้าจอส่งเสมอ · ใช้จับการเพิ่ม/ลบรายการอื่นระหว่างแก้ ส่วนการแก้รายการเดียวกันซ้อนจับด้วยการล็อก + row_count)
  if p_based_on is not null then
    select count(*) into v_count from public.trades t where t.user_id = v_user and t.asset_id = v_old.asset_id;
    if v_count <> p_based_on then raise exception 'ข้อมูลของสินทรัพย์นี้เปลี่ยนไปในระหว่างทำรายการ (อาจเปิดหลายหน้าต่าง) โหลดใหม่แล้วลองอีกครั้ง' using errcode = '40001'; end if;
  end if;
  -- ช่องทางตรวจ basedOn มีช่องเดียวคือพารามิเตอร์ p_based_on (ถ้าเว็บส่ง basedOn มาใน p_trade ปฏิเสธ ไม่ตัดทิ้งเงียบๆ)
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

  -- วันที่ไม่เปลี่ยน → คงลำดับเดิมในวันนั้น (ข้อตัดสินใจ #238 ข้อ 2)
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
```
ข้อสังเกตของร่าง: (ก) ความเป็นอะตอม = ฟังก์ชัน plpgsql ธุรกรรมเดียว ถ้า `record_trade_fx` โยนข้อผิดพลาด การลบ Entry เดิมย้อนกลับด้วย · (ข) `security invoker` → RLS และด่านเปลี่ยนรหัสบังคับใช้เหมือนเดิม ไม่มีทางแก้รายการของคนอื่น · (ค) **กันแก้รายการเดียวกันซ้อนสองแท็บ:** ล็อกสินทรัพย์ก่อนแล้วอ่านรายการเดิมแบบ `for update` + ตรวจ `row_count = 1` หลังลบ (เดิมร่างอ่านก่อนล็อก ทำให้แท็บที่รอล็อกใช้ข้อมูลเก่าแล้วลงรายการซ้ำได้โดย `basedOn` จับไม่ได้) · (ง) ต้องยืนยันด้วยเทสต์ว่าการลบ Entry ในฟังก์ชันผ่าน `lines_trade_guard` (cascade ลบบรรทัด) เหมือนทาง `deleteTrade` เดิม · (จ) ส่ง `p_entry.id` เดิมซ้ำได้เพราะลบแล้ว หรือสร้างรหัสใหม่ก็ได้ (หน้าจอใช้รหัสใหม่) · (ฉ) ระหว่างเซสชันนำเข้าเปิดอยู่ ล้มด้วย 55000 ตรงๆ ไม่พึ่งการกรองเงียบของนโยบาย RLS · (ช) ต้องเพิ่มช่องทางทดสอบ `record_trade` (THB) ผ่านฟังก์ชันนี้ด้วยแม้หน้าจอรอบนี้เน้น USD

## 3.1 ผลตรวจจากผู้ตรวจ 21 พ.ย. 2569 ที่แก้ในร่างแล้ว
- **money-auditor (ร้ายแรง):** ร่างแรกอ่านรายการเดิมก่อนล็อกสินทรัพย์ ทำให้กดยืนยันซ้ำ/เปิดสองแท็บแล้วเกินรายการซื้อซ้ำและหักกระเป๋า 2 เท่า (`basedOn` จับไม่ได้เพราะลบ 1 เพิ่ม 1) → แก้เป็น ล็อกสินทรัพย์ → อ่านรายการเดิมแบบ `for update` → ตรวจ `row_count = 1` หลังลบ + เทสต์สองเซสชัน
- **security-auditor (กลาง):** ตรวจ import session ตรงๆ (55000) · ตรวจชนิดและขนาด JSON ก่อน cast · ตรวจ `row_count` ของ delete
- เทสต์เพิ่มที่ผู้ตรวจแนะนำ: แก้รายการเดิมซ้ำสองรอบแล้วรอบสองต้องล้ม · ซื้อ USD ที่ `Cthb` ปัดเป็น 0 ต้องย้อนกลับทั้งหมด · ย้ายวันที่ของขายล่าสุดข้ามซื้อที่อยู่ระหว่างกลางแล้วต้นทุนที่ตัดออกต้องตรงการเล่นซ้ำใหม่ · หน้าจอแก้รายการขายล่าสุด: คำนวณ `costOut` จากการเล่นซ้ำ **ที่ไม่รวมรายการขายเดิม**

## 4. ผลต่อต้นทุนเฉลี่ย (R11/R17) และ R20
- ต้นทุนเฉลี่ยและต้นทุนบาท 2 ถัง (R20.3) **คำนวณจากการเล่นซ้ำรายการ ไม่เก็บยอด** → แก้ซื้อแล้ว `Cusd`, `Cthb`, ต้นทุนเฉลี่ยต่อหุ้นเปลี่ยนตามอัตโนมัติ ไม่มีค่าต้องแก้ตาม
- แก้ซื้อ "ล่าสุด" ที่ไม่มีขายตามหลัง: Entry ขายเดิมไม่มี (ไม่มีขายหลังวันนั้น) จึงไม่มี Entry ขายที่ต้องคำนวณใหม่
- แก้รายการขายล่าสุด: Entry ขายใหม่ถูกสร้างจากตัวสร้างเดิมของหน้าจอด้วยต้นทุนที่ตัดออกจากการเล่นซ้ำตอนนั้น (ซื้อก่อนหน้าไม่เปลี่ยน) · รายการซื้อหลังวันขายล่าสุดเป็นต่อจากต้นทุนที่เหลือใหม่โดยอัตโนมัติ
- R20.3 "ปฏิเสธรายการซื้อที่ต้นทุนบาทปัดเป็น 0" ตรวจซ้ำกับค่าใหม่ในฟังก์ชันเดิม
- R24 6 แหล่งกำไรรวมเท่า P ตรงเป๊ะหลังแก้ (แหล่ง (5) เป็นส่วนที่เหลือ) ต้องมีเทสต์
- เงินสด USD: แก้รายการซื้อ/ขายเปลี่ยนเงินสดที่หัก/รับ · เงินสดติดลบได้แต่ต้องมีคำเตือนบนหน้าจอ (ตามข้อตัดสินเดิม HANDOFF §94)
- R25 ผลตอบแทนคำนวณจากรายการ จึงตามค่าใหม่เองและไม่รวมเงินสด (เทสต์ไม่ต้องเพิ่ม · มีเทสต์ invariance แล้ว)

## 5. `delete_asset` (ลบสินทรัพย์)
**สถานะปัจจุบัน:** ไม่มี API ลบสินทรัพย์ในเว็บ · ตาราง `assets` อนุญาตลบตรงๆ ตาม RLS แต่ด่าน `assets_delete_guard` ห้ามเมื่อยังมีรายการผูกสมุด (ทำให้หุ้นค้างในตารางเมื่อลบรายการหมดแล้ว)
**ข้อควรระวังที่พบ:** บัญชีต้นทุนของสินทรัพย์ (`kind=investment`) ถ้าปล่อยค้างหลังลบสินทรัพย์ จะถูกหน้า Cash ตีความเป็น "บัญชีเงินสด" (บัญชีลงทุนที่ไม่ผูกสินทรัพย์) → ต้องลบบัญชีต้นทุนด้วยในธุรกรรมเดียวกัน
**เงื่อนไข:** ลบได้เมื่อสินทรัพย์ **ไม่เหลือรายการเลย** (ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ ทุกชนิด) และบัญชีต้นทุนไม่มีบรรทัดในสมุด · ราคา (`asset_prices`) ลบตามเป็น cascade · ผู้ใช้ต้องกดยืนยันที่หน้าจอ
```sql
create function public.delete_asset(p_asset_id text) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_acc text; v_n integer;
begin
  if v_user is null then raise exception 'ต้องเข้าสู่ระบบ' using errcode = '28000'; end if;
  if not private.can_use_data() then raise exception 'ต้องเปลี่ยนรหัสผ่านก่อน' using errcode = '42501'; end if;
  if private.import_session_exists() then raise exception 'กำลังนำเข้าข้อมูล ทำรายการนี้ไม่ได้ในตอนนี้' using errcode = '55000'; end if;
  select a.account_id into v_acc from public.assets a where a.user_id = v_user and a.id = p_asset_id for update;
  if not found then raise exception 'ไม่พบสินทรัพย์' using errcode = '23503'; end if;
  if exists (select 1 from public.trades t where t.user_id = v_user and t.asset_id = p_asset_id) then
    raise exception 'สินทรัพย์นี้ยังมีรายการซื้อขายหรือปันผล ลบรายการทั้งหมดก่อน' using errcode = '23514';
  end if;
  if exists (select 1 from public.fx_rates r where r.user_id = v_user and r.account_id = v_acc) then
    raise exception 'มีอัตราแลกเปลี่ยนผูกกับบัญชีต้นทุนของสินทรัพย์นี้ (ข้อมูลผิดปกติ) ลบไม่ได้' using errcode = '23514';  -- บล็อก ไม่ลบเงียบๆ ผ่าน cascade
  end if;
  if exists (select 1 from public.lines l where l.user_id = v_user and l.account_id = v_acc) then
    raise exception 'บัญชีต้นทุนของสินทรัพย์นี้ยังมีรายการในสมุดบัญชี' using errcode = '23514';
  end if;
  delete from public.assets where user_id = v_user and id = p_asset_id;      -- ราคาลบตาม (cascade) · หมวดไม่มี FK ย้อน
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ลบสินทรัพย์ไม่สำเร็จ' using errcode = '55000'; end if;
  delete from public.accounts where user_id = v_user and id = v_acc;         -- บัญชีต้นทุน (ไม่มีบรรทัดแล้ว)
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ลบบัญชีต้นทุนของสินทรัพย์ไม่สำเร็จ' using errcode = '55000'; end if;
  return jsonb_build_object('assetId', p_asset_id, 'accountId', v_acc);
end $$;
revoke all on function public.delete_asset(text) from public, anon, authenticated;
grant execute on function public.delete_asset(text) to authenticated;
```
ข้อสังเกต: (ก) ลบ `assets` ก่อน `accounts` เพราะ FK `assets → accounts on delete cascade` (ถ้าลบบัญชีก่อน สินทรัพย์จะถูกลบตามอยู่แล้ว แต่ลำดับนี้ชัดเจนและตรวจเงื่อนไขได้) · (ข) ผลตรวจ money-auditor: ไม่พบสิ่งอื่นอ้างบัญชีต้นทุนที่ทำให้ลบไม่ได้นอกจาก `lines` (`bills` อ้างบัญชีกระเป๋า/หมวด · `fx_exchanges` ผูก Entry · `fx_rates` ผูกบัญชีเงินสด) แต่ `fx_rates_guard` ยอมให้ผูกกับบัญชีลงทุน USD ใดก็ได้ จึงกำหนดให้ **บล็อก** ถ้ามีอัตราผูกกับบัญชีต้นทุน (ข้อมูลผิดปกติ) แทนที่จะลบเงียบ · บัญชีเงินสดและบัญชีพัก `inv-*` ที่เหลืออยู่โดยตั้งใจ ไม่ถูกลบ · ฝั่งเว็บแปลงข้อผิดพลาด FK ดิบเป็นข้อความไทย · (ค) ถ้าลบบัญชีไม่ได้เพราะมีสิ่งอ้างอิง ให้ทั้งฟังก์ชันล้ม (ไม่ลบครึ่งเดียว)

## 6. ฝั่งเว็บและเทสต์
- repository: `replaceTrade(oldId, input)` และ `deleteAsset(id)` (Supabase เท่านั้น · ที่เก็บในเครื่องปฏิเสธเหมือนฟังก์ชันลงทุนอื่น) · ใช้ตัวสร้าง Entry เดิมของหน้าจอ (`ledgerLink`/`ledgerLinkFx`) สร้าง `p_entry` ใหม่ เงินทุกตัว BigInt ไม่มีสูตรเงินในคอมโพเนนต์
- UI: ปุ่ม Edit ในตาราง Transactions (ตอนนี้ปิดพร้อมคำอธิบาย) เปิดฟอร์มเดิมของรายการชนิดนั้นพร้อมค่าเดิม · เมนู ⋯ ของ Holdings: "Edit" (ราคา/เรตล่าสุด · เดิม) แยกจากการแก้รายการ · "Delete asset" แสดงเฉพาะหุ้นที่ไม่เหลือรายการ (ที่เหลือรายการ ปุ่มปิดพร้อมคำอธิบาย "Delete its transactions first")
- เทสต์ SQL ไฟล์ใหม่ `supabase/tests/replace_trade_test.sql` + `delete_asset_test.sql`: แก้ซื้อล่าสุดสำเร็จและต้นทุนเฉลี่ยเปลี่ยนตามการเล่นซ้ำ · แก้ซื้อที่มีขายตามหลังถูกปฏิเสธ · แก้ขายล่าสุดสำเร็จ · แก้ขายที่ไม่ใช่ล่าสุดถูกปฏิเสธ · วันที่เดิมคงลำดับ (`created_at` เดิม) · วันที่เปลี่ยนเป็นหลังวันขายล่าสุดผ่าน ก่อนวันขายล่าสุดถูกปฏิเสธ · ขายเกินหน่วยที่ถืออยู่หลังแก้ถูกปฏิเสธและ **ทุกอย่างย้อนกลับ** (รายการเดิมและ Entry เดิมยังอยู่ครบ) · Entry ใหม่ไม่สมดุลถูกปฏิเสธและย้อนกลับ · ผู้ใช้อื่นแก้/ลบรายการหรือสินทรัพย์ของเราไม่ได้ (RLS) · `must_change_password` ได้ 42501 · basedOn ไม่ตรงได้ 40001 · **สองเซสชันแก้รายการเดียวกันพร้อมกัน: ผ่านได้เซสชันเดียว อีกเซสชันได้ 40001 และไม่เกิดรายการซ้ำ** · เรียกระหว่างเซสชันนำเข้าได้ 55000 · JSON เกินเพดานขนาดได้ 22023 · ลบสินทรัพย์ที่มีราคา 10,000 แถวเสร็จในเวลา (< 8 วินาที) · เปลี่ยนชนิด/ย้ายสินทรัพย์ถูกปฏิเสธ · ลบสินทรัพย์ที่ยังมีรายการไม่ได้ (ทุกชนิดรายการ) · ลบสินทรัพย์ว่างสำเร็จและบัญชีต้นทุนหายไป (ไม่ปรากฏในหน้า Cash) · ลบแล้วราคาหาย
- เทสต์หน่วย (TypeScript): แก้ซื้อแล้ว `replayWithFees`/ต้นทุน 2 ถัง/6 แหล่งกำไรตรงตัวอย่างมือ (เพิ่มตัวอย่างมือ 1 ตัวอย่างในเอกสารนี้ตอนทำจริง) · Entry ที่ฟอร์มแก้สร้างสมดุลทุกชนิดรายการ · ปุ่มลบสินทรัพย์ปิดเมื่อยังมีรายการ
- e2e: แก้รายการแล้วต้นทุนเฉลี่ยถูก · ลบสินทรัพย์ที่ยังมีรายการไม่ได้ (ปุ่มปิด + ข้อความ) · ลบรายการทั้งหมดแล้วลบสินทรัพย์ได้
- ฝั่งเว็บต้องแปลง errcode เป็นข้อความของเราเอง **ห้ามแสดงหรือ `console.log` ข้อความ DETAIL/payload ของฐานข้อมูล** (มี user_id และยอดเงิน)
- money-auditor + security-auditor ตรวจทั้งสองฟังก์ชัน (security: RLS ข้ามผู้ใช้ · ไม่มี service_role · security invoker)

## 7. คำถามที่ต้องให้เจ้าของตัดสิน
1. **รายการเก่าที่ไม่ผูกสมุด (`entry_id` ว่าง · สกุลบาทยุคแรก):** ปฏิเสธการแก้ (แนะนำ ลบแล้วลงใหม่เหมือนเดิม) หรือให้แก้ได้ด้วย
2. แก้รายการได้ทั้ง THB และ USD ตั้งแต่รอบนี้ (แนะนำ เพราะฟังก์ชันเรียกตัวเดิมของแต่ละสกุล) หรือเฉพาะ USD ก่อน
