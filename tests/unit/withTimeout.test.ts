import { afterEach, describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../../src/ocr/withTimeout';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('งานเสร็จก่อนหมดเวลา -> คืนค่าตามปกติ', async () => {
    await expect(withTimeout(Promise.resolve(42), 50, () => new Error('หมดเวลา'))).resolves.toBe(42);
  });

  it('งานล้มก่อนหมดเวลา -> ส่งข้อผิดพลาดเดิมต่อ', async () => {
    await expect(withTimeout(Promise.reject(new Error('พังเอง')), 50, () => new Error('หมดเวลา'))).rejects.toThrow('พังเอง');
  });

  it('งานช้าเกินกำหนด -> โยนข้อผิดพลาดที่ผู้เรียกกำหนด', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => undefined);
    const result = withTimeout(never, 1000, () => new Error('หมดเวลา'));
    const assertion = expect(result).rejects.toThrow('หมดเวลา');
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('ก่อนถึงเวลายังไม่หมดเวลา และเลยเวลาแล้วงานที่เสร็จทีหลังไม่เปลี่ยนผล', async () => {
    vi.useFakeTimers();
    let finish: (v: string) => void = () => undefined;
    const slow = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const result = withTimeout(slow, 1000, () => new Error('หมดเวลา'));
    let settled = false;
    result.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    const assertion = expect(result).rejects.toThrow('หมดเวลา');
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    finish('late'); // เสร็จหลังหมดเวลาแล้ว ต้องไม่ทำให้เกิดข้อผิดพลาดใดๆ
    await vi.advanceTimersByTimeAsync(10);
  });

  it('งานที่ล้มหลังหมดเวลาแล้วไม่หลุดเป็น unhandled rejection (มีตัวรับไว้แล้ว)', async () => {
    vi.useFakeTimers();
    let fail: (e: Error) => void = () => undefined;
    const late = new Promise<never>((_, reject) => {
      fail = reject;
    });
    const result = withTimeout(late, 100, () => new Error('หมดเวลา'));
    const assertion = expect(result).rejects.toThrow('หมดเวลา');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    fail(new Error('ล้มทีหลัง'));
    await vi.advanceTimersByTimeAsync(10); // ถ้ามี unhandled rejection Vitest จะรายงานเป็นข้อผิดพลาด
  });

  it('ตัวจับเวลาถูกล้างเมื่องานเสร็จหรือล้ม (ไม่ค้าง)', async () => {
    vi.useFakeTimers();
    await withTimeout(Promise.resolve(1), 10_000, () => new Error('หมดเวลา'));
    expect(vi.getTimerCount()).toBe(0);
    await withTimeout(Promise.reject(new Error('x')), 10_000, () => new Error('หมดเวลา')).catch(() => undefined);
    expect(vi.getTimerCount()).toBe(0);
  });
});
