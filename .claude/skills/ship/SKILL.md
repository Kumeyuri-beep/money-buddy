---
name: ship
description: เจ้าของพิมพ์ /ship เมื่อต้องการส่งงานขึ้น GitHub และ Vercel ตรวจครบแล้วรอยืนยันก่อน push
disable-model-invocation: true
---

# Ship: ตรวจแล้วส่งงาน

ทำตามลำดับ หยุดทันทีถ้าขั้นไหนไม่ผ่าน แล้วบอกเจ้าของว่าติดอะไร

1. `git status` และ `git diff --stat` สรุปว่าแก้ไฟล์อะไรบ้าง
2. ตรวจว่าไม่มีไฟล์ `.env*`, ข้อมูลจริง หรือ key ใน diff
3. รัน `npm run typecheck`, `npm test`, `npm run build` ต้องผ่านทั้งหมด
4. ถ้า diff แตะเงินหรือบัญชี → เรียก money-auditor
   ถ้าแตะล็อกอิน, Supabase, RLS, นำเข้า/ส่งออก → เรียก security-auditor
   ถ้าแตะ UI → เรียก design-critic (แนะนำ ไม่บังคับ)
5. เสนอข้อความ commit ภาษาอังกฤษสั้นๆ แบบ `feat: ...` / `fix: ...`
6. แสดงสรุปและ **ถามเจ้าของว่า "push เลยไหม"** ห้าม push จนกว่าจะได้คำตอบว่าใช่
7. เมื่อได้รับอนุญาต: `git add -A`, `git commit`, `git push` แล้วบอกว่า Vercel จะ deploy อัตโนมัติ และ CI บน GitHub Actions จะรันให้
8. อัปเดตตารางสถานะใน `README.md` ถ้า Ticket เสร็จ (ทำก่อน commit)
