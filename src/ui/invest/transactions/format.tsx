import type { ReactNode } from 'react';
import { baht } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import type { TxAmount, TxRow } from '../../../domain/invest/transactionsView';

/** หน่วยย่อยจำนวนเต็ม → ข้อความเงิน (แสดงผลล้วน · ค่าทั้งหมดมาจาก src/domain/invest/transactionsView) */
export const amountText = (a: TxAmount): string => (a.currency === 'THB' ? baht(a.minor) : usd(a.minor));

/** ค่าที่ไม่มี: ขีด + ข้อความสำหรับโปรแกรมอ่านหน้าจอ */
export function NoValue(): ReactNode {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No value</span>
    </>
  );
}

/** ช่องเงิน: ไม่มีเรต = ข้อความ "Needs rate" ที่มองเห็น (ไม่พึ่งสีอย่างเดียว) · ไม่มีค่า = ขีด */
export function AmountCell({ a, row, hideZero, flag }: { a: TxAmount | null; row: TxRow; hideZero?: boolean; flag?: boolean }): ReactNode {
  if (row.needsRate) return flag ? <span className="tx-needs">Needs rate</span> : <NoValue />;
  if (a === null || (hideZero && a.minor === 0)) return <NoValue />;
  return amountText(a);
}
