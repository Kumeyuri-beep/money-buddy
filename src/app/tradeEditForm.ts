/**
 * แปลงรายการลงทุนที่บันทึกแล้วกลับเป็นข้อความในฟอร์ม (หน้าแก้รายการ · R2 ข้อ 4 ส่วน B) · ฟังก์ชันล้วน ไม่แตะ DOM/เครือข่าย
 * ฟอร์มแก้ใช้ฟอร์มเดียวกับตอน Add และตัวสร้างรายการเดียวกัน (buildTradeRecord / buildUsTradeRecord) จึงตรวจกติกาเหมือนกันทุกประการ
 * เงินแปลงเป็นข้อความด้วยจำนวนเต็มล้วน (ไม่ผ่านทศนิยมลอยตัว) หน่วย/ราคาใช้ตัวจัดรูปเดิมของ domain
 */

import type { TradeRecord } from '../domain/invest/types';
import { formatUnits } from '../domain/invest/units';
import type { Account, Entry } from '../domain/ledger/types';
import { formatMicro } from '../domain/money/micro';
import { emptyTradeForm, type TradeForm } from './tradeForm';
import type { UsTradeForm } from './usForms';

/** สตางค์/เซนต์ (จำนวนเต็มไม่ติดลบ) → "1234.56" สำหรับใส่ในช่องกรอก (ตัวอ่านเดิม parseBahtToSatang อ่านกลับได้ตรง) */
export function minorToInput(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) throw new RangeError('จำนวนเงินต้องเป็นจำนวนเต็มไม่ติดลบ');
  const whole = BigInt(minor) / 100n;
  const frac = BigInt(minor) % 100n;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}

/** เติมค่าเดิมของรายการ (สินทรัพย์บาท: ซื้อ/ขาย/ปันผล/ปันผลลงทุนต่อ) · ช่องที่รายการไม่มีค่า = ว่าง */
export function tradeToForm(t: TradeRecord): TradeForm {
  return {
    ...emptyTradeForm(t.assetId, t.kind, t.date),
    units: t.units !== undefined ? formatUnits(BigInt(t.units)) : '',
    price: t.priceMicro !== undefined ? formatMicro(t.priceMicro) : '',
    amount: t.amount !== undefined ? minorToInput(t.amount) : '',
    fee: t.fee > 0 ? minorToInput(t.fee) : '',
    withholding: t.withholding > 0 ? minorToInput(t.withholding) : '',
    memo: t.memo,
  };
}

/** เติมค่าเดิมของรายการหุ้นสหรัฐ (ซื้อ/ขาย/ปันผล) พร้อมอัตราแลกเปลี่ยน · ปันผลลงทุนต่อไม่มีในฟอร์มนี้ */
export function usTradeToForm(t: TradeRecord): UsTradeForm {
  if (t.kind !== 'buy' && t.kind !== 'sell' && t.kind !== 'dividend') throw new Error(`ฟอร์มหุ้นสหรัฐไม่รองรับรายการชนิด ${t.kind}`);
  return { ...tradeToForm(t), kind: t.kind, fxRate: t.fxRateMicro !== undefined ? formatMicro(t.fxRateMicro) : '' };
}

/**
 * กระเป๋า (บาท) หรือบัญชีเงินสด USD ที่รายการเดิมใช้จ่าย/รับเงิน = บัญชีสินทรัพย์ในรายการสมุดที่ไม่ใช่บัญชีต้นทุนของสินทรัพย์ (ข้ามบรรทัดรายรับ/รายจ่าย)
 * ไม่พบ (ปันผลลงทุนต่อไม่มีกระเป๋า · ไม่มีรายการสมุด) = undefined
 */
export function linkedCashAccountId(entry: Entry | undefined, assetAccountId: string, accounts: readonly Account[]): string | undefined {
  if (!entry) return undefined;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return entry.lines.find((l) => l.accountId !== assetAccountId && byId.get(l.accountId)?.type === 'asset')?.accountId;
}
