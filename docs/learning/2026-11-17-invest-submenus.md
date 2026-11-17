# เมนูย่อยแถบบนของโหมด /invest (17 พ.ย. 2569)

**ทำอะไร:** แถบบนของโหมดพอร์ตมีเมนูเลื่อนลง 4 กลุ่ม (ภาษาอังกฤษ) ทุกหน้าย่อยมี URL ของตัวเอง เช่น `/invest/analytics/common` ปุ่ม back/forward ใช้ได้

| เมนู | หน้าย่อย |
|---|---|
| Dashboard | หน้าเดิม |
| Analytics | Common · Diversification · Dividends · Growth │ Metrics · Report |
| Portfolio | Holdings · Transactions · Dividend calendar · My goal │ Cash · Categories · Corporate actions |
| Tools | Portfolio rebalancing · Top dividend stocks · Dividend payout calendar · Portfolio Lab · Find the Dip |

**ของเดิมย้ายมาไว้ที่ไหน**
- แท็บวิเคราะห์เดิม → Analytics / Common (รวมการ์ด "Where the profit comes from")
- ตารางผลตอบแทนรายเดือน → Analytics / Growth
- หุ้นสหรัฐเดิม (ฟอร์มซื้อขาย ปันผล แลกเงิน ราคา) → Portfolio / Holdings
- ภาพรวมกองทุน/หุ้นบาท + โอนเข้า-ออกพอร์ต → Portfolio / Transactions (ยังไม่แยกตารางซื้อขายออกจากฟอร์มของหุ้นสหรัฐ เพราะอยู่ในไฟล์เดียวกันและเสี่ยงพัง)
- My goal → ปุ่มไปหน้าแผนเกษียณ
- หน้าที่ยังไม่ทำ → หน้า "Coming soon" บอกว่าหน้านี้จะมีอะไร และรออะไร (ข้อมูลตลาดอัตโนมัติ หรือทำจากรายการที่บันทึกเองได้)

**ทำไมไม่ใช้ router:** แอปใช้ `pushState` เองอยู่แล้ว (`useViewHistory`) จึงต่อยอดแบบเดียวกัน ไม่เพิ่มไลบรารี

**การใช้งาน:** ชี้เมาส์ หรือกด Tab ไปที่ปุ่ม เมนูจะเลื่อนลง · กดบนมือถือได้ · ลูกศร ขึ้น/ลง/ซ้าย/ขวา Home End เลื่อนรายการ · Esc ปิดแล้วโฟกัสกลับที่ปุ่ม

**ทดสอบ:** เทสต์หน่วยของโครงเมนู/เส้นทาง (`investRoute.test.ts`) · Playwright 360/390/1280/1440: โครงเมนูครบ เส้นคั่นกลุ่ม URL ทุกหน้า back/forward เปิดตรงที่ URL คีย์บอร์ด หน้า Coming soon ไม่ล้นจอ
