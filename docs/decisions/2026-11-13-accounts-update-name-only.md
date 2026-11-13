# จำกัดสิทธิ์ UPDATE ของ accounts ให้แก้ได้เฉพาะ name (รออนุมัติเจ้าของ)

ที่มา: security-auditor (ผลตรวจฟีเจอร์เปลี่ยนชื่อกระเป๋า #124) ระดับกลาง: ผู้ใช้ที่ล็อกอินแล้วยิง PostgREST ตรงแก้ id/type/currency/kind/archived/sort_order ของแถวตัวเองได้ (ปัญหาเดิมก่อนฟีเจอร์) ไม่ข้ามผู้ใช้ (RLS + FK กัน) แต่ข้ามกติกา "เปลี่ยนได้เฉพาะชื่อ"

แก้: `revoke update on public.accounts from authenticated; grant update (name) on public.accounts to authenticated;`

เหตุผลที่เป็น PR draft: migration มี `revoke` (ลดสิทธิ์) ตามกติกาโหมดอัตโนมัติระดับ 2 ผมไม่ใส่เอง · ตรวจแล้ว: โค้ดที่ UPDATE accounts มีจุดเดียวคือ `renameWallet` (เขียนเฉพาะ name) และไม่มีฟังก์ชัน SQL ไหน update accounts

ถ้าอนุมัติ: ผมจะ dry-run แบบ rollback + เพิ่มเทสต์ SQL (update คอลัมน์อื่น = permission denied, update name ผ่าน) แล้วรันเทสต์ SQL ทุกไฟล์ + live-contract ก่อนใส่
ย้อนกลับ: `grant update on public.accounts to authenticated;`
