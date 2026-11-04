# แผนสั้น: ยกเลิกการจ่ายบิล (ก่อน B4)

เป้า: จ่ายผิดแล้วย้อนได้จากหน้าจอ โดยรายการในสมุดบัญชีและ `lastPaidMonth` เปลี่ยนพร้อมกัน (atomic)

1. เทสต์ก่อน: `tests/unit/billCancel.test.ts` (ผูกลิงก์, ยกเลิก, เฉพาะรอบล่าสุด, บิลถูกลบ, atomic, ล็อกรายการเก่า) + `ledgerQuery`
2. `Entry.bill` + `createEntry` ตรวจลิงก์ · `payBill` เขียนลิงก์
3. repository: `cancelBillPayment`, `cancelLatestBillPayment`, `deleteEntry` ยกเลิกแทนลบเมื่อมีลิงก์
4. UI: ปุ่ม "ยกเลิกการจ่าย" ในหน้าบิล (รอบล่าสุด) และสมุดบัญชี (รายการจ่ายบิล) พร้อม confirm
5. commit แยก: R15 ใน money-rules (เจ้าของอนุมัติ) / โค้ด
6. ตรวจ: money-auditor
