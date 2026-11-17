# แปลแท็บ Portfolio ส่วนหุ้นสหรัฐเป็นอังกฤษ

## ทำอะไร
แปลข้อความบนหน้าจอของแท็บย่อย "Overview" และ "US stocks" ในโหมด /invest เป็นภาษาอังกฤษ ได้แก่ PortfolioPage, UsOverview, UsStocksView และ PortfolioTransfer
รวมฟอร์มสร้างบัญชีเงินสด USD ซื้อ/ขาย/ปันผล แลกเงิน อัปเดตราคา/อัตรา ตารางหุ้นที่ถือ ปันผลล่าสุด ประวัติแลกเงิน ข้อความว่าง และคำเตือน
วันที่ใช้ `formatDateEn` (ค.ศ.) แทน `thaiDayLabel` · ข้อความอัตราแลกเปลี่ยนเปลี่ยนจาก "บาท/USD" เป็น "THB/USD" (`fxRateText`)

## ทำไม
เจ้าของสั่ง (17 พ.ย. 2569) ให้ข้อความในโหมด /invest เป็นอังกฤษทั้งหมด หน้าอื่นของแอปยังเป็นไทย

## ไม่ได้เปลี่ยน
ตรรกะ ตัวเลข สูตร ลำดับ id และคีย์บอร์ด เหมือนเดิม · ข้อความ error ที่โยนมาจาก domain/storage ยังเป็นไทย (ตามขอบเขตบรีฟ)

## ทดสอบอย่างไร
- แก้เทสต์ที่อ้างข้อความไทย: `us-stocks.spec`, `invest-mode.spec`, `invest-dashboard-data.spec`, `usdFormat.test`
- ชื่อ tablist ของแท็บย่อยตั้งเป็น "Portfolio views" เพราะแถบแท็บบนสุดใช้ชื่อ "Portfolio sections" อยู่แล้ว (ชื่อซ้ำทำให้เทสต์สับสน)
- รัน `npm test`, `npm run typecheck`, `npm run build` และ Playwright 360/390/1280/1440
