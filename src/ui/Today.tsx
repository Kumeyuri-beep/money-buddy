import { useMemo } from 'react';
import { localIsoDate } from '../app/dates';
import { describeEntry } from '../app/describe';
import { balanceOf } from '../domain/ledger/balance';
import { formatBaht, satang } from '../domain/money/satang';
import type { Ledger } from '../storage/repository';
import { SummaryCards } from './overview/SummaryCards';

interface TodayProps {
  ledger: Ledger;
  onAdd: () => void;
  onOpenLedger: () => void;
}

export function Today({ ledger, onAdd, onOpenLedger }: TodayProps) {
  const { accounts, entries } = ledger;
  const today = useMemo(() => localIsoDate(new Date()), []);

  const wallets = useMemo(
    () =>
      accounts
        .filter((a) => a.type === 'asset' && a.currency === 'THB' && !a.archived)
        .map((a) => ({ id: a.id, name: a.name, balance: balanceOf(a.id, entries) })),
    [accounts, entries],
  );
  const recent = useMemo(
    () =>
      entries
        .filter((e) => e.source !== 'system')
        .slice()
        .reverse()
        .slice(0, 8)
        .map((entry) => ({ entry, ...describeEntry(accounts, entry) })),
    [accounts, entries],
  );

  return (
    <>
      <SummaryCards accounts={accounts} entries={entries} today={today} onOpenLedger={onOpenLedger} />

      <section className="row">
        {/* A5 จะปรับกระเป๋า/รายการล่าสุดใหม่ ตอนนี้เปลี่ยนเป็น glass-lite เพื่อไม่ให้กระจกแท้เกิน 8 ใบ */}
        <div className="glass-lite card wallets">
          <h2>กระเป๋าเงิน</h2>
          {wallets.map((w) => (
            <div className="wallet" key={w.id}>
              <span>{w.name}</span>
              <span className="num">{formatBaht(satang(w.balance))}</span>
            </div>
          ))}
        </div>

        <div className="solid card recent">
          <h2>รายการล่าสุด</h2>
          {recent.length === 0 ? (
            <div className="empty">
              <p className="muted">ยังไม่มีรายการ เริ่มจากรายจ่ายล่าสุดของคุณ เช่น ค่ากาแฟเมื่อเช้า</p>
              <button className="btn btn-ghost" onClick={onAdd}>
                บันทึกรายการแรก
              </button>
            </div>
          ) : (
            recent.map(({ entry, kind, amountText }) => (
              <div className="tx" key={entry.id}>
                <div>
                  <div>{entry.memo}</div>
                  <div className="muted small">{entry.date}</div>
                </div>
                <div className={`num tx-${kind}`}>{amountText}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
