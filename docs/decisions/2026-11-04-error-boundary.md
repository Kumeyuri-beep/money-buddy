# ErrorBoundary + ตรวจช่วงปลอดภัยของ describe / sankey / sumByCurrency (4 พ.ย. 2569)

ปิดข้อ A-E ของ `2026-11-04-m2-pre-range.md` (ทำก่อน M2-C ตามเจ้าของสั่ง)

| # | เรื่อง | ตัดสินใจ | เหตุผล / ที่ทำต่อ |
|---|---|---|---|
| 1 | `ErrorBoundary` | 2 ชั้น: (ก) ครอบเนื้อหาหน้า Today/Bills/Ledger ด้วย `resetKey=view` เมนูและ Header อยู่นอก boundary (ข) ครอบทั้งแอปใน `main.tsx` แบบ `root` | error ใน render = จอขาวทั้งแอป · ข้อความคงที่ ไม่แสดง error ดิบ · stack ลงคอนโซลในเครื่องเท่านั้น |
| 2 | หน้า error ระดับ root | มีปุ่ม "โหลดหน้าใหม่" และ "ดาวน์โหลดไฟล์สำรองข้อมูล" (`src/ui/backup.ts` อ่านฐานข้อมูลตรงๆ ไม่ผ่านสูตรเงิน ห่อ try/catch) | design-critic: ล้มซ้ำแล้วผู้ใช้ต้องมีทางเอาข้อมูลออน · ย้าย `downloadBackup` ออกจาก `App.tsx` ใช้ร่วมกัน |
| 3 | โฟกัสคีย์บอร์ด | เมื่อเพิ่งล้ม ย้ายโฟกัสมาที่กล่องข้อความ (`tabIndex=-1`) | ปุ่มเดิมถูกแทนที่ |
| 4 | `sumByCurrency` | ใช้ `safeAdd` (RangeError เมื่อเกินช่วง) · `createEntry` แปลงเป็น `LedgerError` · `runIntegrityCheck` รายงานรหัสใหม่ `amount-overflow` แทนการโยน | Entry ที่ผลรวมระหว่างทางเกิน ±MAX_SAFE_INTEGER (~9×10^13 บาท) ถูกปฏิเสธ · เดิมคำนวณเพี้ยนเงียบๆ · ข้อมูลจริงปกติไม่ถูกกระทบ |
| 5 | `describeEntry` | ยอดรวมเกิน → ข้อความ `⚠ ยอดผิดปกติ` ไม่โยนใน render · `amountClass()` ให้ใช้ class `tx-warn` (ไม่ใช้สีรายรับ/รายจ่าย ไม่ใช้ตัวเลข tabular) | design-critic: ไม่ให้ดูเหมือนยอดจริง · ไม่พึ่งสีอย่างเดียว |
| 6 | `sankey.sumByAccount` | ใช้ `safeAdd`/`safeSub` · `CashFlowSankey` จับ RangeError ทั้ง `cashFlowMonths` และ `buildCashFlow` | money-auditor: `cashFlowMonths` ไม่มี try/catch (แก้แล้ว + เทสต์) |
| 7 | `slipDuplicates` | `debitTotal` ใช้ `safeAdd` · รายการที่ยอดผิดปกติถูกข้าม ไม่ให้การเตือนสลิปซ้ำล้ม | ความเสี่ยงต่ำ |

## ยังไม่ทำ (ระดับต่ำ)

| # | จุด | หมายเหตุ |
|---|---|---|
| A | `sankey.ts` `credit += -amount` ใน `netBuckets`, `balance.ts:18`, `schedule.ts:148` | ใช้ `+=` ตามด้วย `Number.isSafeInteger` (เทียบเท่า) หรือไม่ตรวจเฉพาะส่วนที่ถูกจำกัดด้วยยอดรวม · ควรรวมไปใช้ `safeAdd` ให้เป็นแบบเดียวกัน |
| B | `SummaryCards` `catch {}` ไม่แยกชนิด error และหายทั้ง 8 การ์ดถ้าโยน | ใช้ `instanceof RangeError` และแยกทีละการ์ด |
| C | หน้าสำรองข้อมูลระดับ root ยังไม่มีเทสต์ DOM | โปรเจกต์ยังไม่มี testing library สำหรับ DOM (เทสต์ตรรกะแยกใน `errorBoundaryState.ts` แล้ว) |
