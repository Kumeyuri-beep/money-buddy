# รหัส error ของ domain/invest (งาน A)

ทำอะไร: ข้อความ error ในโค้ดลงทุนเป็นไทยฝังในประโยค หน้า /invest ต้องแสดงอังกฤษ จึงให้แต่ละข้อความมี "รหัส" (เช่น `trade.sellExceedsHeld`) พร้อมตัวเลข (params) และแม่แบบไทย/อังกฤษใน `src/domain/invest/errorCodes.ts`
ทำไม: หน้าอื่นยังต้องเห็นไทยเหมือนเดิมทุกตัวอักษร ส่วน /invest เอารหัสไปแปลงเป็นอังกฤษได้ โดยไม่แตะสูตรหรือลำดับการตรวจ
ทดสอบอย่างไร: เขียนเทสต์ golden (`tests/unit/errorCodes-invest-golden.test.ts`) เก็บข้อความไทยเดิมก่อนแก้โค้ด ผ่านบนโค้ดเดิมและโค้ดใหม่ + เทสต์รายรหัส (`errorCodes-invest.test.ts`) ตรวจไทย = golden, อังกฤษไม่มีตัวอักษรไทยและมีตัวเลขครบ
ฟังก์ชันที่เคยคืน string (`checkTradeAdd`, `dcaPlanProblem` ฯลฯ) ยังคืน string เหมือนเดิม และมีฟังก์ชันคู่ `...Coded` คืน `{message, code, params}`
