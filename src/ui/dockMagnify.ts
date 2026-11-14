/**
 * เมนู dock: สูตรขยายไอคอนตามระยะเมาส์ (ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย/เงิน)
 * ขยายด้วย transform: scale เท่านั้น (ไม่เปลี่ยนขนาดกล่อง จึงไม่ดันเนื้อหาข้างๆ) · เขียนเอง ไม่ใช้ไลบรารีแอนิเมชัน
 * จอเตี้ย: ช่องว่างระหว่างไอคอนแคบลง → จำกัดระยะขยายให้ไอคอนติดกันไม่ทับกันตามขนาด/ระยะห่างจริง (safeMaxScale)
 */

/** ขยายสูงสุดที่ต้องการ (ไอคอนใกล้เมาส์ที่สุด · ตามแบบร่าง 1.42) */
export const DOCK_MAX_SCALE = 1.42;
/** ระยะ (px) จากศูนย์กลางไอคอนที่เลิกขยาย เมื่อไอคอนห่างกัน 64px (ราว 1.72 เท่าของระยะห่าง) */
export const DOCK_RADIUS = 110;
/** ระยะห่างศูนย์กลางไอคอนตอนปกติ (48 + ช่องว่าง 16) ที่ DOCK_RADIUS ใช้เทียบ */
export const DOCK_PITCH = 64;

/** สัดส่วนขยายของไอคอนที่ห่างจากเมาส์ d (px ตามแนวที่เรียง): ใกล้สุด = max · ไกลเกินรัศมี/ค่าแปลก = 1 · ลดแบบโคไซน์ (นุ่ม ไม่มีมุมหัก) */
export function magnifyScale(d: number, max: number = DOCK_MAX_SCALE, radius: number = DOCK_RADIUS): number {
  if (!Number.isFinite(d)) return 1;
  const a = Math.abs(d);
  if (a >= radius) return 1;
  return 1 + (max - 1) * 0.5 * (1 + Math.cos((Math.PI * a) / radius));
}

/** รัศมีที่สัมพันธ์กับระยะห่างศูนย์กลางไอคอน (คงสัดส่วนเดียวกับตอนปกติ) */
export function radiusFor(pitch: number): number {
  return (DOCK_RADIUS * pitch) / DOCK_PITCH;
}

/** ไอคอนติดกัน (ขนาด size ห่างศูนย์กลาง pitch) ทับกันไหมที่ทุกตำแหน่งเมาส์ ถ้าขยายสูงสุด max */
function overlaps(size: number, pitch: number, max: number): boolean {
  const radius = radiusFor(pitch);
  for (let y = -pitch; y <= pitch * 2; y += pitch / 32) {
    const a = (size * magnifyScale(y, max, radius)) / 2;
    const b = (size * magnifyScale(y - pitch, max, radius)) / 2;
    if (a + b > pitch + 0.25) return true; // ยอมซ้อนไม่เกิน 0.25px (ขอบโค้งมน)
  }
  return false;
}

const cache = new Map<string, number>();

/** ขยายสูงสุดที่ใช้ได้โดยไอคอนติดกันไม่ทับกัน: ไม่เกิน wanted (ปกติ = wanted ตามแบบร่าง · จอเตี้ยที่ช่องว่างแคบจะน้อยลง) */
export function safeMaxScale(size: number, pitch: number, wanted: number = DOCK_MAX_SCALE): number {
  if (!(size > 0) || !(pitch > 0) || !Number.isFinite(size + pitch)) return 1;
  const key = `${size}|${pitch}|${wanted}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let result: number;
  if (!overlaps(size, pitch, wanted)) result = wanted;
  else {
    let lo = 1; // ไม่ขยายเลยไม่ทับกัน (ถ้า pitch ≥ size)
    let hi = wanted;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (overlaps(size, pitch, mid)) hi = mid;
      else lo = mid;
    }
    result = lo;
  }
  cache.set(key, result);
  return result;
}
