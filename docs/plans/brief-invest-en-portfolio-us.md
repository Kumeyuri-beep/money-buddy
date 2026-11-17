# บรีฟลูกน้อง C: แท็บ Portfolio ส่วน "หุ้นสหรัฐ" + โครงแท็บย่อย เป็นอังกฤษ
branch: `auto/invest-en-portfolio-us`

## ขอบเขต
แปลข้อความบนหน้าจอของ: `src/ui/PortfolioPage.tsx` (แท็บย่อย "ภาพรวมพอร์ต" → "Overview", "หุ้นสหรัฐ" → "US stocks" · aria-label ของ tablist), `src/ui/UsStocksView.tsx`, `src/ui/UsOverview.tsx`, `src/ui/PortfolioTransfer.tsx` (โอนเข้า-ออกพอร์ต) · ฟอร์มสร้างบัญชีเงินสด USD ซื้อ/ขาย/ปันผล แลกเงิน ราคา/อัตรา ตารางปันผลล่าสุด/ประวัติแลกเงิน ข้อความว่าง/คำเตือน
อัปเดตเทสต์ที่อ้างข้อความไทยของไฟล์เหล่านี้ และสเปคที่พาไปแท็บ/ปุ่มเหล่านี้: `tests/e2e/us-stocks.spec.ts`, `tests/e2e/invest-mode.spec.ts` (ชื่อแท็บย่อย "หุ้นสหรัฐ", ปุ่ม "สร้างบัญชีเงินสด USD"), `tests/e2e/invest-dashboard-data.spec.ts` (แท็บย่อย "หุ้นสหรัฐ" ในเทสต์ปุ่ม + Add) และเทสต์ unit ที่อ้างถึง (grep)

## ไฟล์ที่แตะได้
ไฟล์ข้างต้น + เทสต์ที่อ้างถึง + `docs/learning/` (สรุปไทย 1 ไฟล์) · ห้ามแตะ: `PortfolioView.tsx` และไฟล์ลูก (ของลูกน้อง B), `src/ui/invest/**` (ของลูกน้อง A และ GM ยกเว้นตามที่ระบุ), HANDOFF.md, money-rules.md, CLAUDE.md, domain, storage

## เกณฑ์เสร็จ
แท็บ Portfolio → US stocks ไม่เหลือข้อความไทยที่มาจากไฟล์ข้างต้น · ตรรกะ/ตัวเลข/โฟกัส/คีย์บอร์ดไม่เปลี่ยน · npm test/typecheck/build ผ่าน · us-stocks.spec และ invest-mode.spec ผ่านที่ 360/390/1280/1440

## กติการ่วม (อ่านก่อนเริ่ม)
- อ่าน CLAUDE.md หัวข้อ "กติกา GM/ลูกน้อง" และ `docs/money-rules.md` (ห้ามแก้) · ทำใน worktree/branch ของตัวเอง (ชื่อ branch ด้านล่าง) แตกจาก `origin/main` ล่าสุด · push เฉพาะ `auto/*` ด้วยชื่อเต็ม · ห้าม merge/force/rebase/แตะฐานข้อมูล/อ่าน .env*
- เป้าหมาย: ข้อความที่ผู้ใช้เห็นในโหมด /invest เป็นภาษาอังกฤษทั้งหมด (เจ้าของสั่ง 17 พ.ย. 2569) หน้าอื่นของแอปยังเป็นไทย
- **แปลเฉพาะข้อความบนหน้าจอ** (label ปุ่ม หัวข้อ placeholder aria-label ข้อความว่าง ข้อความอธิบาย tooltip) · **ห้ามเปลี่ยนตรรกะ ตัวเลข สูตร ลำดับ หรือ id/โครงที่เทสต์อื่นพึ่ง** · ไม่แตะ `src/domain/**` และ `src/storage/**` → ข้อความ error ที่โยนมาจาก domain/storage (ภาษาไทย) ปล่อยไว้ก่อน แล้วจดรายการไว้ในสรุปส่งกลับ
- วันที่ใช้ `formatDateEn` / `formatDayMonthEn` จาก `src/app/dateEn.ts` (ค.ศ.) แทน thaiDayLabel · เงินใช้ตัวช่วยเดิม (`baht`, `usd`)
- ศัพท์การเงินให้ตรงมาตรฐาน (cost basis, unrealized gain, dividend, withholding tax, exchange rate ฯลฯ) ถ้าไม่แน่ใจความหมายทางภาษี/การเงิน ให้ถามไม่เดา
- เทสต์ที่อ้างข้อความไทยของไฟล์ที่แตะ (unit + `tests/e2e`) ต้องแก้ให้ตรงข้อความใหม่ · รัน `npm test`, `npm run typecheck`, `npm run build` และ Playwright ของสเปคที่เกี่ยวข้อง (1280/1440 และ 360/390) ให้ผ่านก่อนส่ง · ที่เหลือใน CI GM จะรัน
- บรีฟนี้ไม่มีงาน migration: ถ้าพบว่าต้องแก้ฐานข้อมูล ให้หยุดและส่งกลับ GM
- ส่งกลับ GM: สรุปภาษาไทยง่ายๆ (แปลอะไร ทดสอบอะไร) · ข้อความไทยที่ยังเหลือและเหตุผล · ข้อสังเกต · เรื่องที่ต้องแก้ไฟล์กลาง · เปิด PR จาก branch ของตัวเอง ห้าม merge เอง
