# เมนู Top dividend stocks เป็นลิงก์ออกเว็บภายนอก

## ทำอะไร
เมนู Tools → **Top dividend stocks** เปิดหน้า Snowball Analytics ในแท็บใหม่ (มีไอคอน ↗) แบบเดียวกับ Dividend payout calendar เอาหน้า "Coming soon" เดิมออก

## ทำไม
เจ้าของสั่ง 26 พ.ย. 2569 ไม่ทำหน้ารายชื่อหุ้นเอง เพราะการจัดอันดับหุ้นในแอปจะใกล้กับการแนะนำการลงทุน และต้องมีข้อมูลตลาดอัตโนมัติ ลิงก์ไม่ส่งข้อมูลของผู้ใช้ไปด้วย (`rel="noopener noreferrer"`)

## ทดสอบอย่างไร
- unit `investRoute.test.ts` และ e2e `invest-mode.spec.ts` (ตรวจ href, แท็บใหม่, noopener, ไอคอน ↗ ทั้งคอมและมือถือ)
- บนคอม: Invest → Tools → Top dividend stocks ต้องเปิดแท็บใหม่ ลิงก์ที่บันทึกไว้เดิม `/invest/tools/top-dividend-stocks` ไม่มีหน้าแล้ว
