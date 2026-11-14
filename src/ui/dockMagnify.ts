/**
 * เมนู dock: สูตรขยายไอคอนตามระยะเมาส์ (ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/เงิน)
 * ขยายด้วย transform: scale เท่านั้น (ไม่เปลี่ยนขนาดกล่อง จึงไม่ดันเนื้อหาข้างๆ) · เขียนเอง ไม่ใช้ไลบรารีแอนิเมชัน
 */

/** ขยายสูงสุด (ไอคอนใต้เมาส์พอดี) */
export const DOCK_MAX_SCALE = 1.6;
/** ระยะ (px) จากศูนย์กลางไอคอนที่เลิกขยาย (ประมาณ 2 ไอคอนข้างๆ ได้รับผลรองลงมา) */
export const DOCK_RADIUS = 120;

/** สัดส่วนขยายของไอคอนที่ห่างจากเมาส์ dx (px แนวนอน): ใกล้สุด = DOCK_MAX_SCALE · ไกลเกินรัศมี/ค่าแปลก = 1 · ลดแบบโคไซน์ (นุ่ม ไม่มีมุมหัก) */
export function magnifyScale(dx: number): number {
  if (!Number.isFinite(dx)) return 1;
  const d = Math.abs(dx);
  if (d >= DOCK_RADIUS) return 1;
  return 1 + (DOCK_MAX_SCALE - 1) * 0.5 * (1 + Math.cos((Math.PI * d) / DOCK_RADIUS));
}

/**
 * ระยะเลื่อนแนวนอน (px) ของแต่ละไอคอน เพื่อไม่ให้ไอคอนที่ขยายทับกัน โดยศูนย์กลางของ dock คงที่
 * (ตัวที่ i เลื่อนด้วยส่วนขยายของตัวก่อนหน้าทั้งหมด + ครึ่งหนึ่งของส่วนขยายตัวเอง − ครึ่งหนึ่งของส่วนขยายรวม)
 * ไม่ขยายเลย = 0 ทุกตัว
 */
export function layoutOffsets(scales: readonly number[], base: number): number[] {
  const extra = scales.map((s) => base * (s - 1));
  const total = extra.reduce((a, b) => a + b, 0);
  let before = 0;
  return extra.map((e) => {
    const v = before + e / 2 - total / 2;
    before += e;
    return Math.abs(v) < 1e-9 ? 0 : v;
  });
}
