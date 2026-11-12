/**
 * ผูกข้อมูลลงทุนจริงกับเครื่องคิดภาษี (เฟส 3 · กฎ R19): สรุปยอดซื้อของสินทรัพย์ที่ผู้ใช้ติดป้าย RMF/Thai ESG ในปีภาษี
 * หลักที่ต้องถือ:
 *   - ใช้เฉพาะรายการ "ซื้อ" (buy) ที่วันที่อยู่ในปีภาษี (ปี พ.ศ. 2569 = 1 ม.ค.–31 ธ.ค. ค.ศ. 2026 ตามวันที่ที่ผู้ใช้บันทึก)
 *   - ใช้ยอดซื้อ (amount) ไม่รวมค่าธรรมเนียม · ไม่นับปันผลลงทุนต่อ (reinvest) ปันผลเงินสด หรือการขาย
 *   - ไม่ใช้มูลค่าตลาดหรือต้นทุนเฉลี่ยคงเหลือ · ไม่นับแผน DCA ที่ยังไม่ยืนยัน (ใช้เฉพาะรายการที่บันทึกแล้ว)
 *   - อ่านอย่างเดียว ไม่เขียนกลับสมุดบัญชี ไม่ปนกำไร/ปันผล (R17) · ผลเป็นสตางค์จำนวนเต็ม คำนวณด้วย bigint
 *   - ผู้ใช้แก้ยอดได้เองตามหนังสือรับรองการซื้อจาก บลจ. (ตัวเลขนี้เป็นเพียงค่าตั้งต้นที่เติมให้)
 *   - ไม่ตรวจเงื่อนไขการถือครอง: ขายก่อนครบเงื่อนไขอาจต้องคืนสิทธิ แอปแจ้งจำนวนรายการขายให้ระวัง
 */

import type { InvestmentData } from '../invest/types';
import { isValidIsoDate } from '../ledger/entry';
import { MAX_TAX_INPUT_SATANG } from './config';

export interface TaxTags {
  rmf: readonly string[];
  thaiEsg: readonly string[];
}

export interface TaxPurchaseLine {
  assetId: string;
  name: string;
  tag: 'rmf' | 'thaiEsg';
  amountSatang: number;
  buyCount: number;
}

export interface TaxPurchaseSummary {
  /** ปีภาษี พ.ศ. */
  taxYear: number;
  fromDate: string;
  toDate: string;
  rmfSatang: number;
  thaiEsgSatang: number;
  /** เรียงตามประเภท (RMF ก่อน) แล้วตามชื่อ · เฉพาะสินทรัพย์ที่มีรายการซื้อในปี */
  lines: TaxPurchaseLine[];
  /** จำนวนรายการขายของสินทรัพย์ที่ติดป้ายในปีภาษี (ไว้เตือนเรื่องเงื่อนไขการถือครอง) */
  sellCount: number;
  /** ป้ายที่ชี้ไปยังสินทรัพย์ที่ถูกลบไปแล้ว */
  missingAssetCount: number;
  /** รายการซื้อ/ขายที่ข้ามเพราะข้อมูลผิดปกติ (ยอดซื้อไม่เป็นจำนวนเต็มบวก/วันที่ผิดรูปหรือเป็นไปไม่ได้) */
  skippedCount: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ปีภาษี พ.ศ. → ช่วงวันที่ ค.ศ. (รวมวันแรกและวันสุดท้าย) · ปีที่ไม่ใช่ พ.ศ. ที่สมเหตุสมผล = RangeError */
export function taxYearDateRange(taxYear: number): { from: string; to: string } {
  if (!Number.isInteger(taxYear) || taxYear < 2500 || taxYear > 2700) throw new RangeError('ปีภาษีต้องเป็นปี พ.ศ. เช่น 2569');
  const ce = taxYear - 543;
  return { from: `${ce}-01-01`, to: `${ce}-12-31` };
}

export function summarizeTaxPurchases(data: InvestmentData, tags: TaxTags, taxYear: number): TaxPurchaseSummary {
  const { from, to } = taxYearDateRange(taxYear);
  const tagOf = new Map<string, 'rmf' | 'thaiEsg'>();
  for (const id of tags.thaiEsg) tagOf.set(id, 'thaiEsg');
  for (const id of tags.rmf) tagOf.set(id, 'rmf'); // ซ้อนกัน (ข้อมูลผิดปกติ): RMF ชนะ ไม่นับซ้ำ
  const assetById = new Map(data.assets.map((a) => [a.id, a]));

  let missingAssetCount = 0;
  for (const id of tagOf.keys()) if (!assetById.has(id)) missingAssetCount++;

  const perAsset = new Map<string, { amount: bigint; count: number }>();
  let sellCount = 0;
  let skippedCount = 0;
  for (const t of data.trades) {
    if (!tagOf.has(t.assetId) || !assetById.has(t.assetId)) continue;
    if (t.kind !== 'buy' && t.kind !== 'sell') continue; // reinvest/dividend ไม่นับ
    if (typeof t.date !== 'string' || !DATE.test(t.date) || !isValidIsoDate(t.date)) {
      skippedCount++; // วันที่ผิดรูปหรือเป็นไปไม่ได้ (ทั้งซื้อและขาย): ข้ามและนับ ไม่เดาปี
      continue;
    }
    if (t.date < from || t.date > to) continue;
    if (t.kind === 'sell') {
      sellCount++;
      continue;
    }
    if (typeof t.amount !== 'number' || !Number.isSafeInteger(t.amount) || t.amount <= 0) {
      skippedCount++;
      continue;
    }
    const cur = perAsset.get(t.assetId) ?? { amount: 0n, count: 0 };
    cur.amount += BigInt(t.amount);
    cur.count++;
    perAsset.set(t.assetId, cur);
  }

  let rmf = 0n;
  let thaiEsg = 0n;
  const lines: TaxPurchaseLine[] = [];
  for (const [assetId, v] of perAsset) {
    const tag = tagOf.get(assetId)!;
    if (tag === 'rmf') rmf += v.amount;
    else thaiEsg += v.amount;
    if (v.amount > BigInt(MAX_TAX_INPUT_SATANG)) throw new RangeError('ยอดซื้อรวมใหญ่เกินกว่าที่เครื่องคิดภาษีรองรับ');
    lines.push({ assetId, name: assetById.get(assetId)!.name, tag, amountSatang: Number(v.amount), buyCount: v.count });
  }
  const max = BigInt(MAX_TAX_INPUT_SATANG);
  if (rmf > max || thaiEsg > max) throw new RangeError('ยอดซื้อรวมใหญ่เกินกว่าที่เครื่องคิดภาษีรองรับ');
  lines.sort((a, b) => (a.tag === b.tag ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.tag === 'rmf' ? -1 : 1));

  return { taxYear, fromDate: from, toDate: to, rmfSatang: Number(rmf), thaiEsgSatang: Number(thaiEsg), lines, sellCount, missingAssetCount, skippedCount };
}
