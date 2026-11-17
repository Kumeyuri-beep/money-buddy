# แปลส่วน "ภาพรวมพอร์ต" (กองทุน/หุ้นบาท) ในโหมด /invest เป็นอังกฤษ

## ทำอะไร
แปลข้อความบนหน้าจอเป็นภาษาอังกฤษใน 6 ไฟล์ที่ใช้เฉพาะแท็บ Portfolio ของ /invest: `PortfolioView`, `AssetFigures`, `TermHelp`, `TradeItem`, `DcaPlansCard`, `ShareCardPanel` (ปุ่ม ฟอร์ม ข้อความว่าง ข้อความช่วยเหลือ aria-label) ตรรกะและตัวเลขไม่เปลี่ยน

## ทำไม
เจ้าของสั่ง (17 พ.ย. 2569) ว่าข้อความที่ผู้ใช้เห็นในโหมด /invest ต้องเป็นอังกฤษทั้งหมด หน้าอื่นของแอปยังเป็นไทย

## ข้อที่ต้องรู้
- วันที่ใช้ `formatDateEn` (ค.ศ.) เงินใช้ `baht` เดิม
- คำอธิบายศัพท์ (Cash dividend / Reinvested dividend / Withholding tax) ย้ายมาเป็นอังกฤษใน `TermHelp.tsx` (`TERM_EN`) เพราะ `GLOSSARY` ใน domain ยังเป็นไทยและห้ามแตะ domain · คีย์ยังเป็นคำไทยเดิมเพื่อให้โยงกับ domain ได้
- ชื่อชนิดสินทรัพย์ (Fund/Stock/Other) ใช้ `ASSET_KIND_LABEL_EN` ใน `AssetFigures.tsx` เพราะ `ASSET_KIND_LABEL` ของ domain ยังเป็นไทย
- ภาพที่ส่งออกจากการ์ดแชร์ (canvas) ยังเป็นไทย เพราะวาดโดย `shareCardCanvas.ts` กับ `allocationView.ts` ซึ่งอยู่นอกขอบเขต

## ทดสอบอย่างไร
- `npm test` (แก้เทสต์ที่อ้างข้อความไทยของ 6 ไฟล์ให้ตรงข้อความใหม่) · `npm run typecheck` · `npm run build`
- Playwright 360/390/1280/1440 ชุด invest-* และ us-stocks ผ่านหมด
- หมายเหตุ: ฮาร์เนส Playwright ไม่รองรับการเขียนพอร์ต (ที่เก็บในเครื่อง) จึงไม่มีเทสต์หน้าจอที่กรอกฟอร์มซื้อขายจริง
