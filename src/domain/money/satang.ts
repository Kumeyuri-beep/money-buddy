/**
 * เงินบาทในระบบเก็บเป็น "สตางค์" (จำนวนเต็ม) เสมอ (กฎ R1)
 *
 * ขอบเขตการแปลงหน่วย (กฎ R2):
 *   - parseBahtToSatang  ใช้ตอนรับข้อมูลเข้าเท่านั้น (ฟอร์ม, CSV, OCR, Quick Text)
 *   - toBaht / formatBaht ใช้ตอนแสดงผลหรือส่งออกเท่านั้น
 * ฟังก์ชันตรวจสอบ, โหลด, ย้ายข้อมูล ห้ามแปลงหน่วยซ้ำ
 */

export type Satang = number & { readonly __brand: 'Satang' };

/** ยืนยันว่าเป็นจำนวนเต็มปลอดภัย แล้วติดป้าย Satang */
export function satang(value: number): Satang {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`สตางค์ต้องเป็นจำนวนเต็มที่อยู่ในช่วงปลอดภัย (ได้รับ ${String(value)})`);
  }
  return (value || 0) as Satang; // `|| 0` กัน -0
}

const BAHT_PATTERN = /^([+-])?(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/**
 * แปลงข้อความจำนวนเงินบาทเป็นสตางค์ โดยไม่ผ่านทศนิยมลอยตัว
 * รับ: "65", "65.5", "1,234.50", "-65", "฿65", "1.005" (ปัดครึ่งออกจากศูนย์ -> 101)
 * ไม่รับ: ข้อความว่าง, "abc", "1.2.3"
 */
export function parseBahtToSatang(input: string): Satang {
  const cleaned = input.replace(/[฿\s]/g, '');
  const match = BAHT_PATTERN.exec(cleaned);
  const intPart = match?.[2];
  const fracPart = match?.[3];
  // ต้องมีตัวเลขอย่างน้อยหนึ่งหลัก ("." เปล่าๆ และ "฿" เปล่าๆ ไม่ผ่าน)
  if (!match || (intPart === undefined && !fracPart)) {
    throw new SyntaxError(`อ่านจำนวนเงินไม่ได้: "${input}"`);
  }
  const whole = BigInt((intPart ?? '0').replace(/,/g, ''));
  const frac = fracPart ?? '';
  const twoDigits = BigInt(frac.slice(0, 2).padEnd(2, '0'));
  const roundUp = frac.length > 2 && Number(frac[2]) >= 5 ? 1n : 0n;
  const magnitude = whole * 100n + twoDigits + roundUp;
  if (magnitude > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`จำนวนเงินใหญ่เกินไป: "${input}"`);
  }
  const value = Number(magnitude);
  return satang(match[1] === '-' ? -value : value);
}

/** สตางค์ -> ตัวเลขบาท สำหรับแสดงผลหรือส่งออกเท่านั้น ห้ามนำไปคำนวณเงินต่อ */
export function toBaht(value: Satang): number {
  return value / 100;
}

/** "1,234.50" (ไม่มีสัญลักษณ์สกุลเงิน เหมาะกับ CSV export) */
export function toBahtString(value: Satang): string {
  const abs = Math.abs(value);
  const baht = Math.floor(abs / 100);
  const sat = abs % 100;
  const grouped = String(baht).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value < 0 ? '-' : ''}${grouped}.${String(sat).padStart(2, '0')}`;
}

/** "฿1,234.50" หรือ "−฿65.00" (ใช้เครื่องหมายลบแบบ −) สำหรับหน้าจอ */
export function formatBaht(value: Satang): string {
  const text = toBahtString(satang(Math.abs(value)));
  return `${value < 0 ? '−' : ''}฿${text}`;
}

/** รวมสตางค์ทั้งหมด (ตรวจช่วงปลอดภัยทุกครั้ง) */
export function sumSatang(values: readonly Satang[]): Satang {
  let total = 0;
  for (const v of values) total += v;
  return satang(total);
}
