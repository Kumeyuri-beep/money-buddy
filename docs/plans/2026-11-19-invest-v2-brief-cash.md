# บรีฟ W-D: Cash (แบบร่าง 24) · branch `auto/invest-v2-cash`

อ่าน `2026-11-18-invest-v2-brief-common.md` ก่อน (วิธีทำงาน/ห้ามแตะ/ส่งกลับ GM ใช้ตามนั้นทั้งหมด) · เจ้าของสั่งเริ่มคลื่น 3 วันที่ 19 พ.ย. 2569 หลัง `record_cash_adjustment` (#225) merge แล้ว

**เป้าหมาย:** หน้า Portfolio → Cash ตามแบบร่าง `docs/design/invest-v2/24-portfolio-cash.html` (PNG อยู่ที่เครื่องเจ้าของ `docs/design/invest-v2/24-portfolio-cash.png`) แทน "Coming soon": ยอดเงินสดของพอร์ตสกุลบาทและ USD + รายการเงินเข้า/ออกพอร์ต + ปุ่ม Change balance ที่ลงสมุดผ่าน `repo.recordCashAdjustment` (RPC `record_cash_adjustment` ที่ merge แล้ว)

**ทำ:**
- การ์ดยอดเงินสดต่อสกุล (THB, USD) = ผลรวมบรรทัดของบัญชีลงทุนที่ไม่ผูกสินทรัพย์สกุลนั้น (อ่านจากสมุด ห้ามเก็บยอดซ้ำ R16) · ใช้ `usdCashBalances` (USD) และเขียนตัวอ่านฝั่งบาทแบบเดียวกันใน domain ใหม่ · แปลงเป็นสกุลที่แสดงด้วย `displayCurrency.ts` (R26 ไม่มีเรต = "Needs rate" ไม่เดา)
- ปุ่ม **Change balance** (dialog): เลือกบัญชีเงินสด/สกุล · โหมด Deposit / Withdraw / Set balance to (กรอกยอดใหม่ ระบบคำนวณส่วนต่างเป็นฝาก/ถอนจำนวนเต็มหน่วยย่อย · ส่วนต่าง 0 = ไม่บันทึกและบอกผู้ใช้) · วันที่ · หมายเหตุ · เรียก `buildCashAdjustmentEntry` / `repo.recordCashAdjustment` ที่มีแล้ว **ห้ามเขียนสูตรเอง** · error ผ่านระบบ `{code, params}` ที่มี (`link.*`)
- รายการเงินเข้า/ออกพอร์ตล่าสุด (การปรับยอดเงินสด = Entry ที่มีบรรทัดบัญชี `CASH_ADJUST_ACCOUNT_IDS` · โอนเงินบาทเข้า/ออกพอร์ตเดิม `classifyPortfolioTransfer` · แลกเงิน) พร้อมป้ายชนิด เรียงวันที่ใหม่ก่อน
- หน้าว่าง (ยังไม่มีบัญชีเงินสด/ยอด 0) ข้อความบอกทางไปสร้างบัญชีเงินสด USD ที่ Holdings
- **กล่องอธิบาย R23** (เงินที่ลงทุนต่างจากเงินใช้จ่าย · การปรับยอดไม่ใช่รายรับ/รายจ่าย) และข้อความ **ผลตอบแทนไม่รวมเงินสด** (ข้อเสนอ R25.4 ใน `docs/proposals/R25-4-cash-not-in-return.md` ยังรออนุมัติ: ห้ามอ้างว่าเป็นกฎ ใช้ข้อความกลางๆ)
- **เงินสดติดลบ (เจ้าของตัดสิน 19 พ.ย.):** บังคับห้ามติดลบเฉพาะการถอนแบบปรับยอด (ฐานข้อมูลปฏิเสธ แสดงข้อความจากรหัส error) · ทางอื่นติดลบได้ ให้แสดง **คำเตือน** บนการ์ดเมื่อยอดสกุลใดติดลบ (ใช้ `negativeUsdCash` ที่มี + ตัวเทียบเท่าฝั่งบาท)

**ไม่ทำ:** migration/SQL/`src/storage/` · ราคารายวัน · การแก้/ลบรายการปรับยอดย้อนหลัง (ใช้ลบรายการในสมุดเดิม ถ้าต้องมีให้บอก GM) · Import · แตะหน้า Transactions (อีกงานทำอยู่)

**ไฟล์ที่แตะได้:** `src/ui/invest/pages/CashPage.tsx` (แทนที่) · ไฟล์ใหม่ใน `src/ui/invest/cash/` · domain ใหม่ `src/domain/invest/cashView.ts` (ยอดต่อสกุล, รายการเข้า/ออก, คำนวณส่วนต่างของ Set balance, คำเตือนติดลบ) · เทสต์ใหม่ `tests/unit/investCashView.test.ts` · `tests/e2e/invest-cash.spec.ts` · `src/app/investRoute.ts` เฉพาะบรรทัด `portfolio/cash` (soon เป็น live) + `tests/unit/investRoute.test.ts`
**ห้ามแตะเพิ่ม:** `src/domain/invest/cashAdjustment.ts` (อ่านและเรียกใช้เท่านั้น) · `TransactionsPage.tsx` และไฟล์ของ Transactions

**เกณฑ์เสร็จ:**
- unit: ยอดต่อสกุลจากสมุด (ฝาก, ถอน, ถอนพอดีเหลือ 0, ว่าง) · Set balance: ส่วนต่างบวก/ลบ/0, ปัดเป็นหน่วยย่อยจำนวนเต็ม, ยอดใหญ่ขอบ 2^53 ปฏิเสธ · ไม่มีเรต = Needs rate · ติดลบ = มีคำเตือน · รายการเข้า/ออกจัดชนิดถูก (ปรับยอด/โอน/แลกเงิน) · ไม่มี `-0`
- e2e (harness `?investDemo=...` ที่มีอยู่ ถ้าต้องเพิ่มข้อมูลสมมติให้เพิ่มคีย์ใหม่ของตัวเองใน `src/dev/investDemo.ts` / `harness.tsx` และบอก GM): เปิดหน้า ไม่ใช่ Coming soon · dialog เปิด/ปิดด้วย Esc คืนโฟกัส · สลับ USD/THB แล้วเลขเปลี่ยน · 1280/1440 และ 360/390 ไม่ล้นจอ ไม่บัง · คีย์บอร์ดใช้ได้
- รัน Playwright ทีละ 2 workers (ห้าม 4 workers หนักเพราะทำให้ไม่นิ่ง) · ถ้าพอร์ต dev server ชนกับ worker อื่นให้ใช้พอร์ตของตัวเองชั่วคราวและไม่ commit
