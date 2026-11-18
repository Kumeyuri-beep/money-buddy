# บรีฟ worker: รายการไม่มีเรต ห้ามข้ามเงียบ (R26) — PR เล็กแยก

เจ้าของสั่ง 18-19 พ.ย. 2569 (ให้แก้รอบนี้ ไม่เก็บเป็น backlog)

## เป้าหมาย
ตอนนี้ `src/domain/invest/tradesFx.ts` (`toTradesFx`), `src/domain/invest/metrics.ts` (ประมาณบรรทัด 147 `usdAssets` กรอง `fxRateMicro !== undefined`, บรรทัด 167 ปันผลที่ไม่มีเรตถูก `continue`) และตัวเรียกอื่นที่ใช้สองฟังก์ชันนี้ ข้ามรายการ USD ที่ไม่มี `fxRateMicro` **เงียบๆ** ทำให้ตัวเลขดูครบทั้งที่ไม่ครบ
ตาม R26 ("ห้ามเดา") ต้องเปลี่ยนเป็น: รายการนั้นไม่ถูกนับเป็น 0 ไม่ถูกเดาเรต และ **ผู้ใช้เห็น** ว่ารายการไหนขาดเรต ("Needs rate" ที่รายการ/แถวนั้น) และ **ยอดรวมที่ได้รับผลติดธง incomplete**

## ขอบเขต
- ทำ: ตรวจทุกจุดที่ข้ามรายการไม่มีเรตใน `metrics.ts`, `tradesFx.ts`, `src/app/usPortfolio.ts` (ผ่านการอ่านโค้ดและ grep `fxRateMicro`) · ให้ฟังก์ชันคืนข้อมูล "ขาดเรต" (เช่น รายการ id/วันที่ที่ถูกข้าม และธง `incomplete`/`missing: 'rate'` ในผลลัพธ์) แบบเพิ่มฟิลด์ที่เข้ากันได้ย้อนหลัง · แสดงผลในหน้าจอที่ใช้ผลเหล่านี้ (หน้าจอ /invest ที่แสดงยอด/กำไร/ปันผลที่ได้จาก metrics: Dashboard, Analytics ฯลฯ — ใช้ธง/คำว่า "Needs rate" ที่มีอยู่แล้วในโค้ด Holdings/Report ให้สอดคล้องกัน ไม่ต้องคิดใหม่)
- ไม่ทำ: ไม่เปลี่ยนพฤติกรรมตอนบันทึก (ตัวบันทึกใน `src/storage/supabaseRepository.ts` เรียก `toTradesFx` เพื่อตรวจกติกา · **ห้ามแก้ `src/storage/` และห้ามเปลี่ยนผลของ `toTradesFx` สำหรับตัวบันทึก** ถ้าต้องการพฤติกรรมใหม่ให้เพิ่มฟังก์ชันใหม่ เช่น `splitTradesByRate` แล้วให้ฝั่งแสดงผลเรียกฟังก์ชันใหม่) · ไม่แตะ DB/migration · ไม่แก้ `twr.ts`/`reportSeries.ts`/`holdingsView.ts` ที่จัดการ needs-rate แล้ว (ใช้เป็นแบบอย่างได้) · ไม่แก้สูตรกำไร/ปัดเศษใดๆ
- ถ้าเจอว่าต้องแก้ `src/storage/` หรือ SQL ให้ **หยุดและส่งกลับ GM**

## ไฟล์ที่แตะได้
`src/domain/invest/tradesFx.ts`, `src/domain/invest/metrics.ts`, `src/app/usPortfolio.ts`, ไฟล์ UI ใต้ `src/ui/invest/` และ `src/ui/UsStocksView.tsx` เท่าที่จำเป็นต้องแสดงธง · `tests/unit/*` ที่เกี่ยวข้อง + เทสต์ใหม่ · `tests/e2e/` เฉพาะที่จำเป็น · `docs/learning/` (สรุปไทย)
**ห้ามแตะ:** `docs/HANDOFF.md`, `docs/money-rules.md`, `CLAUDE.md`, `src/storage/`, `supabase/`, `tests/live/`, routes หลัก, design tokens (ตัวแปรกลางใน styles.css)

## เกณฑ์เสร็จ
- เทสต์หน่วยใหม่: ไม่มีเรต → รายการถูกรายงานว่าขาดเรต + ยอดรวมติดธง incomplete (ไม่เป็น 0) · ข้อมูลที่ครบเรตให้ผลเดิมทุกบิต (เทสต์เดิมทั้งหมดต้องผ่านโดยไม่แก้ค่าที่คาดหวัง) · ผสมหลายรายการ · ปันผลไม่มีเรต · ขอบเขต: 0 รายการ, ทุกรายการไม่มีเรต, รายการแรกไม่มีเรต
- `npm test`, `npm run typecheck`, `npm run build` ผ่าน · Playwright ที่ 1280 และ 1440 (หน้า /invest ที่แตะ) และ 360/390 ไม่พัง รัน 2 workers ไม่หนักพร้อมกัน
- สไตล์ที่เพิ่มเฉพาะคอมครอบ `@media (min-width: 1024px)`; <1024px ไม่เปลี่ยนหน้าตา

## ส่งกลับ GM
สรุปภาษาไทย: จุดที่เคยข้ามเงียบทั้งหมดที่พบ (ไฟล์:บรรทัด) และแก้อย่างไร · จุดที่เลือกไม่แก้พร้อมเหตุผล · ข้อสังเกต · ต้องแก้ไฟล์กลาง/DB หรือไม่
อย่าอ่าน `.env*` และ `.money-buddy-admin` · ห้าม rebase/force push · อัปเดตจาก main ด้วย `git merge origin/main` เท่านั้น · commit ระบุกฎ (เช่น `[R24,R26]`) · push `git push -u origin auto/usd-needs-rate` · เปิด PR ด้วย `gh pr create` (ห้าม merge เอง) สรุปไทย + "ต้องลองบนคอม" เท่านั้น
