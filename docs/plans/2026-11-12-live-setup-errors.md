# แผน: พิมพ์ error ของ globalSetup ให้ครบ
- ต่อจาก #79: throw อื่นใน setup/teardown (ไม่พบไฟล์ตั้งค่า, URL ไม่ตรง, สร้าง/ลบผู้ใช้ทดสอบไม่สำเร็จ) ก็หายบน Node v26
- ทำ: ห่อ setup และ teardown ใน `tests/live/globalSetup.ts` พิมพ์เฉพาะ `message` ผ่าน `console.error` แล้ว `exit(1)` (ไม่พิมพ์ stack) · ข้อความทุกอันเป็นข้อความตายตัวหรือผ่าน safeMessage อยู่แล้ว
- การทดสอบไม่แตะไฟล์ตั้งค่าลับและไม่ย้ายไฟล์ใดๆ
