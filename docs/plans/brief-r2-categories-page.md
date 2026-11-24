# บรีฟ worker B: หน้า Portfolio → Categories (+ ช่อง Sector ในฟอร์มหุ้น)

**branch/worktree:** `auto/r2-categories-page` แตกจาก `origin/main` ล่าสุด ใน git worktree ของตัวเอง (`git worktree add -b auto/r2-categories-page ../money-buddy-wt-categories origin/main`) · push ชื่อเต็มเท่านั้น · ห้าม merge/rebase/force push · `git merge origin/main` เท่านั้น · ห้าม `git add -A`/`.` · commit+push ทุกครั้งที่จบชิ้น · PR ชื่อ `[invest-v2-r2] หน้า Categories` · commit ระบุกฎ `[R16,R20,R23]`

## เป้าหมาย
หน้า Categories ตามแบบร่าง `docs/design/invest-v2/25-portfolio-categories.html/.png` (ดูรูปด้วย) ใช้ข้อมูลหมวดที่มีแล้วบน main (ฐานข้อมูลและชั้น repository พร้อม: `repository.saveCategories(categories, assignments)`, `loadInvestments()` คืน `categories` + `asset.sector/categoryId`, `categoriesProblem` ใน `src/domain/invest/categories.ts`) · อ่านข้อเสนอ `docs/proposals/R2-categories.md` ข้อ 2, 4, 5 ก่อน

## ขอบเขต
**ทำ:**
1. หน้า `src/ui/invest/pages/CategoriesPage.tsx` (+ ไฟล์ย่อยใน `src/ui/invest/categories/`): รายการหมวด · เป้า % ต่อหมวด (แสดงเป็น % จาก bps · เก็บ bps จำนวนเต็ม ห้าม float ใช้ฟังก์ชันแปลงใน domain ถ้ายังไม่มีให้เขียนฟังก์ชันล้วนใน `src/domain/invest/` พร้อมเทสต์) · ผลรวมเป้าต้อง 100% พอดีก่อนกด Save (ถ้ายังไม่ครบ แสดงส่วนที่ขาด/เกินและปิดปุ่ม Save) · เพิ่ม/เปลี่ยนชื่อ/ลบ/จัดลำดับหมวด · ย้ายสินทรัพย์ไปหมวด · "Uncategorized" (ไม่มีหมวด) · ปุ่ม "Create categories from sectors" (จัดกลุ่มตาม `asset.sector` ของสินทรัพย์ที่ถืออยู่ → ส่ง `saveCategories`; สินทรัพย์ไม่มี sector = Uncategorized) · รวมหมวด
2. ตารางสรุปต่อหมวด (มูลค่า/ลงทุน/กำไร/สัดส่วน/เทียบเป้า) **ใช้ฟังก์ชัน domain ที่มีอยู่** (`allocation.ts`, `holdingsView.ts`, `metrics.ts` ฯลฯ ดูที่หน้า Holdings ใช้) ห้ามคิดสูตรเงินใน component · แยกสกุล ห้ามบวกข้ามสกุล (R20) · ค่าที่ไม่มีราคา = "—" ห้ามเดา (R20.7)
3. ช่อง Sector ในฟอร์มเพิ่มหุ้น (`UsStocksView` หรือ dialog Add ของหน้า Holdings): เลือกจากรายการ GICS 11 กลุ่มหรือพิมพ์เอง ไม่บังคับ ตรวจด้วย `validSector` · ต้องส่งผ่าน repository (ถ้าต้องเพิ่มเมธอดใน `src/storage/` ให้แจ้ง GM ก่อน เพราะต้องแก้ SQL ไม่ได้)
4. ข้อความผิดพลาด: ใช้ `store.category*` ที่มีอยู่ (ห้ามแสดง/`console.log` payload ฐานข้อมูล) · ข้อความสองภาษาตามระบบเดิม
5. ปุ่ม Export/Import หมวดและเป้าเป็น CSV/JSON: ส่งออกใช้ `csvText` (กัน formula injection) · นำเข้าใช้ `categoriesProblem` ตรวจก่อนส่ง · ถ้าเกินเวลา ให้ทำเฉพาะส่งออกแล้วจดนำเข้าใน `docs/HANDOFF.md` backlog ผ่าน GM (รายงานกลับ ไม่แก้ไฟล์นั้นเอง)
**ไม่ทำ:** Rebalancing · แก้/ลบรายการซื้อขาย · migration/SQL · "See tutorial" · มือถือ (ห้ามพัง: ครอบสไตล์เฉพาะคอมด้วย `@media (min-width: 1024px)` ตามกติกา "หน้าเว็บบนคอมก่อน" ใน CLAUDE.md)

## ไฟล์ที่แตะได้
`src/ui/invest/pages/CategoriesPage.tsx` · `src/ui/invest/categories/**` · `src/ui/invest/invest.css` (เฉพาะส่วนใหม่ของหน้านี้) · จุดลงทะเบียนหน้าใน `src/ui/invest/InvestMode.tsx` (แก้ขั้นต่ำ 1-3 บรรทัด แจ้งใน PR) · ฟอร์มเพิ่มหุ้น · `src/domain/invest/` (ฟังก์ชันล้วนใหม่) · `tests/unit/**` · `tests/e2e/invest-categories.spec.ts`
## ห้ามแตะ
`docs/HANDOFF.md` · `docs/money-rules.md` · `CLAUDE.md` · `supabase/**` · design tokens ใน `src/ui/styles.css` (ตัวแปรสี/ขนาดกลาง) · routes หลักอื่น

## เกณฑ์เสร็จ
- เทสต์หน่วย: แปลง bps↔%, รวมเป้า, จัดกลุ่มจาก sector, รวมหมวด, ขอบเขต (หมวดว่าง, 50 หมวด, เป้า 0%, 99.99%/100.01% ปฏิเสธ, ชื่อซ้ำไม่สนตัวพิมพ์)
- Playwright 1280 และ 1440 (หลัก) + 360/390 ต้องผ่านเหมือนเดิม (มือถือไม่เปลี่ยนหน้าตา): ตั้งหมวดและเป้า → Save → รีโหลดยังอยู่ · เป้ารวมไม่ครบ Save ไม่ได้ · สร้างจาก sector · ลบหมวดแล้วสินทรัพย์เป็น Uncategorized · คีย์บอร์ดใช้ได้
- `npm test` + `npm run typecheck` + `npm run build` ผ่าน · glass: การ์ดกระจกไม่เกินโควตา รายการ/ตารางพื้นทึบ · ตัวหนังสือผ่าน WCAG AA
- สรุปไทยใน `docs/learning/` · ผลวินิจฉัยห้ามใส่ข้อมูลการเงินจริง ใช้ข้อมูลสมมติ

## ส่งกลับ GM
สรุปไทย · ข้อสังเกต/จุดที่แบบร่างไม่ชัด (อย่าเดา ให้ถาม) · เรื่องที่ต้องแก้ไฟล์กลาง/SQL/HANDOFF · ลิงก์ PR (GM เรียก design-critic เอง)
