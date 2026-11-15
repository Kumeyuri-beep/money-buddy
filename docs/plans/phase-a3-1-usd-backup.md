# A3-1: ไฟล์สำรอง/นำเข้าส่งออกรองรับ USD + Integrity ต้นทุน USD + ตัวตรวจเงินสด USD ติดลบ

เจ้าของสั่ง 15 พ.ย. 2569 (PR แรกของ A3 · ยังไม่มีหน้าจอสร้างข้อมูล USD · A3-2 เป็นหน้าจอ ทำหลัง A3-1 merge)

## ขอบเขต
1. ไฟล์สำรอง `investments` เพิ่มฟิลด์ (ทุกฟิลด์ใหม่ "ไม่ใส่" เมื่อเป็นข้อมูลบาทเดิม → ไฟล์บาทเดิมเหมือนเดิมทุกไบต์ นำเข้าไฟล์เก่าได้เหมือนเดิม):
   - `assets[].currency` ('USD' เท่านั้น ไม่ใส่ = THB), `assets[].ticker`, `assets[].exchange`
   - `trades[].fxRateMicro` (บาทต่อ 1 USD x 10^6)
   - `fxRates[]` = `{accountId, date, rateMicro}` · `fxExchanges[]` = `{id, date, createdAt, direction, thbSatang, usdCents, rateMicro, memo, entryId}`
2. ตัวตรวจไฟล์ `parseInvestments`: สินทรัพย์ USD ต้องผูกบัญชีลงทุนสกุล USD · รายการ USD ต้องมี `fxRateMicro` และ `entryId` ไม่รับปันผลลงทุนต่อ · รายการบาทห้ามมี `fxRateMicro` · เล่นซ้ำต้นทุน 2 ถัง (`replayTradesFx`) จับขายเกิน/ต้นทุนบาท < 1 · การแลกเงิน: อัตราต้องเท่ากับที่คำนวณจากสองจำนวน และ Entry ที่ผูกต้องเป็น 4 บรรทัดตรงจำนวน
3. ส่งออก (`supabaseRepository`): อ่านคอลัมน์/ตารางใหม่ · แปลงเป็นไฟล์ · นำเข้า RPC `import_ledger_investments` ฉบับใหม่ (migration `20261115000300`) รับ USD ครบ · ผลที่ RPC คืน: คงรูปเดิมเมื่อไม่มีข้อมูล USD (เทสต์เดิมไม่เปลี่ยน)
4. Integrity ฝั่งเว็บ (`checkUsdInvestmentIntegrity`): ต้นทุน USD ของบัญชีสินทรัพย์ในสมุด = Cusd ที่เล่นซ้ำ · การแลกเงินตรงกับ Entry · เชื่อมเข้า `runIntegrityCheck` (พารามิเตอร์ที่สามไม่บังคับ)
5. `negativeUsdCash`: ฟังก์ชันล้วนบอกบัญชีเงินสด USD ที่ยอดติดลบ (ให้หน้าจอ A3-2 ใช้เตือน)
6. migration เดียว: นำเข้า USD + `revoke all ... from public, anon, authenticated` ให้ trigger function ใหม่ของ A2 ใน schema private (ไม่มีผลจริง แต่ตรงแบบแผนเดิม) รันเทสต์ SQL ครบรอบเดียว
7. ถ้อยคำ R20.3: money-auditor เสนอข้อความใหม่ในแชท **รอเจ้าของอนุมัติ ห้ามแก้ money-rules.md**

## ไม่ทำใน PR นี้
หน้าจอ (A3-2) · ราคาอัตโนมัติ (เฟส B) · ที่เก็บในเครื่อง Dexie (ไม่รองรับข้อมูลลงทุนอยู่แล้ว) · Integrity ต้นทุนฝั่งบาท (คงเดิม)

## เทสต์ (เขียนก่อนโค้ด)
- หน่วย: ส่งออก→JSON→ตรวจไฟล์ ได้ข้อมูลเดิมทุกเซนต์/สตางค์ · ไฟล์บาทเดิมไม่มีฟิลด์ใหม่ · ไฟล์ผิดรูปแบบแต่ละข้อถูกปฏิเสธ · Integrity/เงินสดติดลบ
- SQL: `usd_backup_import_test.sql` (นำเข้า USD ครบ, ไฟล์บาทเดิมคืนรูปเดิม, ซ้ำ/ข้ามผู้ใช้/ผิดรูปแบบถูกปฏิเสธ, สิทธิ์ trigger function) + รันครบทุกไฟล์ (migration มี REVOKE)
- live-contract บน branch ก่อน merge และบน main หลัง merge
