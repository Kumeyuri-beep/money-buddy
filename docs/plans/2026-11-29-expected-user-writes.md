# ตรวจบัญชีที่ตั้งใจกับทุกการเขียน (บันทึกรายการ บิล การลงทุน ค่าตั้งค่า)

เจ้าของอนุมัติ 28 พ.ย. 2569: เตรียม migration + แก้เว็บ · **migration รออนุมัติเป็นชุด** (PR เป็น draft)

## ปัญหา
เบราว์เซอร์ใช้เซสชันร่วมกันทุกแท็บ แท็บค้างของบัญชี A อาจเขียนเข้าบัญชี B หลังอีกแท็บสลับบัญชี

## วิธี
1. เว็บแนบหัวคำขอ `x-expected-user: <รหัสผู้ใช้ของ repository>` กับคำขอของ repository
2. ฐานข้อมูลมี trigger ระดับคำสั่ง (before insert/update/delete) ทุกตารางข้อมูลผู้ใช้ 11 ตาราง: มีหัวคำขอและไม่ตรง `auth.uid()` = PT412
3. ไม่มีหัวคำขอ = ผ่าน (แท็บรุ่นเก่า เทสต์ SQL งานผู้ดูแล) · เป็นการเพิ่มอย่างเดียว

## งาน
- [x] เทสต์เว็บด้วย supabase-js จริง + fetch จำลอง: ทุกทางเขียนส่งหัวคำขอ · PT412 = AccountChangedError
- [x] เว็บ: `src/storage/expectedUser.ts` + `supabaseRepository.ts` + ข้อความ `store.accountChanged`
- [x] migration `20261129000100_expected_user_header_guard.sql` + `supabase/tests/expected_user_header_test.sql`
- [x] live test: PT412 ผ่าน PostgREST จริง + CORS preflight รับหัวคำขอ
- [x] dry-run แบบย้อนกลับ + SQL ครบทุกไฟล์ · money-auditor · security-auditor
- [ ] เปิด PR draft แล้วรอเจ้าของ

## ลำดับหลังอนุมัติ
ใส่ migration → SQL ครบทุกไฟล์ → live-contract บน branch → merge → live-contract บน `main`
