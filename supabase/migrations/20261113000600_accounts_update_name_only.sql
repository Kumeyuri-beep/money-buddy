-- ผู้ใช้ที่ล็อกอินแก้ได้เฉพาะคอลัมน์ name ของ public.accounts (ผลตรวจ security-auditor ตอนทำฟีเจอร์เปลี่ยนชื่อกระเป๋า · เจ้าของอนุมัติ 13 พ.ย. 2569)
-- เดิม: grant update ทั้งตาราง → ยิง PostgREST ตรงด้วย token ของตัวเองแก้ id/type/currency/kind/archived/sort_order ของ "แถวตัวเอง" ได้ (ไม่ข้ามผู้ใช้ เพราะ RLS + FK แต่ข้ามกติกาฝั่งเว็บ)
-- ตรวจแล้ว: โค้ดเว็บที่ UPDATE accounts มีจุดเดียวคือ renameWallet (เขียนเฉพาะ name) · ฟังก์ชัน SQL ที่เขียน accounts ใช้ insert ... on conflict do nothing / delete เท่านั้น ไม่ต้องการสิทธิ์ update คอลัมน์อื่น
-- ผล: คอลัมน์อื่นถูกปฏิเสธด้วย 42501 (permission denied) · trigger accounts_guard ยังทำงานกับ role ที่มีสิทธิ์ (ผู้ดูแล) เป็นด่านชั้นสอง
-- ย้อนกลับ: grant update on public.accounts to authenticated;
revoke update on public.accounts from authenticated;
grant update (name) on public.accounts to authenticated;
