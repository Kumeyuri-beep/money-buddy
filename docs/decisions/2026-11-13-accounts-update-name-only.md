# จำกัดสิทธิ์ UPDATE ของ accounts ให้แก้ได้เฉพาะ name (รออนุมัติเจ้าของ)

ที่มา: security-auditor (ผลตรวจฟีเจอร์เปลี่ยนชื่อกระเป๋า #124) ระดับกลาง: ผู้ใช้ที่ล็อกอินแล้วยิง PostgREST ตรงแก้ id/type/currency/kind/archived/sort_order ของแถวตัวเองได้ (ปัญหาเดิมก่อนฟีเจอร์) ไม่ข้ามผู้ใช้ (RLS + FK กัน) แต่ข้ามกติกา "เปลี่ยนได้เฉพาะชื่อ"

แก้: `revoke update on public.accounts from authenticated; grant update (name) on public.accounts to authenticated;`

เหตุผลที่เป็น PR draft: migration มี `revoke` (ลดสิทธิ์) ตามกติกาโหมดอัตโนมัติระดับ 2 ผมไม่ใส่เอง · ตรวจแล้ว: โค้ดที่ UPDATE accounts มีจุดเดียวคือ `renameWallet` (เขียนเฉพาะ name) และไม่มีฟังก์ชัน SQL ไหน update accounts

ถ้าอนุมัติ: ผมจะ dry-run แบบ rollback + เพิ่มเทสต์ SQL (update คอลัมน์อื่น = permission denied, update name ผ่าน) แล้วรันเทสต์ SQL ทุกไฟล์ + live-contract ก่อนใส่
ย้อนกลับ: `grant update on public.accounts to authenticated;`

## สถานะ: เจ้าของอนุมัติ 13 พ.ย. 2569 · ใส่ฐานข้อมูลจริงแล้ว

- ค้นโค้ดเว็บแล้ว: UPDATE accounts มีจุดเดียวคือ `renameWallet` (เขียนเฉพาะ name) ไม่มีจุดแก้คอลัมน์อื่นตรงๆ
- ใส่ผ่านชื่อ migration `accounts_update_name_only` (ไม่มี begin/commit ในไฟล์) หลัง dry-run แบบ rollback ผ่าน ตรวจแคตตาล็อก: ระดับตาราง update = false, name = true, คอลัมน์อื่น 0, insert/delete ยังมี
- เทสต์ใหม่: `supabase/tests/accounts_name_only_test.sql` (name แก้ได้, คอลัมน์อื่น/ปน name = 42501, upsert do update = 42501, do nothing/RPC เดิมยังทำงาน, trigger accounts_guard ยังทำงานกับผู้ดูแล, B แก้ของ A ไม่ได้, anon ไม่ได้) และเทสต์ live ใน `tests/live/supabaseRepository.live.ts`
- แก้เทสต์เดิม `invest_schema_test.sql`: ข้อที่ทดสอบ trigger guard ด้วยการ update ตรงๆ เปลี่ยนไปรันด้วยสิทธิ์ผู้ดูแล (`pg_temp.admin_fails`) เพราะผู้ใช้ไม่มีสิทธิ์แก้คอลัมน์นั้นแล้ว (ไม่ลดความครอบคลุมของ trigger)
- เทสต์ SQL ทั้ง 17 ไฟล์ขึ้น TESTS_PASSED หลังใส่

## วิธีย้อนกลับ
```sql
grant update on public.accounts to authenticated;
```
(คืนสิทธิ์แก้ทุกคอลัมน์ ไม่กระทบข้อมูล)
