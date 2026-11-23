# บรีฟ worker A: แก้ rebalance.ts ตามเจ้าของตัดสิน 2 ข้อ (R29)

**worktree/branch:** ทำใน `C:\Users\owenn\Documents\money-buddy-wt-r29amend` (branch `auto/r2-r29-amend` มี commit แก้ `docs/money-rules.md` แล้ว) · push `git push origin auto/r2-r29-amend` · เปิด PR ชื่อ `[invest-v2-r2] R29 ปรับ 2 ข้อ (เงิน 0 เซนต์ · บาท 0 หน่วย)` ห้าม merge ห้าม rebase/force · commit ระบุกฎ `[R29,R20]`

## ขอบเขต (อ่าน R29 ล่าสุดใน `docs/money-rules.md` ข้อ 29 ก่อน)
1. แถวซื้อที่หน่วย > 0 แต่จำนวนเงินปัดเป็น 0 เซนต์ → ตัดเป็น `droppedRows` เหตุผล `belowMinOrder` (ตรวจ `unitsZero` ก่อนเสมอ) เงินไปรวม Left over · ซื้อรวม + Left over = F ต้องจริงเสมอ
2. สินทรัพย์บาทในหมวดที่เหลือ 0 หน่วย → ข้ามได้ (ไม่หยุดคำนวณ เหมือนหุ้น USD 0 หน่วย) · สินทรัพย์บาทที่ยังมีหน่วย > 0 ยังหยุดคำนวณ `bahtAssetInCategory` เหมือนเดิม · ห้ามเลือกสินทรัพย์บาทเป็นแถวซื้อเด็ดขาด
- เพิ่มเคสทั้งสองใน `tests/fixtures/r29-examples.json` (คำนวณค่าคาดหวังด้วยมือให้ถูกก่อน ใส่คำอธิบายสั้นๆ ในช่อง `_comment`) และให้ `tests/unit/rebalance.test.ts` อ่านจาก fixture เท่านั้น · เคสที่ 1 ต้องไม่ทำให้เคสเดิมใน fixture เปลี่ยน

## แตะได้
`src/domain/invest/rebalance.ts` · `tests/unit/rebalance.test.ts` · `tests/fixtures/r29-examples.json` · `docs/proposals/R29-rebalancing.md` (เพิ่มตัวอย่าง) · `docs/learning/`
## ห้ามแตะ
`docs/money-rules.md` (GM ทำแล้ว) · `HANDOFF.md` · `CLAUDE.md` · `supabase/` · `src/ui/` · `src/storage/`

## เกณฑ์เสร็จ
`npm test` + typecheck + build ผ่าน · แยก commit เป็นชิ้นเล็ก push ทุกชิ้น · รายงานไทย: ลิงก์ PR, ตัวเลขตัวอย่างใหม่, ข้อสังเกต
