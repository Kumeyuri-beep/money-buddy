import { CardUnavailable } from './CardUnavailable';

/** แท็บ "ปฏิทินปันผล": ต้องมีข้อมูลวันจ่ายปันผลล่วงหน้า ซึ่งมาจากราคา/ข้อมูลอัตโนมัติ (เฟส B) จึงเป็นการ์ดรอ ไม่ใส่ตัวเลขปลอม */
export function DividendCalendarTab() {
  return (
    <div className="invest-tab invest-calendar">
      <CardUnavailable id="inv-cal" title="ปฏิทินปันผล">
        ปันผลที่บันทึกแล้วดูได้ที่แท็บ "รายการ" ส่วน "ปันผลล่าสุด"
      </CardUnavailable>
    </div>
  );
}
