# บรีฟ W-E: My goal (แบบร่าง 23) · branch `auto/invest-v2-goal`

อ่าน `2026-11-18-invest-v2-brief-common.md` ก่อน

**เป้าหมาย:** หน้า Portfolio → My goal ตามแบบร่าง `23-portfolio-my-goal` (เมนูชี้มาที่หน้านี้แล้ว · ปุ่ม Set a target บน Dashboard ยังไปแผนเกษียณเดิม ไม่ต้องเปลี่ยน)
**ทำ:**
- เป้า Value หรือ Passive income (ต่อเดือน) · Achieve by · Contributions (ต่อเดือน) · ส่วนขยาย Returns and inflation (ผลตอบแทนคาดหวังต่อปี, เงินเฟ้อ) / Other · ปุ่ม Save and calculate
- กราฟคาดการณ์ + เส้นเป้า + ปีที่ถึงเป้า + การ์ด (Passive income now · Goal reached · Portfolio needed) · สถานะ On track / Behind
- ข้อความ **"Projection, not a promise"** ติดทุกจุดที่แสดงผล · บันทึกค่าไว้ต่อผู้ใช้
**กฎ:** สูตรตาม **R28** (BigInt, bps, ปัดครึ่งออกจากศูนย์) · มูลค่าตั้งต้นจากพอร์ต (ราคาล่าสุด×เรต) · yield จาก R25.2 (`computeDividendMetrics`) ไม่มี = "Needs data" ห้ามเดา · สกุลตาม R26 · Contributions ตั้งต้นเสนอค่าเฉลี่ยจากรายการซื้อจริง (คำนวณใน domain) ผู้ใช้แก้ได้
**ที่เก็บ:** `settings` jsonb ผ่าน `FinanceSettings` ฟิลด์ใหม่เดียว (เช่น `investGoal`) ใน `src/domain/bills/settings.ts` + `settingsPatch.ts` พร้อมตรวจรูปแบบ/ขนาด · **สองไฟล์นี้เป็นข้อยกเว้นที่แตะได้ ฟิลด์เดียวเท่านั้น และแจ้ง GM ใน PR** · ไม่มี migration ห้ามแตะ `supabase/` · ขนาดรวมไม่เกิน `MAX_SETTINGS_BYTES`
**ไม่ทำ:** เชื่อมกับแผนเกษียณ R18 · ข้อมูลตลาด
**ไฟล์ที่แตะได้:** `src/ui/invest/pages/GoalPage.tsx` (แทนที่) · ไฟล์ใหม่ใน `src/ui/invest/goal/` · domain ใหม่ `src/domain/invest/goalProjection.ts` · `tests/unit/investGoalProjection.test.ts` + เทสต์ settings · `tests/e2e/invest-goal.spec.ts` · `goal.css` ใหม่
**เกณฑ์เสร็จ:**
- ตัวอย่างมือ R28 ตรงเป๊ะ: V₀=100,000 · C=10,000 · r=1,200 · y=300 → V₁=111,000 · V₂=122,110 · V₃=133,331 · เป้ามูลค่า 130,000 → เดือนที่ 3 · เป้ารายได้ 300 → เดือนที่ 2
- เป้า 0 → เดือน 0 · ไม่ถึงใน 1,200 เดือน → null · i=r → r_real=0 · ไม่มีข้อมูล → ไม่คำนวณ + เหตุผล · ค่าติดลบ/เกินช่วงถูกปฏิเสธ
- e2e: บันทึกแล้วจำค่าหลังโหลดใหม่ · สลับ Value/Passive income · มีข้อความ "Projection, not a promise" · USD/THB เปลี่ยนตัวเลข · 1280/1440/360/390
