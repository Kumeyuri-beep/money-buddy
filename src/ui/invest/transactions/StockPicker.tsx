import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { UsTradeKind } from '../../../app/usForms';
import type { Asset } from '../../../domain/invest/types';

const TITLE: Record<UsTradeKind, string> = { buy: 'Buy', sell: 'Sell', dividend: 'Record a dividend' };

interface Props {
  kind: UsTradeKind;
  /** หุ้นสหรัฐ (สินทรัพย์สกุล USD) ที่เลือกได้ */
  stocks: readonly Asset[];
  /** ยังไม่มีบัญชีเงินสด USD: ฟอร์มบันทึกจะใช้ไม่ได้ · ให้ทางสร้างบัญชีจากที่นี่ */
  noUsdCash: boolean;
  onContinue: (assetId: string) => void;
  onAddStock: () => void;
  onCreateCash: () => void;
  onClose: () => void;
}

/** ขั้นแรกของ Add → Buy/Sell/Dividend: เลือกหุ้นก่อน แล้วเปิดฟอร์มเดิมของ UsStocksView (ไม่มีฟอร์มซื้อขายใหม่ · ไม่มีสูตรเงิน) */
export function StockPicker({ kind, stocks, noUsdCash, onContinue, onAddStock, onCreateCash, onClose }: Props) {
  const [assetId, setAssetId] = useState(stocks[0]?.id ?? '');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !(e.target instanceof HTMLSelectElement)) {
      e.preventDefault();
      onClose();
    }
  };
  return (
    <section className="solid card tx-panel" aria-labelledby="tx-pick-title" onKeyDown={onKey}>
      <h2 id="tx-pick-title" ref={heading} tabIndex={-1}>
        {TITLE[kind]}: choose a stock
      </h2>
      {stocks.length === 0 ? (
        <p className="muted">You have no US stocks yet. Add one first, then record the transaction.</p>
      ) : (
        <div className="field">
          <label htmlFor="tx-pick-asset">Stock</label>
          <select id="tx-pick-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ticker ? `${s.ticker} · ${s.name}` : s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {noUsdCash && (
        <p className="muted small" role="status">
          You need a USD cash account (and some dollars) before you can record this.{' '}
          <button type="button" className="tx-link" onClick={onCreateCash}>
            Create USD cash account
          </button>
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
          Cancel
        </button>
        {stocks.length === 0 ? (
          <button type="button" className="btn btn-primary btn-small" onClick={onAddStock}>
            Add stock
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-small" onClick={() => onContinue(assetId)}>
            Continue
          </button>
        )}
      </div>
    </section>
  );
}
