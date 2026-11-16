import { baht, signed } from '../../../app/bahtFormat';
import { usd, usdSigned } from '../../../app/usdFormat';
import { Dash } from './Dash';
import { toneOf } from './format';

/** เซลล์เงินตามสกุลที่เลือก · null = "—" · ค่าบวก/ลบมีเครื่องหมายกำกับ (ไม่พึ่งสีอย่างเดียว) */
export function MoneyCell({ thb, usdCents, currency, signedValue, why }: { thb?: number | null; usdCents?: number | null; currency: 'THB' | 'USD'; signedValue?: boolean; why?: string }) {
  const v = currency === 'THB' ? thb : usdCents;
  if (v === null || v === undefined) return <Dash {...(why ? { why } : {})} />;
  const text = currency === 'THB' ? (signedValue ? signed(v) : baht(v)) : signedValue ? usdSigned(v) : usd(v);
  return signedValue ? <span className={`an-${toneOf(v)}`}>{text}</span> : <>{text}</>;
}
