# แผน Invest mode v2 รอบที่ 1 (ร่าง รออนุมัติ)

อ้างอิง: `docs/design/invest-v2/` · ร่างกฎ `docs/proposals/R26-R27.md` · ผลสำรวจด้านล่างมาจากการอ่านโค้ดและ migration ที่มีอยู่ (ยังไม่ได้รันอะไร)

## 1. ผลสำรวจข้อมูลที่แต่ละหน้าต้องใช้

ที่เก็บข้อมูลที่มี: `assets`, `trades` (kind: buy/sell/dividend/reinvest), `asset_prices` (ราคาที่ผู้ใช้กรอก ไม่มีราคารายวันอัตโนมัติ), `fx_rates` (เรตที่ผู้ใช้กรอก ผูกบัญชีเงินสด USD ต่อวัน), `fx_exchanges` (แลกเงิน), สมุดบัญชีคู่ (`accounts.kind = investment`), `settings` (jsonb ขนาดจำกัด 12 KB ใช้เก็บ `portfolioCurrency` อยู่แล้ว)
ฟังก์ชันล้วนที่ใช้ซ้ำได้: `replayWithFees`, `computeProfitSources` (R24), `computeMonthlyReturns` + `xirrBps` (R25, **เป็นบาทล้วน**), `wealthSummary`, `latestFxRate`

| หน้า | ข้อมูลที่ต้องใช้ | มีแล้ว | ขาด |
|---|---|---|---|
| A โครงหลัก/สลับสกุล | `portfolioCurrency` | มี (default เดิม THB) | เปลี่ยน default เป็น USD, ตัวแปลงสกุลแสดงผลตาม R26 (domain ใหม่) · ไม่ต้อง migration |
| B Holdings | replay ต่อสินทรัพย์ (หน่วย, Cusd/Cthb, ปันผล), ราคา, เรต, กำไร 6 แหล่ง | มีทั้งหมด (HoldingsCard เดิม) | แสดง "ขายแล้ว" (position 0) · คอลัมน์ Daily ต้องมีราคาสองวันติดกัน = ซ่อนไว้ตามสั่ง · ลบ holding ต้องตรวจกฎ R17 (ห้ามลบรายการก่อนขาย) ในบรีฟ worker |
| C Transactions | trades ทุกชนิด, ค่าธรรมเนียม | Buy/Sell/Dividend มี · โอนเงินบาทเข้า/ออกพอร์ตมี (`PortfolioTransfer`) · แลกเงินมี | **Cash deposit/withdrawal สกุล USD จากภายนอก** และ **Fee or tax แยกรายการ** ไม่มีที่เก็บ (ดูข้อ 2) · ป้าย Average cost (R11) แสดงข้อความตายตัวได้เลย |
| D Cash | ยอดคงเหลือบัญชีลงทุนที่ไม่ผูกสินทรัพย์ (สมุดบัญชี), เรตล่าสุด | ยอดและเรตอ่านได้ (R23, `wealthSummary`) | "Change balance" ต้องมีตัวบันทึกการปรับยอด (ดูข้อ 2) |
| E My goal | พอร์ตปัจจุบัน, ปันผล 12 เดือน (R25.1/25.2), เงินลงทุนรายเดือน | ครบ · ที่เก็บค่าเป้า: ใส่ใน `settings` jsonb ได้ (~200 ไบต์ ไม่ต้อง migration) | ฟังก์ชันประมาณการใหม่ (BigInt/bps) · ตัดสินเรื่อง R28 (ตัวเลือก ค.) |
| F Report | มูลค่า/กำไร/ปันผล/ค่าธรรมเนียม/turnover/จำนวนเทรดต่อเดือน | ผลตอบแทนรายเดือนมี (บาท) · กำไร 6 แหล่ง ณ วันใดวันหนึ่งมี | ชุดข้อมูลรายเดือนครบทุกแถว (คิดเป็นผลต่างของกำไรสะสมปลายเดือนกับปลายเดือนก่อน ผลรวมตรงเสมอ) · Dietz เวอร์ชันเซนต์ (R27.4) · ฟังก์ชัน TWR (R27) · export CSV/พิมพ์ PDF (ยังไม่มีไลบรารี xlsx: เริ่มด้วย CSV) · แถว S&P 500 = "Needs market data" |

## 2. เงินสดในพอร์ตและ R23

- **ที่เก็บ:** เงินสดไม่ต้องมีตารางใหม่ เงินสดในพอร์ต = ยอดคงเหลือของบัญชีสินทรัพย์ `kind: investment` ที่ไม่ผูกสินทรัพย์ (R23: ป้ายเดิม ไม่เพิ่มคอลัมน์) · USD อยู่ในบัญชี USD (R20) · บาทที่พักกับโบรกเกอร์ติดป้ายลงทุนได้ตามกฎ R23 · โอนบาทเข้า/ออกพอร์ตมีแล้ว (ไม่นับรายจ่าย) · แลกบาท↔USD มีแล้ว (`record_fx_exchange`)
- **ช่องว่าง:** ฐานข้อมูลล็อกไม่ให้เขียนบัญชีสกุล USD และบัญชีลงทุนด้วย Entry ทั่วไป (ต้องผ่าน RPC เฉพาะ: `record_trade_fx`, `record_fx_exchange`) จึงบันทึก "ปรับยอดเงินสด" ของ USD (เงินเข้า/ออกจากภายนอกพอร์ต, ปรับให้ตรงใบแจ้งยอดโบรกเกอร์) **ไม่ได้ถ้าไม่มี RPC ใหม่**
- **ข้อเสนอ:** migration เดียว แบบ "เพิ่ม" เท่านั้น (`create or replace function` ไม่มี drop/delete/truncate/เปลี่ยนชนิดคอลัมน์ → GM ใส่เองได้หลัง dry-run rollback) · ฟังก์ชัน `public.record_cash_adjustment(p_entry jsonb, p_accounts jsonb)` สร้างบัญชีพัก `equity` ชื่อเฉพาะ `inv-cash-adjust-usd` / `inv-cash-adjust-thb` (สกุลตามชื่อ, กันชื่อแบบเดียวกับ `fx-suspense-*`) แล้วบันทึก Entry 2 บรรทัด: เงินสดของพอร์ต ± จำนวน และบัญชีพักฝั่งตรงข้าม ผลรวม 0 ต่อสกุล (R16/R20.1) · เช็กเหมือน `record_fx_exchange`: ผู้ใช้เข้าสู่ระบบ, `can_use_data()`, จำนวนเต็ม ≥ 1, บัญชีเงินสดต้องเป็นบัญชีลงทุนไม่ผูกสินทรัพย์สกุลเดียวกัน · ไม่แตะ RLS/นโยบาย/trigger เดิม ยกเว้นต้องเพิ่มชื่อ `inv-cash-adjust-*` ในตัวล็อกชื่อ `inv-*` ถ้ามี (ตรวจตอนทำจริง)
  - ร่างโครง (ยังไม่รัน, รายละเอียดเลียนแบบ `record_fx_exchange` ใน `20261115000100_usd_phase_a.sql`): ตรวจ jsonb รูปแบบ → อนุญาตสร้างเฉพาะบัญชี `inv-cash-adjust-thb|usd` ชนิด equity → จัดกลุ่มบรรทัดเป็น `cash` (บัญชีลงทุนไม่ผูกสินทรัพย์) / `adjust` อย่างละ 1 บรรทัด และผลรวมต่อสกุล = 0 → `private.insert_entry(p_entry)` · ต้องเพิ่มเทสต์ SQL ใหม่ `supabase/tests/cash_adjustment_test.sql` และรันเทสต์ SQL **ครบทุกไฟล์** เพราะมี GRANT ให้ฟังก์ชันใหม่ (กฎระดับ 2) + live-contract บน branch และ main
- **Fee or tax แยกรายการ (Transactions → Add):** ไม่มีชนิดรายการนี้ใน `trades.kind` · การเพิ่มชนิดใหม่ต้องแก้ check constraint = `drop constraint` ซึ่ง **ต้องถามเจ้าของก่อน** · ข้อเสนอ: รอบที่ 1 **ยังไม่ทำ Fee or tax** (ซ่อนจากเมนู Add หรือแสดง Coming soon) หรือบันทึกเป็นการปรับยอดเงินสด (ลดเงินสด ติดป้ายหมายเหตุ) ผ่าน `record_cash_adjustment` ซึ่งไม่ใช่รายการภาษีจริงในรายงาน → **รอเจ้าของเลือก**

## 3. Migration ที่ต้องมี

- **รอบที่ 1 ต้องมี 1 ตัวเท่านั้น:** `record_cash_adjustment` (เพิ่มอย่างเดียว) ตามข้อ 2 · ตั้งชื่อไฟล์ตอนทำ `2026111800NN00_cash_adjustment.sql`
- ไม่ต้อง migration: สกุลแสดงผล, ค่าเป้าหมาย (ใน settings), รายงาน, Holdings, Transactions (ยกเว้น Fee or tax)
- ถ้าเลือกเพิ่มชนิด Fee/Tax ใน `trades.kind` = migration ที่มี `drop constraint` → ต้องรอเจ้าของอนุมัติ ไม่ใส่เอง

## 4. แบ่งงานให้ worker (ไม่เกิน 3 พร้อมกัน, merge ทีละ PR โดย GM)

ทุก PR ชื่อ `[invest-v2] ...` · branch `auto/invest-v2-<ชื่อ>` · worker ใช้ worktree ของตัวเอง · ไฟล์กลางที่ worker ห้ามแตะ: `docs/HANDOFF.md`, `docs/money-rules.md`, `CLAUDE.md`, `src/app/route.ts`, `src/app/investRoute.ts`, `src/ui/useViewHistory.ts`, design tokens ใน `src/ui/styles.css` · GM เขียนบรีฟใน `docs/plans/` ก่อนแตกงานทุกตัว

**ขั้น 0 (GM, ก่อนอนุมัติกฎ):** เจ้าของตอบ "อนุมัติ" → GM ใส่ R26/R27 ลง `docs/money-rules.md` ใน commit แยก (ตามกฎ: แก้ money-rules เฉพาะเมื่อเจ้าของอนุมัติ) แล้วเปิด PR เอกสาร

**คลื่น 1 (GM ทำเอง 1 PR · merge ก่อนเพื่อน เพราะแตะไฟล์กลาง):**
- PR-1 `[invest-v2] shell + สกุลแสดงผล (R26)`: เมนูแถบบนใหม่ (Tools 4 รายการ, ลบ Portfolio Lab, ลิงก์ภายนอก `rel="noopener"` ไอคอน ↗), Portfolio ไม่มีแถบเมนูย่อยในหน้า, Coming soon แทนหน้าที่ไม่มี, ปุ่ม $ USD/฿ THB + จำค่า, เอา "Sample data/Main portfolio" ออก, โมดูล domain `displayCurrency` ตาม R26 พร้อมเทสต์ + e2e สลับสกุล/เปิดทุกเมนู

**คลื่น 2 (worker 3 ตัวขนานกัน หลัง PR-1 merge; GM ทำ migration แยกคู่กัน):**
- W-B `[invest-v2] Holdings`: หน้า 20 (4 แท็บ, Show sold, ค้นหา, เรียง, เมนู ⋯, Returns 6 แหล่ง, Daily ซ่อน)
- W-F `[invest-v2] Report`: หน้า 15 + domain รายเดือน (USD/THB) + TWR (R27) + export CSV/พิมพ์ PDF · ไฟล์ domain ใหม่ ไม่แก้ `metrics.ts` เดิม (เพิ่มไฟล์ `reportSeries.ts`)
- W-E `[invest-v2] My goal`: หน้า 23 + ฟังก์ชันประมาณการ + บันทึกใน settings (ถ้าต้องแก้ `settings.ts`/`settingsPatch.ts` ให้เพิ่มฟิลด์เดียว แจ้ง GM)
- GM (ไม่นับโควตา worker): PR-M `[invest-v2] migration record_cash_adjustment` + เทสต์ SQL + dry-run rollback + live-contract (บน branch ก่อน merge, บน main หลัง merge) · merge ทีละ PR ตามกฎระดับ 2

**คลื่น 3 (worker 2 ตัว หลัง PR-M merge):**
- W-D `[invest-v2] Cash`: หน้า 24 + Change balance (เรียก RPC ของ PR-M) + หน้าว่าง + กล่อง R23
- W-C `[invest-v2] Transactions`: หน้า 21 + เมนู Add (Buy, Sell, Dividend, Cash deposit/withdrawal ผ่าน PR-M/โอนเข้าพอร์ต/แลกเงิน เดิม) + Filters + ป้าย R11 + แก้/ลบ พร้อม confirm · Import CSV ไม่ทำ · Fee or tax ตามที่เจ้าของเลือก

**ปิดรอบ (GM):** HANDOFF สรุปหลัง merge ทุก PR · รัน live-contract บน main ทุกครั้งหลัง merge · รายงานสั้นๆ ว่าอะไรเสร็จ/ค้าง

## 5. ลำดับพึ่งพา

PR-1 → (W-B, W-F, W-E, PR-M ขนานกัน) → (W-D, W-C ขนานกัน, ทั้งคู่รอ PR-M) · ผู้ตรวจ: money-auditor ทุก PR ที่แตะเงิน (PR-1, W-B, W-F, W-E, W-D, W-C, PR-M) · security-auditor เฉพาะ PR-M · design-critic ทุก PR ที่แตะหน้าจอ · investment-expert ตรวจ R26/R27 และสูตรกำไรรายเดือนก่อน PR-1 · Playwright 1280/1440 + 360/390 ทุก PR
