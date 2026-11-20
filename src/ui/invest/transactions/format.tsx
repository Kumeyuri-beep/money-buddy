import type { ReactNode } from 'react';
import { baht } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import type { TxAmount, TxRow } from '../../../domain/invest/transactionsView';

/** เปิด/ปิดเครื่องหมาย +/− หน้าคอลัมน์ Value (แบบร่าง 21 · เจ้าของยังไม่ตอบ GM เลือกตามแบบร่าง) · ปิดได้ที่บรรทัดนี้บรรทัดเดียว */
export const SHOW_VALUE_SIGN = true;

/** หน่วยย่อยจำนวนเต็ม → ข้อความเงิน (แสดงผลล้วน · ค่าทั้งหมดมาจาก src/domain/invest/transactionsView) */
export const amountText = (a: TxAmount): string => (a.currency === 'THB' ? baht(a.minor) : usd(a.minor));

/** เครื่องหมายหน้าค่า: ทิศทางมาจาก domain (row.direction) · out = U+2212 · in = + · ไม่มีทิศ = ไม่ใส่ */
export const signedAmountText = (a: TxAmount, direction: TxRow['direction']): string => (!SHOW_VALUE_SIGN || direction === null ? amountText(a) : `${direction === 'out' ? '−' : '+'}${amountText(a)}`);

/** ค่าที่ไม่มี: ขีด + ข้อความสำหรับโปรแกรมอ่านหน้าจอ */
export function NoValue(): ReactNode {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No value</span>
    </>
  );
}

/** ช่องเงิน: ไม่มีเรต = "Needs rate" · แปลงไม่ได้ = "Couldn't convert" (ข้อความที่มองเห็น ไม่พึ่งสีอย่างเดียว) · ไม่มีค่า = ขีด */
export function AmountCell({ a, row, hideZero, flag, signed }: { a: TxAmount | null; row: TxRow; hideZero?: boolean; flag?: boolean; signed?: boolean }): ReactNode {
  if (row.needsRate) return flag ? <span className="tx-needs">Needs rate</span> : <NoValue />;
  if (row.failed && a === null) return flag ? <span className="tx-needs">Couldn't convert</span> : <NoValue />;
  if (a === null || (hideZero && a.minor === 0)) return <NoValue />;
  return signed ? signedAmountText(a, row.direction) : amountText(a);
}
