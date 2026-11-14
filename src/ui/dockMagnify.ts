/**
 * เมนู dock: สูตรขยายไอคอนตามระยะเมาส์ (ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/เงิน)
 * ขยายด้วย transform: scale เท่านั้น (ไม่เปลี่ยนขนาดกล่อง จึงไม่ดันเนื้อหาข้างๆ) · เขียนเอง ไม่ใช้ไลบรารีแอนิเมชัน
 */

/** ขยายสูงสุด (ไอคอนใกล้เมาส์ที่สุด · ตามแบบร่าง 1.42) */
export const DOCK_MAX_SCALE = 1.42;
/** ระยะ (px) จากศูนย์กลางไอคอนที่เลิกขยาย (ไอคอนข้างๆ ที่ห่าง 64px ได้ราว 1.16 ตามแบบร่าง) */
export const DOCK_RADIUS = 110;

/** สัดส่วนขยายของไอคอนที่ห่างจากเมาส์ d (px ตามแนวที่เรียง): ใกล้สุด = DOCK_MAX_SCALE · ไกลเกินรัศมี/ค่าแปลก = 1 · ลดแบบโคไซน์ (นุ่ม ไม่มีมุมหัก) */
export function magnifyScale(d: number): number {
  if (!Number.isFinite(d)) return 1;
  const a = Math.abs(d);
  if (a >= DOCK_RADIUS) return 1;
  return 1 + (DOCK_MAX_SCALE - 1) * 0.5 * (1 + Math.cos((Math.PI * a) / DOCK_RADIUS));
}
