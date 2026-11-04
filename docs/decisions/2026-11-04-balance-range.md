# balanceOf โยน RangeError เมื่อเกินช่วงปลอดภัย (4 พ.ย. 2569)

| # | เรื่อง | ตัดสินใจ | เหตุผล |
|---|---|---|---|
| 1 | `balanceOf` | โยน `RangeError` เมื่อจำนวนในบรรทัดไม่ใช่ safe integer หรือยอดสะสม (รวมค่าระหว่างทาง) เกิน ±MAX_SAFE_INTEGER | เจ้าของสั่ง 4 พ.ย. 2569 · ตรงกับฟังก์ชัน domain อื่น (R1) · ตรวจค่าระหว่างทางเพราะ number เพี้ยนทันทีที่เกิน แม้ผลสุดท้ายกลับเข้าช่วง |
| 2 | ผู้เรียก | `Wallets.tsx` จับ RangeError แสดงข้อความแทนการล้มทั้งหน้า (การ์ดสรุป/Safe-to-spend/Sankey จับอยู่แล้ว) | money-auditor พบว่าไม่มีทางรับมือ ทำให้จอขาว |
| 3 | `.solid` ตอนลดความโปร่งใส | ใน `prefers-reduced-transparency` เปลี่ยนจาก rgba(…,.9) เป็นสีทึบ `#0c0e15` | พื้นทึบเดิมโปร่ง 10% ไม่ใช่ทึบจริง · เพิ่มเทสต์อ่าน `styles.css` (ตั้ง `test.css.include` ใน `vite.config.ts` เพราะ Vitest คืนค่าว่างเมื่อ import css) |
| 4 | **ยังไม่ทำ (รอตัดสินใจ)** | ฟังก์ชันสะสมอื่นยังไม่ตรวจช่วงปลอดภัย: `periodTotals`, `sumNatural`/`netWorthAt`/`cashBalance` (ผลรวมข้ามกระเป๋า), `incomeChannels`, `runwayTenths` (reduce รายเดือน) | ทำเป็น Ticket แยก ต้องเพิ่ม try/catch ที่ `LedgerView.tsx` (เรียก `periodTotals`) พร้อมกัน ไม่งั้นหน้าล้ม |
