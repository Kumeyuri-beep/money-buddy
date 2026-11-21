# บรีฟกลาง worker: Invest mode v2 รอบ 1 (อ่านก่อนบรีฟของงานตัวเอง)

เจ้าของอนุมัติแผน 18 พ.ย. 2569 · แผนรวม `docs/plans/2026-11-18-invest-v2-round1.md` · กฎ `docs/money-rules.md` R16 R17 R20 R23 R24 R25 **R26 R27 R28** (อ่านให้ครบก่อนเขียนโค้ดเงิน)
แบบร่าง: HTML อยู่ใน repo ที่ `docs/design/invest-v2/*.html` · ภาพ PNG อยู่เฉพาะเครื่องเจ้าของที่ `C:\Users\owenn\Documents\money-buddy\docs\design\invest-v2\*.png` (ไม่ได้ commit · อ่านด้วย Read ได้) · **ตัวเลขในแบบร่างเป็นข้อมูลตัวอย่าง ห้ามนำไปเป็นค่าจริงในโค้ดหรือเทสต์**

## วิธีทำงาน
- สร้าง worktree ของตัวเอง: `git fetch` แล้ว `git worktree add ../mb-<ชื่องาน> -b auto/invest-v2-<ชื่องาน> origin/main` ทำงานในนั้นเท่านั้น (รัน `npm ci` ในโฟลเดอร์นั้น)
- TDD: เทสต์ก่อน · ฟังก์ชันเงินต้องมีเทสต์ขอบเขต (0, ติดลบ, ปัดเศษ, ไม่มีราคา/เรต) · ตัวอย่างคำนวณมือในกฎต้องผ่าน
- เงินทุกตัวเป็น BigInt/จำนวนเต็มหน่วยย่อย (สตางค์/เซนต์) · เรตเป็น micro ×10^6 · ห้าม float กับเงิน · ห้ามมีสูตรเงินใน component (เรียก `src/domain/invest/*`) · ใช้ `roundHalfUpBig` ตัวเดียว ห้ามสร้างตัวปัดใหม่
- แปลงสกุลใช้ `src/domain/invest/displayCurrency.ts` (R26) เท่านั้น · ไม่มีเรต = `null` แล้วแสดง "Needs rate" · ห้ามเดา ห้ามใช้ต้นทุนแทนมูลค่าตลาด
- UI ใน /invest เป็นภาษาอังกฤษ · ข้อความ error ใช้ระบบ `{code, params}` (`src/domain/errors/coded`, `src/domain/invest/errorCodes.ts` · เพิ่มรหัสใหม่ทั้ง th/en ตามแบบเดิม · รหัสไม่ซ้ำทั้งโปรเจกต์)
- สกุลที่แสดงอ่านจาก `useInvest().currency` · ขอบเขตรอบนี้ = หุ้นและเงินสด USD เท่านั้น
- ดีไซน์: Aurora Glass เดิมใน `src/ui/invest/invest.css` · ตัวหนังสือผ่าน WCAG AA ทั้ง dark/light · คีย์บอร์ดใช้ได้ · มือถือ (<1024px) ห้ามพัง: Playwright 360/390 ผ่านและไม่ล้นจอ
- ก่อนส่ง: `npm test` · `npm run typecheck` · `npm run build` · `npx playwright test <ไฟล์เทสต์ของงาน> tests/e2e/invest-mode.spec.ts`
- commit ระบุกฎที่แตะ เช่น `[R24,R26] ...` · push ด้วยชื่อ branch เต็ม `git push -u origin auto/invest-v2-<ชื่องาน>` · `gh pr create` ชื่อขึ้นต้น `[invest-v2]` · **ห้าม merge เอง**
- สรุปไทยง่ายๆ ลง `docs/learning/<วันที่>-invest-v2-<ชื่องาน>.md` (ไฟล์ใหม่ของตัวเอง)
- หน้าของโหมดนี้ต้องมีหัวข้อ `<h2>` ของหน้าตัวเองในเนื้อหา (หน้า Dashboard/Analytics เดิมมีอยู่แล้ว) · `<h1>` ซ่อนอยู่ที่ `InvestMode.tsx` แล้ว

## ห้ามแตะ (ไฟล์กลางของ GM)
`docs/HANDOFF.md` · `docs/money-rules.md` · `CLAUDE.md` · `.github/` · `src/app/route.ts` · `src/ui/useViewHistory.ts` · `src/ui/invest/InvestMode.tsx` · `src/ui/invest/InvestTopBar.tsx` · ตัวแปรสี/ขนาดกลางใน `src/ui/styles.css` · `supabase/` และ `src/storage/` · `.env*` และ `.money-buddy-admin`
- แก้ได้ในไฟล์กลางเดียว: `src/app/investRoute.ts` เฉพาะบรรทัด `live/soon` ของหน้าตัวเอง (และรายการหน้า live ใน `tests/unit/investRoute.test.ts`)
- ต้องแก้ไฟล์ที่ห้าม หรือพบว่าต้องแก้ฐานข้อมูล = **หยุดแล้วส่งเรื่องกลับ GM** ห้ามเขียน migration/SQL เอง
- ห้าม `git push --force`, `git rebase`, `git reset --hard`, `rm -rf` · อัปเดตตัวเองด้วย `git merge origin/main` เท่านั้น

## ส่งกลับ GM (ข้อความสุดท้าย)
ลิงก์ PR · สรุปไทย · ไฟล์ domain ที่เพิ่ม · เทสต์ที่เพิ่มและผล · ข้อสังเกต/ความเสี่ยง · เรื่องที่ต้องแก้ไฟล์กลาง · ข้อมูลที่ขาด
