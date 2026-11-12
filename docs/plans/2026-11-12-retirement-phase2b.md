# แผน: เกษียณ เฟส 2b (จำการเลือกสินทรัพย์เกษียณข้ามครั้ง)

branch `auto/retirement-phase2b` · กฎ R16, R18 (ข้อ 18.8) · เจ้าของเลือกทางแรก (เก็บใน `settings` เหมือน `dcaPlans`) เมื่อ 12 พ.ย. 2569

## ตรวจแล้ว: ไม่ต้องมี migration
- ตาราง `settings` เก็บ `value jsonb` ก้อนเดียว (เช็กแค่เป็น object และขนาด < 16 KB) ไม่มีการตรวจชื่อฟิลด์ในฐานข้อมูล
- SQL นำเข้า (`import_ledger*`) คัดลอก `p_data->'settings'` ทั้งก้อน เหมือนที่ `dcaPlans` ใช้อยู่ → ไม่ต้องแก้ SQL
- สิ่งที่ต้องแก้มีแค่ตัวตรวจ/ตัวอ่านฝั่งแอป (เพิ่มฟิลด์ ไม่ลบ ไม่เปลี่ยนชนิด) จึงเข้าเงื่อนไขทำเองได้ตามโหมดอัตโนมัติระดับ 2

## งาน
| ชิ้น | ไฟล์ |
|---|---|
| เทสต์ก่อน | `tests/unit/retirementSelection.test.ts` · เคสใหม่ใน `tests/live/investRls.live.ts` |
| โดเมน | `src/domain/invest/retirementSelection.ts` (`sanitizeRetirementAssetIds`, `retirementAssetIdsProblem`, เพดาน 30) · `src/domain/bills/settings.ts` |
| ไฟล์สำรอง | `src/domain/backup/parseBackup.ts` (รับฟิลด์ใหม่ + แก้คำเตือน "ไม่รู้จัก" ที่ขึ้นผิดกับ `dcaPlans`) |
| ที่เก็บ | `src/storage/repository.ts`, `supabaseRepository.ts` (ไม่ส่งฟิลด์ = คงของเดิม · ส่ง `[]` = ลบ) |
| use case | `src/app/retirementPortfolio.ts` (`initialRetirementSelection` ข้ามรหัสที่สินทรัพย์ถูกลบแล้วเงียบๆ) |
| หน้าจอ | `src/ui/RetirementView.tsx` (โหลดการเลือกเดิม, ติ๊กแล้วบันทึกเป็นคิว, ล้างค่าเคลียร์ด้วย) |

## ข้อควรรู้
- เก็บเฉพาะรหัสที่เลือก ไม่เก็บมูลค่า/ความคืบหน้า/ผลคำนวณ (R16, 18.8)
- ขนาด `settings` ต้อง < 16 KB ร่วมกับแผน DCA (50 แผน) จึงจำกัดการเลือกไม่เกิน 30 รายการ (รหัสจริงสั้น ราว 36 ตัวอักษร)
- หน้าเกษียณอ่าน settings ล่าสุดก่อนเขียนทั้งก้อนเพื่อไม่ทับค่าอื่น (ช่องแข่งกับหน้าบิลแคบมาก ผู้ใช้คนเดียวกดสองหน้าพร้อมกัน)
