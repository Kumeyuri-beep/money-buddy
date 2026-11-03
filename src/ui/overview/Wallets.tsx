import { useMemo } from 'react';
import { walletShares } from '../../domain/ledger/walletShares';
import type { Account, Entry } from '../../domain/ledger/types';
import { formatBaht, satang } from '../../domain/money/satang';

/** กระเป๋าเงิน (glass-lite): ยอดจริง + แถบสัดส่วน % ของกระเป๋าที่ไม่ติดลบ (คำนวณใน domain) */
export function Wallets({ accounts, entries }: { accounts: readonly Account[]; entries: readonly Entry[] }) {
  const wallets = useMemo(() => walletShares(accounts, entries), [accounts, entries]);

  return (
    <section className="glass-lite card wallets" aria-labelledby="wallets-title">
      <h2 id="wallets-title">กระเป๋าเงิน</h2>
      {wallets.length === 0 ? (
        <p className="muted">ยังไม่มีกระเป๋าเงิน</p>
      ) : (
        <ul className="wallet-list">
          {wallets.map((w) => (
            <li className="wallet" key={w.id}>
              <div className="wallet-head">
                <span className="wallet-name">{w.name}</span>
                <span className={`num wallet-balance ${w.negative ? 'value-warn' : ''}`}>
                  {formatBaht(satang(w.balance))}
                </span>
              </div>
              <div className="meter wallet-meter" aria-hidden="true">
                <div className="meter-fill" style={{ width: `${w.percent}%` }} />
              </div>
              <div className="muted small">
                {w.negative ? '⚠ ยอดติดลบ (ไม่นับในสัดส่วน)' : `${w.percent}% ของเงินในกระเป๋าที่ไม่ติดลบ`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
