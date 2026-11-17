# บรีฟ W-B: Holdings (แบบร่าง 20) · branch `auto/invest-v2-holdings`

อ่าน `2026-11-18-invest-v2-brief-common.md` ก่อน

**เป้าหมาย:** หน้า Portfolio → Holdings ตามแบบร่าง `20-portfolio-holdings` แทนหน้าหุ้นสหรัฐเดิม (ฟอร์มเพิ่มรายการเดิมยังต้องใช้ได้ · ปุ่ม Add บนแถบบนเปิดหน้านี้พร้อมสัญญาณ `addSignal`)
**ทำ:**
- แท็บ My holdings / General / Dividends / Returns (เปลี่ยนชุดคอลัมน์)
- Show sold (สินทรัพย์ที่ถือ 0 หน่วย) · ค้นหา · เรียงลำดับ
- เมนู ⋯ ต่อแถว: Add a transaction / Open holding / Edit / Delete (Delete ต้อง confirm และเคารพ R17: ห้ามลบรายการที่วันที่ ณ หรือก่อนรายการขายล่าสุดของสินทรัพย์เดียวกัน · ใช้ฟังก์ชันลบเดิมของ repository ไม่เขียนใหม่)
- แท็บ Returns แยกกำไร 6 แหล่งต่อสินทรัพย์ตาม R24 (ผลรวม 6 แหล่ง = กำไรรวม ตรงเป๊ะ)
- คอลัมน์ Daily **ซ่อน** จนกว่าจะมีราคาเฟส B
- แถวรวม (Total · N holdings) ตาม R26: ผลรวม = ผลบวกค่าที่แปลงแล้วของแต่ละแถว
**ไม่ทำ:** Import CSV · ราคารายวัน · สินทรัพย์บาท · migration
**ไฟล์ที่แตะได้:** `src/ui/invest/pages/HoldingsPage.tsx` (แทนที่) · ไฟล์ใหม่ใน `src/ui/invest/holdings/` · domain ใหม่ `src/domain/invest/holdingsView.ts` (เรียก `replayWithFees`, `computeProfitSources`, `displayCurrency`) · `tests/unit/investHoldingsView.test.ts` · `tests/e2e/invest-holdings.spec.ts` · `holdings.css` ใหม่ · ไฟล์เดิม `src/ui/UsOverview.tsx`, `TransactionsTab.tsx`, `analysis/HoldingsCard.tsx` ใช้ดู/ใช้ซ้ำได้ ห้ามทำให้หน้าอื่นพัง
**ข้อมูล:** `useInvest().data` (assets, trades, prices, fxRates) · ต้นทุน `Cusd`/`Cthb` จาก replay (R20.3) · มูลค่า = หน่วย × ราคาล่าสุดที่กรอก · เรตล่าสุด `latestFxRate` · ไม่มีราคา/เรต = ติดธง ไม่เดา
**เกณฑ์เสร็จ:**
- unit: การเรียง/ค้นหา/ชุดคอลัมน์ต่อแท็บ · ผลรวม 6 แหล่งต่อสินทรัพย์ = กำไรรวม · มุมมอง USD แหล่งค่าเงิน "—" · ไม่มีราคา → incomplete · ขายหมดอยู่ใน Show sold เท่านั้น
- e2e: สลับ USD/THB แล้วตัวเลขตารางเปลี่ยน · เมนู ⋯ มีครบ 4 รายการ · Delete มี confirm · 1280/1440/360/390 ไม่ล้นจอ
