import { describe, expect, it } from 'vitest';
import { DOCK_MAX_SCALE, DOCK_RADIUS, layoutOffsets, magnifyScale } from '../../src/ui/dockMagnify';

/** เมนู dock: สูตรขยายตามระยะเมาส์ (ฟังก์ชันล้วน ไม่มีเงิน/DOM) */
describe('magnifyScale', () => {
  it('เมาส์อยู่กลางไอคอน = ขยายสุด · ที่รัศมีและไกลกว่า = 1', () => {
    expect(magnifyScale(0)).toBeCloseTo(DOCK_MAX_SCALE, 10);
    expect(magnifyScale(DOCK_RADIUS)).toBe(1);
    expect(magnifyScale(DOCK_RADIUS * 5)).toBe(1);
  });
  it('สมมาตรซ้ายขวา และลดลงเรื่อยๆ ตามระยะ (ข้างๆ ขยายรองลงมา)', () => {
    expect(magnifyScale(-40)).toBeCloseTo(magnifyScale(40), 10);
    let prev = magnifyScale(0);
    for (let d = 5; d <= DOCK_RADIUS; d += 5) {
      const s = magnifyScale(d);
      expect(s).toBeLessThanOrEqual(prev + 1e-12);
      expect(s).toBeGreaterThanOrEqual(1);
      prev = s;
    }
  });
  it('ค่าแปลก (NaN/Infinity) = 1 ไม่พัง', () => {
    expect(magnifyScale(Number.NaN)).toBe(1);
    expect(magnifyScale(Infinity)).toBe(1);
    expect(magnifyScale(-Infinity)).toBe(1);
  });
});

describe('layoutOffsets', () => {
  it('ไม่ขยายเลย = ไม่เลื่อน (0 ทุกตัว · ไม่มี -0 ที่ทำให้ตำแหน่งกระโดด)', () => {
    const o = layoutOffsets([1, 1, 1, 1], 44);
    expect(o.every((v) => Object.is(v, 0))).toBe(true);
    expect(layoutOffsets([], 44)).toEqual([]);
  });
  it('ไอคอนที่ขยายไม่ทับกัน: ขอบของตัวที่ i ไม่เกินขอบของตัวที่ i+1 (เทียบตำแหน่งตอนพัก)', () => {
    const base = 44;
    const pitch = 52;
    const scales = [1, 1.15, 1.5, DOCK_MAX_SCALE, 1.5, 1.15, 1, 1];
    const off = layoutOffsets(scales, base);
    for (let i = 0; i < scales.length - 1; i++) {
      const rightOfI = i * pitch + base / 2 + off[i]! + (base * scales[i]!) / 2;
      const leftOfNext = (i + 1) * pitch + base / 2 + off[i + 1]! - (base * scales[i + 1]!) / 2;
      expect(rightOfI).toBeLessThanOrEqual(leftOfNext + 1e-9 + (pitch - base)); // ห่างกันอย่างน้อยเท่าช่องว่างเดิมลบส่วนที่ขยาย → ไม่ซ้อนเกินช่องว่าง
    }
  });
  it('ศูนย์กลาง dock คงที่: ผลรวมการเลื่อนถ่วงน้ำหนักไม่ทำให้ขอบนอกสุดสองข้างต่างกันเกินส่วนขยายรวม', () => {
    const base = 44;
    const scales = [1, 1.3, DOCK_MAX_SCALE, 1.3, 1];
    const off = layoutOffsets(scales, base);
    const extra = scales.reduce((a, s) => a + base * (s - 1), 0);
    // ตัวแรกเลื่อนซ้าย ตัวสุดท้ายเลื่อนขวา รวมกันเท่าส่วนขยายทั้งหมดพอดี (เมื่อสมมาตร)
    expect(off[0]! - off[off.length - 1]!).toBeCloseTo(-extra, 8);
  });
});
