import { formatDateEn } from '../../app/dateEn';
import type { MissingRateTrade } from '../../domain/invest/tradesFx';

const KIND: Record<MissingRateTrade['kind'], string> = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' };
const SHOWN = 5;

/** ป้ายสั้นข้างยอดที่ได้รับผลกระทบ (ไม่พึ่งสีอย่างเดียว · R26) */
export function IncompleteTag() {
  return (
    <span className="mr-tag">
      {' '}
      <span aria-hidden="true">·</span> Incomplete
    </span>
  );
}

/**
 * แจ้งรายการ USD ที่ไม่มีอัตราแลกเปลี่ยน (R26 ห้ามข้ามเงียบ): รายการเหล่านี้ไม่ถูกนับเป็น 0 และไม่ถูกเดาเรต
 * ยอดรวมที่ได้รับผลจึงเป็น incomplete · ไม่มีรายการ = ไม่แสดงอะไร (ไม่มีสูตรเงินที่นี่ ข้อมูลมาจาก domain)
 */
export function MissingRateNotice({ trades, tickerOf }: { trades: readonly MissingRateTrade[]; tickerOf?: (assetId: string) => string }) {
  if (trades.length === 0) return null;
  const sorted = [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const many = trades.length !== 1;
  return (
    <section className="solid mr-notice" aria-label="Missing exchange rates" data-testid="needs-rate-notice">
      <p className="mr-title">Incomplete totals:</p>
      <p>
        {trades.length} {many ? 'transactions have' : 'transaction has'} no exchange rate, so {many ? 'they are' : 'it is'} not counted (not as 0). Edit {many ? 'each' : 'it'} and add the rate for its date.
      </p>
      <ul aria-label="Transactions that need a rate">
        {sorted.slice(0, SHOWN).map((t) => {
          const ticker = tickerOf?.(t.assetId);
          return (
            <li key={t.id}>
              {[KIND[t.kind], ticker || null].filter(Boolean).join(' ')} · {formatDateEn(t.date)} · Needs rate
            </li>
          );
        })}
      </ul>
      {sorted.length > SHOWN && <p>and {sorted.length - SHOWN} more</p>}
    </section>
  );
}
