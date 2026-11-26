---
name: mb-ship
description: เจ้าของพิมพ์ /mb-ship เมื่อต้องการส่งงานขึ้น GitHub และ Vercel ตรวจครบแล้วรอยืนยันก่อน push
disable-model-invocation: true
---

# mb-ship: ตรวจแล้วส่งงาน

ทำตามลำดับ หยุดทันทีถ้าขั้นไหนไม่ผ่าน แล้วบอกเจ้าของว่าติดอะไร

1. `git status` และ `git diff --stat` สรุปว่าแก้ไฟล์อะไรบ้าง
2. ตรวจว่าไม่มีไฟล์ `.env*`, ข้อมูลจริง หรือ key ใน diff
3. รัน `npm run typecheck`, `npm test`, `npm run build` ต้องผ่านทั้งหมด
4. ถ้า diff แตะเงินหรือบัญชี → เรียก money-auditor
   ถ้าแตะล็อกอิน, Supabase, RLS, นำเข้า/ส่งออก → เรียก security-auditor
   ถ้าแตะ UI → เรียก design-critic (แนะนำ ไม่บังคับ)
5. เสนอข้อความ commit ที่ **ระบุเลขกฎที่แตะ** นำหน้า ตามกติกาใน `CLAUDE.md` และ `docs/money-rules.md` หมวด E เช่น `[R1,R8,R16] เพิ่มฟังก์ชัน ...` (งานที่ไม่แตะกฎเงินใช้ป้ายขอบเขต เช่น `[docs]` `[test]`)
6. แสดงสรุปและ **ถามเจ้าของว่า "push เลยไหม"** ห้าม push จนกว่าจะได้คำตอบว่าใช่
7. เมื่อได้รับอนุญาต: `git add <พาธ>` **ระบุพาธทีละไฟล์** ตามรายการจากขั้นที่ 1 (ห้าม `git add -A` และ `git add .`) ตรวจ `git status` ว่าไม่มีไฟล์เกิน แล้ว `git commit` และ `git push -u origin <ชื่อ branch เต็ม>` (ห้าม `git push` เปล่า) แล้วบอกว่า Vercel จะ deploy อัตโนมัติ และ CI บน GitHub Actions จะรันให้
8. อัปเดตตารางสถานะใน `README.md` ถ้า Ticket เสร็จ (ทำก่อน commit)
