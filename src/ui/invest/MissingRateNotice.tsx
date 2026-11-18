import type { MissingRateTrade } from '../../domain/invest/tradesFx';
import { formatDateEn } from '../../app/dateEn';

const KIND: Record<MissingRateTrade['kind'], string> = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' };
const SHOWN = 5;

/**
 * แจ้งรายการ USD ที่ไม่มีอัตราแลกเปลี่ยน (R26 ห้ามข้ามเงียบ): รายการเหล่านี้ไม่ถูกนับเป็น 0 และไม่ถูกเดาเรต
 * ยอดรวมที่ได้รับผลจึงเป็น incomplete · ไม่มีรายการ = ไม่แสดงอะไร (ไม่มีสูตรเงินที่นี่ ข้อมูลมาจาก domain)
 */
export function MissingRateNotice({ trades, tickerOf }: { trades: readonly MissingRateTrade[]; tickerOf?: (assetId: string) => string }) {
  if (trades.length === 0) return null;
  const sorted = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  return (
    <div className="muted small" role="status" data-testid="needs-rate-notice">
      <p>
        Needs rate: {trades.length} {trades.length === 1 ? 'transaction has' : 'transactions have'} no exchange rate, so {trades.length === 1 ? 'it is' : 'they are'} not counted (not as 0) and the totals are incomplete. Edit the transaction and add the rate for its date.
      </p>
      <ul>
        {sorted.slice(0, SHOWN).map((t) => (
          <li key={t.id}>
            {KIND[t.kind]}
            {tickerOf ? ` ${tickerOf(t.assetId)}` : ''} · {formatDateEn(t.date)} · Needs rate
          </li>
        ))}
      </ul>
      {sorted.length > SHOWN && <p>and {sorted.length - SHOWN} more</p>}
    </div>
  );
}
