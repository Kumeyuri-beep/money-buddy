const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'] as const;
const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;

/** คำทักทายตามเวลาเครื่องผู้ใช้: เช้า 05-11, บ่าย 12-16, เย็น 17-20, ค่ำ 21-04 */
export function greetingFor(date: Date = new Date()): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'สวัสดีตอนเช้า';
  if (h >= 12 && h < 17) return 'สวัสดีตอนบ่าย';
  if (h >= 17 && h < 21) return 'สวัสดีตอนเย็น';
  return 'สวัสดีตอนค่ำ';
}

/** "จันทร์ 2 พ.ย. 2569" สร้างเองจากตารางชื่อ ไม่พึ่ง Intl เพื่อให้ผลเหมือนกันทุกเบราว์เซอร์ */
export function thaiHeaderDate(date: Date = new Date()): string {
  const weekday = WEEKDAYS[date.getDay()];
  const month = MONTHS_SHORT[date.getMonth()];
  return `${weekday} ${date.getDate()} ${month} ${date.getFullYear() + 543}`;
}
