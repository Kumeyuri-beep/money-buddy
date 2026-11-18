# บรีฟ W-C: Transactions (แบบร่าง 21) · branch `auto/invest-v2-transactions`

อ่าน `2026-11-18-invest-v2-brief-common.md` ก่อน (วิธีทำงาน/ห้ามแตะ/ส่งกลับ GM ใช้ตามนั้นทั้งหมด) · เจ้าของสั่งเริ่มคลื่น 3 วันที่ 19 พ.ย. 2569

**เป้าหมาย:** หน้า Portfolio → Transactions ตามแบบร่าง `docs/design/invest-v2/21-portfolio-transactions.html` (PNG ที่เครื่องเจ้าของ `21-portfolio-transactions.png`) แทนหน้ารายการเดิม (`TransactionsTab section="overview"`): ตารางรายการทุกชนิด + Filters + เมนู **Add** + ลบพร้อม confirm

**ทำ:**
- ตารางรายการรวม (ใหม่ก่อน): ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ (`trades`) · แลกเงิน (`fx_exchanges`) · โอนเงินบาทเข้า/ออกพอร์ต (`classifyPortfolioTransfer`) · เงินเข้า/ออกพอร์ตแบบปรับยอด (Entry ที่มีบรรทัดบัญชี `CASH_ADJUST_ACCOUNT_IDS` จาก `src/domain/invest/cashAdjustment.ts` · ระบุด้วยบรรทัดนั้น **ห้ามแก้ไฟล์นั้น** · งาน Cash อีกตัวสร้าง `cashView.ts` ของตัวเอง ห้ามอิงหรือแก้ไฟล์ของกัน)
- คอลัมน์: วันที่ · ชนิด · สินทรัพย์ · จำนวนหน่วย · ราคา · มูลค่า · ค่าธรรมเนียม/ภาษี · สกุล · แสดงตามสกุลที่เลือกตาม R26 (ปัดครั้งเดียวต่อค่า) · ไม่มีเรต = "Needs rate" ที่แถวนั้น + ติดธง incomplete ที่ยอดรวม ห้ามข้ามเงียบ
- **Filters:** ชนิดรายการ · สินทรัพย์ · ช่วงวันที่ · ค้นหา · ล้างตัวกรอง · สถานะไม่มีผลลัพธ์
- **เมนู Add:** Buy · Sell · Dividend · Cash deposit/withdrawal (dialog เรียก `repo.recordCashAdjustment` ผ่าน `buildCashAdjustmentEntry` ที่มีแล้ว) · Transfer to/from portfolio (บาท ใช้ `PortfolioTransfer` เดิม) · Currency exchange (ใช้ฟอร์มแลกเงินเดิม) · **ไม่มี "Fee or tax"** (เจ้าของตัดสินแล้ว ตัดออกจากเมนู) · Buy/Sell/Dividend ใช้ฟอร์มเดิมใน `UsStocksView` ผ่านสัญญาณ `request` ที่มีอยู่ (อย่าเขียนฟอร์มซื้อขายใหม่ อย่าแก้สูตร)
- **ลบ:** มี confirm และเคารพ R17 (ใช้ `planHoldingDelete` / `checkTradeDeleteCoded` และ `repo.deleteTrade` / `deleteFxExchange` / ลบ Entry เดิม · แสดงเหตุผลเมื่อห้ามลบ) · "Edit" = ถ้าระบบยังไม่มีการแก้รายการที่บันทึกแล้ว ให้ปุ่มปิดพร้อมคำอธิบาย (ห้ามทำเป็นลบแล้วสร้างใหม่แบบเงียบ) แล้วบอก GM
- ป้าย **Average cost** (R11) ข้อความตายตัวตามแบบร่าง
- **เงินสดติดลบ (เจ้าของตัดสิน):** ทางอื่นนอกจากการปรับยอดทำให้เงินสด USD ติดลบได้ ให้แสดงคำเตือนเมื่อมี (`negativeUsdCash` ที่มีอยู่)

**ไม่ทำ:** Import CSV · Fee or tax · migration/SQL/`src/storage/` · การแก้ฟอร์มซื้อขายเดิม · หน้า Cash

**ไฟล์ที่แตะได้:** `src/ui/invest/pages/TransactionsPage.tsx` (แทนที่) · ไฟล์ใหม่ใน `src/ui/invest/transactions/` · domain ใหม่ `src/domain/invest/transactionsView.ts` (รวมรายการทุกชนิด จัดชนิด กรอง ค้นหา เรียง แถวรวม ยอดแปลงสกุลต่อแถว) · เทสต์ใหม่ `tests/unit/investTransactionsView.test.ts` · `tests/e2e/invest-transactions.spec.ts` · `src/ui/UsStocksView.tsx` เฉพาะส่วนรับสัญญาณเปิดฟอร์มเพิ่ม ถ้าจำเป็นจริง (บอก GM) · `src/app/investRoute.ts` ไม่ต้องแก้ (Transactions เป็น live อยู่แล้ว)

**เกณฑ์เสร็จ:**
- unit: รวมรายการทุกชนิดเรียงถูก (วันเดียวกัน createdAt เท่ากัน ตัดสินด้วย id เหมือน `cmpKey`) · กรองทุกแบบ · ค้นหา · แปลงสกุลปัดครั้งเดียวต่อค่า (1 เซนต์ที่เรต 32.500000 = 33 สตางค์) · ไม่มีเรต = Needs rate + incomplete · แถวรวม = ผลบวกแถวที่แปลงแล้ว · ว่าง/ไม่มีผลลัพธ์ · แผนลบที่ผิด R17 ถูกปฏิเสธ
- e2e: สลับ USD/THB เลขเปลี่ยน · Filters ทำงาน · เมนู Add มีครบและไม่มี Fee or tax · ลบมี confirm Esc ปิดโฟกัสคืน · 1280/1440 และ 360/390 ไม่ล้นจอ · คีย์บอร์ดใช้ได้
- รัน Playwright ทีละ 2 workers
