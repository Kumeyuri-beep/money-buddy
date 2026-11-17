# บรีฟลูกน้อง A: แท็บ Analytics เป็นอังกฤษ + ย้ายการ์ด "กำไรมาจากไหน" มาไว้ที่นี่
branch: `auto/invest-en-analytics`

## ขอบเขต
1. แปลทุกข้อความใน `src/ui/invest/AnalysisTab.tsx` และ `src/ui/invest/analysis/**` เป็นอังกฤษ (หัวข้อแท็บชื่อ "Analytics"; ตอนนี้หัวข้อ h2 เป็น "วิเคราะห์พอร์ต")
2. **ย้ายการ์ด "กำไรมาจากไหน" (6 แหล่งกำไรของ R24) มาไว้ในแท็บ Analytics** เป็นการ์ดใหม่ชื่อ "Where the profit comes from" · ใช้ `computeProfitSources` / `profitSourceRows` / `barPercent` จาก `src/domain/invest/metrics.ts` และ `src/ui/invest/dashboard/dashboardView.ts` (มีอยู่แล้ว ห้ามคิดเลขเอง) · แถบแนวนอน 6 แหล่ง · ป้ายภาษาอังกฤษ: Price gain (unsold), Price gain (sold), Options, Dividends (before tax), Currency effect (— ในมุมมอง USD), Fees and tax withheld · ตามสกุล ฿/USD ของปุ่มบนแถบบน · ไม่ครบข้อมูล (ไม่มีราคา/อัตรา) = การ์ดบอกเหตุผล ห้ามเลขปลอม (R20.7) · ผลรวม 6 แหล่งต้องเท่ายอด Total profit (ตัวอย่างหลัก R24: 774,113 สตางค์ / 27,050 เซนต์) · มีเทสต์ render
3. อัปเดตเทสต์: `tests/unit/investAnalysis*.test.ts`, `tests/e2e/invest-analysis.spec.ts`, `tests/e2e/invest-mode.spec.ts` (บรรทัดที่อ้างหัวข้อแท็บวิเคราะห์)

## ไฟล์ที่แตะได้
`src/ui/invest/AnalysisTab.tsx`, `src/ui/invest/analysis/**`, เทสต์ข้างต้น, `docs/learning/` (สรุปไทย 1 ไฟล์) · ห้ามแตะ: HANDOFF.md, money-rules.md, CLAUDE.md, `src/ui/invest/dashboard/**` (อ่านและ import ได้ แก้ไม่ได้), `src/domain/**`, `src/storage/**`, `src/ui/styles.css`

## เกณฑ์เสร็จ
ข้อความทั้งแท็บเป็นอังกฤษ · การ์ด 6 แหล่งแสดงถูกทั้ง ฿/USD และ empty/ไม่ครบ · `npm test`/typecheck/build ผ่าน · Playwright invest-analysis ผ่านที่ 360/390/1280/1440 · ตัวหนังสือผ่าน WCAG AA ทั้งโหมดมืด/สว่าง

## กติการ่วม (อ่านก่อนเริ่ม)
- อ่าน CLAUDE.md หัวข้อ "กติกา GM/ลูกน้อง" และ `docs/money-rules.md` (ห้ามแก้) · ทำใน worktree/branch ของตัวเอง (ชื่อ branch ด้านล่าง) แตกจาก `origin/main` ล่าสุด · push เฉพาะ `auto/*` ด้วยชื่อเต็ม · ห้าม merge/force/rebase/แตะฐานข้อมูล/อ่าน .env*
- เป้าหมาย: ข้อความที่ผู้ใช้เห็นในโหมด /invest เป็นภาษาอังกฤษทั้งหมด (เจ้าของสั่ง 17 พ.ย. 2569) หน้าอื่นของแอปยังเป็นไทย
- **แปลเฉพาะข้อความบนหน้าจอ** (label ปุ่ม หัวข้อ placeholder aria-label ข้อความว่าง ข้อความอธิบาย tooltip) · **ห้ามเปลี่ยนตรรกะ ตัวเลข สูตร ลำดับ หรือ id/โครงที่เทสต์อื่นพึ่ง** · ไม่แตะ `src/domain/**` และ `src/storage/**` → ข้อความ error ที่โยนมาจาก domain/storage (ภาษาไทย) ปล่อยไว้ก่อน แล้วจดรายการไว้ในสรุปส่งกลับ
- วันที่ใช้ `formatDateEn` / `formatDayMonthEn` จาก `src/app/dateEn.ts` (ค.ศ.) แทน thaiDayLabel · เงินใช้ตัวช่วยเดิม (`baht`, `usd`)
- ศัพท์การเงินให้ตรงมาตรฐาน (cost basis, unrealized gain, dividend, withholding tax, exchange rate ฯลฯ) ถ้าไม่แน่ใจความหมายทางภาษี/การเงิน ให้ถามไม่เดา
- เทสต์ที่อ้างข้อความไทยของไฟล์ที่แตะ (unit + `tests/e2e`) ต้องแก้ให้ตรงข้อความใหม่ · รัน `npm test`, `npm run typecheck`, `npm run build` และ Playwright ของสเปคที่เกี่ยวข้อง (1280/1440 และ 360/390) ให้ผ่านก่อนส่ง · ที่เหลือใน CI GM จะรัน
- บรีฟนี้ไม่มีงาน migration: ถ้าพบว่าต้องแก้ฐานข้อมูล ให้หยุดและส่งกลับ GM
- ส่งกลับ GM: สรุปภาษาไทยง่ายๆ (แปลอะไร ทดสอบอะไร) · ข้อความไทยที่ยังเหลือและเหตุผล · ข้อสังเกต · เรื่องที่ต้องแก้ไฟล์กลาง · เปิด PR จาก branch ของตัวเอง ห้าม merge เอง
