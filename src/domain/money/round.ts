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

/**
 * เวอร์ชัน BigInt ของ roundHalfUp (กฎ R8, R17) ปัดครึ่งออกจากศูนย์ ใช้กับหน่วยลงทุน (10^8) ที่ number รับไม่ไหว
 * ห้ามสร้างฟังก์ชันปัดใหม่ที่อื่น
 */
export function roundHalfUpBig(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('roundHalfUpBig: ตัวหารเป็นศูนย์');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const rounded = (n % d) * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * ปัดขึ้น (ceiling) ของ numerator / denominator สำหรับจำนวนเต็มบวกเท่านั้น (กฎ R18 · ข้อยกเว้นของ R8 เจ้าของอนุมัติ 12 พ.ย. 2569)
 * ใช้เฉพาะ "เงินเก็บต่อเดือน" ของเครื่องคิดเลขเกษียณ (และการแสดงผลของค่านั้น) เพื่อไม่ให้เก็บขาด ห้ามใช้กับยอดบัญชีจริงหรือค่าอื่น
 */
export function ceilDivBig(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('ceilDivBig: ตัวหารต้องเป็นบวก');
  if (numerator < 0n) throw new RangeError('ceilDivBig: ตัวตั้งต้องไม่ติดลบ');
  return (numerator + denominator - 1n) / denominator;
}

/**
 * ปัดลง (floor) ของ numerator / denominator สำหรับตัวตั้งไม่ติดลบและตัวหารบวก (กฎ R29 · ข้อยกเว้นการปัดเศษของ R8 เฉพาะ Rebalancing)
 * `/` ของ BigInt ปัดเข้าหาศูนย์ จึงต้องจำกัดอินพุตให้ไม่ติดลบ ห้ามใช้ `Math.floor` หรือ `/` ตรงๆ ในโค้ด R29
 */
export function floorDivBig(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('floorDivBig: ตัวหารต้องเป็นบวก');
  if (numerator < 0n) throw new RangeError('floorDivBig: ตัวตั้งต้องไม่ติดลบ');
  return numerator / denominator;
}
