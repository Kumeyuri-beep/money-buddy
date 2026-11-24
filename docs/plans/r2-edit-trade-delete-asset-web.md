# แผน: แก้รายการที่บันทึกแล้ว + ลบสินทรัพย์ ฝั่งเว็บ (R2 ข้อ 4)

ข้อตัดสินใจเจ้าของ (24 พ.ย. 2569): แก้ได้เฉพาะรายการที่ฐานข้อมูลอนุญาต · ต้นทุนขายคำนวณด้วย replay ไม่รวมรายการเดิม · บล็อกการย้ายวันขายไปก่อนวันซื้อ · ชนกัน PT409/40P01 = "Data changed — reload and try again."

## แบ่ง 2 PR
- **PR A (repository)**: `replaceTrade(input)` + `deleteAsset(id)` ใน `LedgerRepository` (Supabase เท่านั้น เครื่อง/Dexie = ไม่รองรับ) · ตรวจกติกาก่อนส่ง (`checkTradeDeleteCoded` + `checkTradeAddCoded` ของรายการที่เหลือ) · ต้นทุนขายด้วย `replayRecords`/`replayTradesFx` ไม่รวมรายการเดิม · `basedOn` = ลายนิ้วมือของรายการทั้งหมดรวมรายการที่แก้ · `tradeRpc` จับ PT409/40P01/40001 → `store.dataChanged`
- **PR B (หน้าจอ, เฉพาะคอม ≥1024px)**: ปุ่ม Edit ใน Transactions เปิดฟอร์มแก้ตามชนิดรายการ (ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ · USD ใช้อัตรา) · ปุ่มปิดเมื่อกติกาไม่อนุญาต พร้อมเหตุผล · ปุ่ม Delete asset ใน Holdings (แสดงเมื่อไม่เหลือรายการ ที่เหลือรายการปิดพร้อม "Delete its transactions first") · e2e 1280/1440 + 360/390 ไม่พัง

## ไฟล์
PR A: `src/storage/{ledgerRepository,supabaseRepository,storageMessages}.ts`, `tests/unit/replaceTradeRepository.test.ts`, `tests/live/replaceTrade.live.ts`
PR B: `src/ui/invest/...` (ฟอร์มแก้ + ปุ่ม), e2e ใหม่ · ห้ามมีสูตรเงินใน component (เรียก repository/domain เท่านั้น)

## ค้างจากผู้ตรวจ (ทำใน PR B): ฟอร์มแก้ต้องใช้ลายนิ้วมือจากทุกแถวรวมแถวที่แก้ (repository ทำให้แล้ว) · จับ PT409/40P01 แสดงข้อความเดียว (repository ทำให้แล้ว)
