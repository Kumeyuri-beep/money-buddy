---
name: money-rules
description: ใช้ทุกครั้งที่เขียนหรือแก้โค้ดที่เกี่ยวกับจำนวนเงิน ยอดคงเหลือ รายการบัญชี การแปลงสกุลเงิน หรือ SQL ที่คำนวณเงิน
---

# กฎเงินของ Money Buddy Pro (ฉบับย่อ)

ฉบับเต็มอยู่ที่ `docs/money-rules.md` และ `docs/money-rules-R16-proposal.md` ห้ามแก้สองไฟล์นี้โดยไม่ได้รับอนุญาต

- เงินบาทเก็บเป็นสตางค์จำนวนเต็ม (`Satang`) ห้ามใช้ float กับเงิน
- ข้อความ → สตางค์: `parseBahtToSatang` จาก `src/domain/money/satang.ts`
- ปัดเศษ: `roundHalfUp` (ปัดครึ่งออกจากศูนย์) จาก `src/domain/money/round.ts`
- สกุลเงินต่างประเทศ: micro-unit (×10^6) และ `convertToSatang` จาก `src/domain/money/micro.ts`
- แสดงผล: `formatBaht` / `toBahtString`
- R16: ทุก Entry มี ≥ 2 บรรทัด, debit บวก credit ลบ, ผลรวมต่อสกุลเงิน = 0 สร้างผ่าน `createEntry` เท่านั้น
- ยอดคงเหลือคำนวณจากบรรทัดด้วย `balanceOf` / `periodTotals` ห้ามเก็บยอดไว้
- โอน, จ่ายบัตร, เงินต้นหนี้, ให้ยืม ไม่ใช่รายรับ/รายจ่าย
- ฝั่ง Supabase: ตรวจผลรวมเป็นศูนย์ในฟังก์ชัน SQL ฝั่งเซิร์ฟเวอร์ด้วย ไม่เชื่อเบราว์เซอร์

ก่อนบอกว่าเสร็จ: เพิ่มเทสต์กรณีขอบ แล้วรัน `npm test` และ `npm run typecheck` ให้ผ่าน
