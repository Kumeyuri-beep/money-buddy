-- settings: เปลี่ยนเพดานขนาดจากวัดแบบ pg_column_size (ขึ้นกับการบีบอัด/รูปแบบเก็บภายใน) เป็นวัดขนาดข้อความ JSON จริง octet_length(value::text)
-- เหตุผล: เพดาน 16 KB ต้องหมายถึงขนาดข้อมูลจริงที่ผู้ใช้ใส่ ไม่ใช่ขนาดหลังบีบอัด (security-auditor 12 พ.ย. 2569) · เจ้าของอนุมัติเป็นกรณีเฉพาะเมื่อ 13 พ.ย. 2569
-- ความปลอดภัยของการเปลี่ยน (ธุรกรรมเดียว):
--   1) เพิ่ม constraint ใหม่ก่อน (ตรวจแถวเดิมทุกแถวทันที ถ้ามีแถวเกินขีดใหม่ คำสั่งนี้ล้มและทั้งธุรกรรมย้อนกลับ ไม่ถอดตัวเก่า)
--   2) แล้วค่อยถอดตัวเก่า (settings_value_check) ระหว่างธุรกรรมไม่มีช่วงที่ไม่มี constraint
--   ผู้ใช้ปัจจุบันไม่ได้รับผลกระทบ: ค่าที่แอปเขียนจำกัด 12,000 ไบต์ฝั่งเว็บ (MAX_SETTINGS_BYTES) ต่ำกว่าขีดใหม่ และตรวจแล้วก่อนใส่ว่าไม่มีแถวใดเกินขีดใหม่
-- ขีดใหม่ < 16384 ไบต์ของข้อความ jsonb (jsonb::text มีเว้นวรรคหลัง : และ , จึงใหญ่กว่า JSON แบบกะทัดรัดเล็กน้อย)
alter table public.settings
  add constraint settings_value_size_check
  check (jsonb_typeof(value) = 'object' and octet_length(value::text) < 16384);

alter table public.settings drop constraint settings_value_check;
