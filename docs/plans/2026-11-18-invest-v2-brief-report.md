# บรีฟ W-F: Report (แบบร่าง 15) · branch `auto/invest-v2-report`

อ่าน `2026-11-18-invest-v2-brief-common.md` ก่อน

**เป้าหมาย:** หน้า Analytics → Report ตามแบบร่าง `15-analytics-report`
**ทำ:**
- ตารางรายเดือน + คอลัมน์ Total ตามแถวในแบบร่าง: Portfolio value (At the beginning / At the end / Change) · Total profit (Total profit % · Price change · Realized from sales · Dividends · Currency (FX) · Fees · Taxes) · Turnover (Total purchases · Total sales) · Total trades (Buy/Sell) · S&P 500 Market Performance (แสดง "Needs market data" เท่านั้น)
- กดชื่อแถวได้หลายแถวเพื่อให้แสดงเป็นแท่งสีของตัวเองในกราฟ + ปุ่ม Clear all
- Time grouping (Monthly/Quarterly/Yearly) · Time period
- Export to Excel = ไฟล์ .csv (BOM UTF-8 เปิดใน Excel ได้ · ป้องกัน CSV/formula injection: ค่าที่ขึ้นต้น `= + - @` ต้อง escape) · Export to PDF ผ่านหน้าพิมพ์ของเบราว์เซอร์ (`window.print()` + `@media print`)
**กฎ:**
- คอลัมน์ Total ของ Total profit % = R27 (ต่อทบรายเดือน) · รายเดือน = Modified Dietz R25.4
- **มุมมอง USD ต้องสร้าง Dietz เวอร์ชันเซนต์ใหม่** (`computeMonthlyReturns` เดิมเป็นสตางค์ ห้ามแก้ ให้เพิ่มไฟล์ใหม่)
- แหล่งกำไรรายเดือน = ผลต่างของกำไรสะสม (R24 `computeProfitSources` ณ ปลายเดือน − ปลายเดือนก่อน) ผลรวม 6 แหล่ง = กำไรรวมของเดือน ตรงเป๊ะ
- มูลค่าปลายเดือน = ราคาที่บันทึกล่าสุดก่อนหรือเท่าวันนั้น (R25.4) ไม่มี = ติดธง incomplete (R23) ไม่นับเป็น 0
- เดือนที่ไม่มีหุ้นและไม่มีรายการ ข้าม · แถวเงินของ Total = ผลบวกของเดือน · ไตรมาส/ปี ต่อทบจากรายเดือน (ไม่ต่อจากค่ากลุ่มที่ปัดแล้ว)
**ไม่ทำ:** ข้อมูล S&P 500 จริง · ไลบรารี xlsx · benchmark
**ไฟล์ที่แตะได้:** `src/ui/invest/pages/ReportPage.tsx` (แทนที่) · ไฟล์ใหม่ใน `src/ui/invest/report/` · domain ใหม่ `src/domain/invest/reportSeries.ts`, `src/domain/invest/twr.ts` · `tests/unit/investReportSeries.test.ts`, `investTwr.test.ts` · `tests/e2e/invest-report.spec.ts` · `report.css` ใหม่ · อ่าน `metrics.ts` ได้ ห้ามแก้
**เกณฑ์เสร็จ:**
- R27 ตัวอย่างมือผ่าน: +1,069/+1,000 → +2,176 · −500/−1,000 → −1,450 · +50/+50 → +100 · −3/−3 → −6 · มี null → null · ไม่มีเดือน → null
- ผลรวมแหล่งกำไรรายเดือน = กำไรรวมเดือนนั้น (สุ่มลำดับรายการ) · ไม่มีราคา → incomplete ไม่ใช่ 0
- Dietz USD: คำนวณตามสูตร R25.4 ด้วยเซนต์ และมีเทสต์ตัวอย่างมือของตัวเอง (หุ้นซื้อกลางเดือน ปันผล ขาย)
- CSV มีป้องกัน formula และสกุลตามปุ่ม
- e2e: กดเลือก 2 แถวแล้วกราฟแสดง 2 สี · Clear all คืนค่า · สลับ USD/THB ตัวเลขเปลี่ยน · Export ไม่ส่งคำขอออกนอกเครื่อง · 1280/1440/360/390
