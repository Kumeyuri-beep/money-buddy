/**
 * บวก/ลบจำนวนเต็มสตางค์แบบตรวจช่วงปลอดภัย (R1)
 * เกิน ±Number.MAX_SAFE_INTEGER แล้ว number จะเพี้ยนเงียบๆ จึงโยน RangeError แทน
 * อินพุตที่ไม่ใช่จำนวนเต็มปลอดภัย (NaN, ทศนิยม, Infinity) ก็โยน RangeError
 */
function assertSafe(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what}ไม่ใช่จำนวนเต็มสตางค์ที่อยู่ในช่วงปลอดภัย: ${String(value)}`);
  }
}

export function safeAdd(a: number, b: number): number {
  assertSafe(a, 'ตัวตั้ง');
  assertSafe(b, 'ตัวบวก');
  const sum = a + b;
  assertSafe(sum, 'ผลรวม');
  return sum || 0; // กัน -0
}

export function safeSub(a: number, b: number): number {
  assertSafe(a, 'ตัวตั้ง');
  assertSafe(b, 'ตัวลบ');
  const diff = a - b;
  assertSafe(diff, 'ผลต่าง');
  return diff || 0; // กัน -0
}
