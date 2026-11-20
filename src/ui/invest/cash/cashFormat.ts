import { baht } from '../../../app/bahtFormat';
import { usd } from '../../../app/usdFormat';
import type { CashMovementKind } from '../../../domain/invest/cashView';
import type { InstrumentCurrency } from '../../../domain/invest/types';

/** หน่วยย่อย → ข้อความตามสกุล ("$120.37" / "฿5,000.00") · ไม่มีสูตรเงิน */
export const minorText = (currency: InstrumentCurrency, minor: number): string => (currency === 'USD' ? usd(minor) : baht(minor));

/** มีเครื่องหมายนำหน้าชัดเจน (ไม่พึ่งสีอย่างเดียว) */
export const signedMinorText = (currency: InstrumentCurrency, minor: number): string => (minor > 0 ? `+${minorText(currency, minor)}` : minorText(currency, minor));

export const MOVEMENT_LABEL: Record<CashMovementKind, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  'transfer-in': 'Transfer in',
  'transfer-out': 'Transfer out',
  exchange: 'Currency exchange',
};
