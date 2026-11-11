/**
 * สัดส่วนพอร์ต (พอร์ตลงทุน P6 · R17) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 *   - สัดส่วนเป็น basis points จำนวนเต็ม (1% = 100) รวมกันได้ 10,000 พอดีด้วยวิธีเศษมากสุด (largest remainder)
 *     ไม่ใช้ทศนิยมลอยตัว · ใช้ BigInt เพราะน้ำหนัก (สตางค์) × 10,000 เกินช่วงปลอดภัยของ number ได้
 *   - สัดส่วนใช้แสดงผลเท่านั้น ห้ามนำกลับไปคำนวณยอดเงิน (R8)
 */

export const TOTAL_BPS = 10_000;

export interface AllocationInput {
  key: string;
  /** น้ำหนัก (สตางค์ ≥ 0) เช่น มูลค่าหรือต้นทุนของสินทรัพย์ */
  weight: number;
}

export interface AllocationShare {
  key: string;
  /** สัดส่วน (basis points จำนวนเต็ม) */
  bps: number;
}

/**
 * แบ่ง 10,000 bps ตามน้ำหนัก · น้ำหนัก 0 ไม่ปรากฏ · รวมเป็น 10,000 เสมอ (เมื่อมีน้ำหนักรวม > 0)
 * เรียงจากมากไปน้อย (เท่ากันเรียงตาม key) · น้ำหนักติดลบหรือไม่ใช่จำนวนเต็มปลอดภัย = RangeError
 */
export function allocateBps(items: readonly AllocationInput[]): AllocationShare[] {
  let total = 0n;
  const positive: { key: string; weight: bigint }[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.key)) throw new RangeError(`key ซ้ำ: ${it.key}`); // key ซ้ำทำให้แจกเศษผิด จึงปฏิเสธ
    seen.add(it.key);
    if (!Number.isSafeInteger(it.weight) || it.weight < 0) throw new RangeError(`น้ำหนักไม่ถูกต้อง: ${String(it.weight)}`);
    if (it.weight === 0) continue;
    const w = BigInt(it.weight);
    total += w;
    positive.push({ key: it.key, weight: w });
  }
  if (total === 0n) return [];
  const T = BigInt(TOTAL_BPS);
  const rows = positive.map((p) => {
    const scaled = p.weight * T;
    return { key: p.key, weight: p.weight, base: scaled / total, rem: scaled % total };
  });
  let left = Number(T - rows.reduce((s, r) => s + r.base, 0n)); // < จำนวนแถว (เล็กมาก)
  // แจกที่เหลือให้แถวที่เศษมากสุดก่อน (เท่ากันให้แถวน้ำหนักมากกว่า แล้วตาม key)
  const order = [...rows].sort((a, b) => (a.rem === b.rem ? (a.weight === b.weight ? (a.key < b.key ? -1 : 1) : a.weight > b.weight ? -1 : 1) : a.rem > b.rem ? -1 : 1));
  const extra = new Map<string, bigint>();
  for (const r of order) {
    if (left <= 0) break;
    extra.set(r.key, 1n);
    left -= 1;
  }
  return rows
    .map((r) => ({ key: r.key, bps: Number(r.base + (extra.get(r.key) ?? 0n)), weight: r.weight }))
    .sort((a, b) => (a.bps === b.bps ? (a.weight === b.weight ? (a.key < b.key ? -1 : 1) : a.weight > b.weight ? -1 : 1) : b.bps - a.bps))
    .map(({ key, bps }) => ({ key, bps }));
}

/** รวมสัดส่วนที่เกิน maxVisible รายการเป็นก้อนเดียว (บวก bps เป็นจำนวนเต็ม) · keyOther = key ของก้อนรวม */
export function groupSmallShares(shares: readonly AllocationShare[], maxVisible: number, keyOther = 'other'): AllocationShare[] {
  if (maxVisible < 1 || shares.length <= maxVisible) return [...shares];
  const head = shares.slice(0, maxVisible - 1);
  const restBps = shares.slice(maxVisible - 1).reduce((s, x) => s + x.bps, 0);
  return [...head, { key: keyOther, bps: restBps }];
}

/** "12.3%" จาก bps (ปัดครึ่งขึ้นเป็น 1 ตำแหน่ง ด้วยจำนวนเต็มล้วน) · น้อยกว่า 0.05% แสดง "<0.1%" */
export function formatBps(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > TOTAL_BPS) throw new RangeError(`bps ไม่ถูกต้อง: ${String(bps)}`);
  if (bps === 0) return '0%';
  if (bps < 5) return '<0.1%';
  const tenthsTotal = (bps + 5 - ((bps + 5) % 10)) / 10; // ปัดเป็นหน่วย 0.1%
  const whole = (tenthsTotal - (tenthsTotal % 10)) / 10;
  const tenth = tenthsTotal % 10;
  return tenth === 0 ? `${whole}%` : `${whole}.${tenth}%`;
}
