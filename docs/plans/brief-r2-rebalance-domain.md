# บรีฟ worker A: ฟังก์ชันคำนวณ Rebalancing (R29)

**branch:** `auto/r2-rebalance-domain` แตกจาก `origin/main` ล่าสุด ใน git worktree ของตัวเอง (`git worktree add`) · push ด้วยชื่อเต็มเท่านั้น · ห้าม merge เอง ห้าม rebase/force push · ใช้ `git merge origin/main` เท่านั้น · PR ชื่อขึ้นต้น `[invest-v2-r2]` · commit ระบุกฎ เช่น `[R29,R8,R17,R20] ...`

## เป้าหมาย
เขียนฟังก์ชันล้วน (ไม่แตะ DOM/ฐานข้อมูล/React) `src/domain/invest/rebalance.ts` ตามกฎ **R29 ใน `docs/money-rules.md`** (อ่านทั้งข้อก่อนเริ่ม · เป็นกฎเหล็ก ห้ามแก้ไฟล์นี้) และ `docs/proposals/R29-rebalancing.md` (อัลกอริทึม ตารางกรณีขอบ)

## ขอบเขต
**ทำ:**
- `floorDivBig(n, d)` ใน `src/domain/money/round.ts` (ตัวตั้ง ≥ 0, ตัวหาร > 0 ไม่งั้นโยน `RangeError`) + เทสต์
- `rebalance(input)` → Result: โหมดฝาก (D ≥ 0, Allow sales เปิด/ปิด), โหมดถอน (W > 0), เปิด/ปิดเศษหุ้น (3 ทศนิยม), Min order, "Left over", "Short by", เหตุผลที่ไม่คำนวณ (ไม่มีเป้า/เป้ารวมไม่ครบ · หุ้นไม่มีหมวด · หมวดมีสินทรัพย์บาท · ไม่มีราคา · D=0 ไม่เปิด sales · W>V ฯลฯ) · ข้อมูลเข้า/ออกเป็นชนิดของ domain (`AssetCategory`, `Asset`, holdings จาก `src/domain/invest`) · คืนรหัสเหตุผล/คำเตือนเป็น enum (ข้อความไทย/อังกฤษทำที่ชั้นหน้าจอภายหลัง)
- ตารางหมวด Now / Target / After คิดจากหน่วยที่ปัดจริง
**ไม่ทำ:** หน้าจอ · ฐานข้อมูล · migration · การสร้างรายการซื้อขาย · ภาษี/ค่าธรรมเนียม · ราคาตลาดอัตโนมัติ

## ไฟล์ที่แตะได้
`src/domain/invest/rebalance.ts` (ใหม่) · `src/domain/money/round.ts` (เพิ่ม `floorDivBig`) · `tests/unit/rebalance.test.ts` (ใหม่) · `tests/unit/floorDivBig.test.ts` (ใหม่) · `docs/learning/` (สรุปไทยของ PR นี้)
**ห้ามแตะ:** `docs/HANDOFF.md`, `docs/money-rules.md`, `CLAUDE.md`, `src/ui/**`, `src/storage/**`, `supabase/**`, `src/ui/styles.css`, routes หลัก · ถ้าจำเป็นต้องแก้ไฟล์เหล่านี้ให้หยุดและแจ้ง GM

## ต้องใช้ของเดิม (ห้ามคำนวณเงินเองซ้ำ)
`valueInSatang(units, priceMicro)` ใน `src/domain/invest/units.ts` · `categoriesProblem` ใน `src/domain/invest/categories.ts` · ชนิดใน `src/domain/invest/types.ts` · BigInt ล้วน ห้าม float/`Math.floor` · ห้ามใช้ `/` ของ BigInt ตรงๆ กับค่าที่หารไม่ลงตัว (ใช้ `floorDivBig`)

## เกณฑ์เสร็จ
- เทสต์อ่านตัวอย่างจาก **`tests/fixtures/r29-examples.json` ไฟล์เดียว** (ห้ามคัดลอกตัวเลขไปใส่เทสต์): ตัวอย่าง A–E ตรงทุกค่า (A และ B ทั้งเปิดและปิดเศษหุ้น)
- invariant ทั้งชุดตามหัวข้อ "เทสต์ที่ต้องมี" ของ R29: ซื้อ ≤ F · ซื้อ + Left over = F · F ≤ Σsc/10,000 เมื่อเปิด Allow sales · ac ≤ ⌈sc/10,000⌉ · ขาย ≤ หน่วยที่ถือ · Σsc = 0 ไม่หารด้วยศูนย์ · ผลรวมในหมวด = เงินของหมวด · ไม่มี `Math.floor` ในไฟล์ (เทสต์ grep ได้)
- เทสต์ขอบเขต: ยอด 0, น้อยมาก (1 เซนต์), เศษเท่ากัน (ลำดับหมวด/ชื่อย่อ/id), หุ้นมูลค่า 0, Min order ตัดแถวแล้วเงินกลับเป็น Left over, ถอนเต็มพอร์ต, หมวดไม่มีหุ้นที่ถืออยู่, ราคาสูงกว่าเงินของแถวเมื่อปิดเศษหุ้น, ผลไม่ขึ้นกับลำดับอินพุต (สลับลำดับแล้วได้ผลเท่าเดิม)
- `npm test` + `npm run typecheck` + `npm run build` ผ่าน

## ส่งกลับ GM
สรุปภาษาไทย · ข้อสังเกต/จุดที่กฎไม่ชัด (อย่าเดา ให้ถาม) · เรื่องที่ต้องแก้ไฟล์กลาง · ชื่อ PR · ผล money-auditor ไม่ต้องเรียกเอง (GM เรียก)
ผลวินิจฉัย/สรุปห้ามใส่ข้อมูลการเงินจริง ใช้เฉพาะข้อมูลสมมติในไฟล์ตัวอย่าง
