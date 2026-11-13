-- ผู้ใช้ที่ล็อกอินแก้ได้เฉพาะคอลัมน์ name ของ public.accounts (ผลตรวจ security-auditor ตอนทำฟีเจอร์เปลี่ยนชื่อกระเป๋า 13 พ.ย. 2569)
-- เดิม: grant update ทั้งตาราง → ยิง PostgREST ตรงด้วย token ของตัวเองแก้ id/type/currency/kind/archived/sort_order ของ "แถวตัวเอง" ได้ (ไม่ข้ามผู้ใช้ เพราะ RLS + FK แต่ข้ามกติกาฝั่งเว็บ)
-- โค้ดที่ UPDATE accounts มีจุดเดียวคือ renameWallet (เขียนเฉพาะ name) ตรวจแล้วไม่มีฟังก์ชัน SQL ไหน update accounts
-- ⚠ มี REVOKE: ตามกติกาโหมดอัตโนมัติระดับ 2 ห้ามใส่เองต้องรอเจ้าของอนุมัติ (PR draft)
-- ย้อนกลับ: grant update on public.accounts to authenticated;
begin;
revoke update on public.accounts from authenticated;
grant update (name) on public.accounts to authenticated;
commit;
