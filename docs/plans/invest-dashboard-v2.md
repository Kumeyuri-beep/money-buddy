# แผน: หน้า Dashboard ใหม่ของโหมด /invest (แบบร่างของเจ้าของ 17 พ.ย. 2569)

อ้างอิงแบบร่าง: `docs/design/invest-dashboard-full.png`, `…-hover-slice.png`, `…-warning-popover.png`, `…-portfolio-menu.png`, `…-mockup.html` (ใช้ดูสี/ระยะ ไม่ก๊อปตรงๆ) · ตัวเลขในภาพเป็นตัวอย่าง

## กติกาของงานนี้ (เจ้าของสั่ง)
- ข้อความในโหมด /invest เป็นภาษาอังกฤษ (หน้าอื่นของแอปยังเป็นไทย)
- ตัวเลขเงินมาจากฟังก์ชันใน `src/domain` / `src/app` เท่านั้น (R17/R20/R24/R25) · ข้อมูลที่ยังไม่มี = การ์ดอยู่ที่เดิมพร้อม empty state "Available after automatic data is enabled" ห้ามเลขปลอม
- ไม่ทำ migration · มือถือ 360/390 ต้องไม่พัง · เคารพ prefers-reduced-motion

## PR 1 (ทำแล้ว): แถบบน + 4 การ์ดตัวเลข + การ์ด Portfolio
- แถบบน: แท็บ Dashboard / Analytics / Portfolio / Tools (Analytics = แท็บวิเคราะห์เดิม, Portfolio = แท็บรายการเดิม, Tools = ว่าง) · AI/Search/Watchlist ปิดพร้อม tooltip · + Add เปิดแท็บ Portfolio ส่วนหุ้นสหรัฐ (ฟอร์มเดิม) · สลับ ฿/$ · เมนูพอร์ต
- เมนูพอร์ต: เก็บ Name / Description / Default currency ใน settings เดิม (คีย์ `portfolioName`, `portfolioNote`, `portfolioCurrency`) **ไม่ต้อง migration** เพราะตาราง `settings` เป็น jsonb ทั่วไป (ฟังก์ชัน `merge_settings` ไม่มีรายชื่อคีย์ มีแค่เพดานขนาด) · เหมือนที่เคยเพิ่ม `theme`/`cashFlowView`
- 4 การ์ด: Value (ปุ่มตาซ่อน/แสดง จำใน localStorage · ชิป Worth in 10 years? → แผนเกษียณ) · Total profit (+% ตาม R24.5 · ซ่อนบรรทัด Today) · IRR (เกณฑ์ 30 วัน R25) · Passive income
- การ์ด Portfolio: โดนัท + ตาราง · Holdings (เริ่มต้น) / Currency · Sector ปิดไว้ · ชี้แล้วพอง/จาง/ไฮไลต์/กลางวง · ปุ่ม Warning เฉพาะหุ้นตัวเดียว > 20%
- เอาออกจากหน้านี้ (ตามแบบร่างใหม่): การ์ดกราฟมูลค่าย้อนหลัง, วันนี้ขึ้น/ลง (กลับมาใน PR 2 เป็น Top day gainers/losers), ปันผลรายเดือน (กลับเป็น Future payments), กำไรมาจากไหน 6 แหล่ง (ฟังก์ชัน R24 ยังอยู่ ใช้คำนวณ Total profit) · การ์ดความมั่งคั่งรวมเดิม (WealthPanel) ยังอยู่หน้าภาพรวมของแอป

## PR 2 (ต่อไป · หลัง PR 1 merge): การ์ดที่เหลือ
Top day gainers / losers (empty state + ⓘ + ปุ่ม sort) · Recent and upcoming events · Future payments (แท่ง Received ใช้ปันผลจริง `monthlyDividends` · Forecast รอข้อมูลอัตโนมัติ) · My goal (ปุ่ม Set a target → แผนเกษียณ)

## ไฟล์หลัก PR 1
`src/ui/invest/` (InvestMode, InvestTopBar, Tip, ToolsTab, invest.css, dashboard/StatCards, dashboard/PortfolioCard, dashboard/dashboard.css) · `src/app/investPortfolioView.ts` (+ เทสต์) · `src/domain/bills/settings*.ts` (3 คีย์ใหม่) · `src/dev/investDemo.ts` + harness `?investDemo=1` (ข้อมูลสมมติสำหรับทดสอบหน้าจอ ไม่เข้า build จริง)
