/**
 * ตัวปัดเศษกลางตัวเดียวของทั้งแอป (กฎ R8) ห้ามใช้ Math.round กระจายในโค้ดเงิน
 *
 * กติกา: ปัดครึ่งออกจากศูนย์ (half away from zero)
 *   2.5 -> 3,  -2.5 -> -3,  2.4 -> 2,  -2.4 -> -2
 * คำนวณด้วยจำนวนเต็มล้วน ไม่ผ่านทศนิยมลอยตัว
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError('roundHalfUp: ต้องเป็นจำนวนเต็มที่อยู่ในช่วงปลอดภัย');
  }
  if (denominator === 0) {
    throw new RangeError('roundHalfUp: ตัวหารเป็นศูนย์');
  }
  const negative = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const quotient = Math.floor(n / d);
  const remainder = n % d;
  // remainder * 2 >= d  เขียนเป็น remainder >= d - remainder เพื่อกันเกินช่วงปลอดภัย
  const rounded = remainder >= d - remainder ? quotient + 1 : quotient;
  return (negative ? -rounded : rounded) || 0; // `|| 0` กัน -0
}
