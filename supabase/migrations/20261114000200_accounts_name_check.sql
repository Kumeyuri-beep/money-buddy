-- ห้ามอักขระควบคุม/มองไม่เห็นในชื่อบัญชี (ผลตรวจ security-auditor ตอนทำฟีเจอร์เพิ่ม/ซ่อนหมวด · เจ้าของอนุมัติ 14 พ.ย. 2569)
-- เดิมเว็บตรวจ แต่ยิง REST ตรงด้วย token ตัวเองได้ชื่อที่มีอักขระควบคุม/ศูนย์ความกว้าง/ตัวกลับทิศข้อความ/BOM (ชื่อดูซ้ำกันหรือแสดงสลับทิศ) → ปิดที่ฐานข้อมูลด้วย check constraint
-- ชุดอักขระตรงกับ INVISIBLE ใน src/domain/ledger/accountName.ts: C0 (0x01-0x1F รวมแท็บ/ขึ้นบรรทัดใหม่) · DEL+C1 (0x7F-0x9F) · U+200B-200F (ศูนย์ความกว้าง/ตัวกำกับทิศ) · U+202A-202E · U+2060-2069 · U+FEFF
-- ตรวจข้อมูลเดิมก่อนแล้ว: นับแถวขัด = 0 (นับอย่างเดียว ไม่แสดงเนื้อหา) · ใช้ NOT VALID แล้ว VALIDATE (VALIDATE ไม่ล็อกเขียนนาน และล้มทันทีถ้ามีแถวขัด)
-- migration แบบ "เพิ่ม" (add constraint) · ไม่แตะสิทธิ์ GRANT/REVOKE นโยบาย RLS หรือ trigger
-- ย้อนกลับ: alter table public.accounts drop constraint accounts_name_no_invisible;
alter table public.accounts
  add constraint accounts_name_no_invisible
  check (name !~ E'[\x01-\x1F\x7F-\x9F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]') not valid;
alter table public.accounts validate constraint accounts_name_no_invisible;
