import { describe, expect, it } from 'vitest';
import { DOCK_MAX_SCALE, DOCK_PITCH, DOCK_RADIUS, magnifyScale, radiusFor, safeMaxScale } from '../../src/ui/dockMagnify';

/** เมนู dock: สูตรขยายตามระยะเมาส์ (ฟังก์ชันล้วน ไม่มีเงิน/DOM) */
describe('magnifyScale', () => {
  it('เมาส์อยู่กลางไอคอน = ขยายสุด · ที่รัศมีและไกลกว่า = 1', () => {
    expect(magnifyScale(0)).toBeCloseTo(DOCK_MAX_SCALE, 10);
    expect(magnifyScale(DOCK_RADIUS)).toBe(1);
    expect(magnifyScale(DOCK_RADIUS * 5)).toBe(1);
  });
  it('สมมาตรสองด้าน และลดลงเรื่อยๆ ตามระยะ (ข้างๆ ขยายรองลงมา)', () => {
    expect(magnifyScale(-40)).toBeCloseTo(magnifyScale(40), 10);
    let prev = magnifyScale(0);
    for (let d = 5; d <= DOCK_RADIUS; d += 5) {
      const s = magnifyScale(d);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(s).toBeGreaterThanOrEqual(1);
      prev = s;
    }
  });
  it('ไอคอนข้างๆ (ห่าง 64px = 48 + ช่องว่าง 16) ขยายราว 1.17 ตามแบบร่าง', () => {
    const s = magnifyScale(64);
    expect(s).toBeGreaterThan(1.1);
    expect(s).toBeLessThan(1.25);
  });
  it('ไอคอนไม่ทับกัน: ครึ่งความสูงที่ขยายของสองตัวติดกันรวมกันไม่เกินระยะห่างศูนย์กลาง (64px) ทุกตำแหน่งเมาส์', () => {
    const size = 48;
    const pitch = 64;
    for (let y = -pitch; y <= pitch * 2; y += 1) {
      // เมาส์อยู่ที่ y เทียบไอคอนตัวแรก (ศูนย์กลาง 0) ตัวสอง (ศูนย์กลาง pitch)
      const a = (size * magnifyScale(y - 0)) / 2;
      const b = (size * magnifyScale(y - pitch)) / 2;
      expect(a + b, `y=${y}`).toBeLessThanOrEqual(pitch + 0.5); // ยอมซ้อนไม่เกิน 0.5px (ขอบโค้งมน)
    }
  });
  it('ค่าแปลก (NaN/Infinity) = 1 ไม่พัง', () => {
    expect(magnifyScale(Number.NaN)).toBe(1);
    expect(magnifyScale(Infinity)).toBe(1);
    expect(magnifyScale(-Infinity)).toBe(1);
  });
});

describe('safeMaxScale (จอเตี้ย: ช่องว่างแคบลง ไอคอนติดกันต้องไม่ทับกัน)', () => {
  it('ขนาดปกติ (48 ห่าง 64) ได้ค่าเต็ม 1.42 ตามแบบร่าง และ radiusFor(64) = DOCK_RADIUS', () => {
    expect(safeMaxScale(48, DOCK_PITCH)).toBe(DOCK_MAX_SCALE);
    expect(radiusFor(DOCK_PITCH)).toBe(DOCK_RADIUS);
  });
  it('ทุกคู่ขนาด/ระยะห่างที่ใช้จริง (ปกติ จอเตี้ย ≤760 และ ≤620) ไอคอนติดกันไม่ทับกันที่ทุกตำแหน่งเมาส์', () => {
    for (const [size, pitch] of [[48, 64], [48, 56], [40, 44], [44, 50], [48, 52], [40, 40], [36, 48]] as const) {
      const max = safeMaxScale(size, pitch);
      expect(max, `${size}/${pitch}`).toBeGreaterThanOrEqual(1);
      expect(max).toBeLessThanOrEqual(DOCK_MAX_SCALE);
      const radius = radiusFor(pitch);
      for (let y = -pitch; y <= pitch * 2; y += 0.5) {
        const a = (size * magnifyScale(y, max, radius)) / 2;
        const b = (size * magnifyScale(y - pitch, max, radius)) / 2;
        expect(a + b, `${size}/${pitch} y=${y}`).toBeLessThanOrEqual(pitch + 0.3);
      }
    }
  });
  it('ช่องว่างแคบลง = ขยายน้อยลง (ไม่เพิ่มขึ้น) · ไม่มีช่องว่างเลย = ไม่ขยาย', () => {
    expect(safeMaxScale(48, 56)).toBeLessThanOrEqual(safeMaxScale(48, 64));
    expect(safeMaxScale(48, 52)).toBeLessThanOrEqual(safeMaxScale(48, 56));
    expect(safeMaxScale(48, 48)).toBeLessThan(1.05);
    expect(safeMaxScale(48, 48)).toBeGreaterThanOrEqual(1);
  });
  it('ค่าแปลก = 1 ไม่พัง', () => {
    expect(safeMaxScale(0, 64)).toBe(1);
    expect(safeMaxScale(48, 0)).toBe(1);
    expect(safeMaxScale(Number.NaN, 64)).toBe(1);
    expect(safeMaxScale(48, Infinity)).toBe(1);
  });
});
