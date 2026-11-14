import { describe, expect, it } from 'vitest';
import { DOCK_MAX_SCALE, DOCK_RADIUS, magnifyScale } from '../../src/ui/dockMagnify';

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
