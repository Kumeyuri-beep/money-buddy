import { useMemo } from 'react';
import { monthRange, thaiMonthLabel } from '../app/dates';
import { describeEntry } from '../app/describe';
import { balanceOf, periodTotals } from '../domain/ledger/balance';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import { formatBaht, satang } from '../domain/money/satang';
import type { Ledger } from '../storage/repository';

interface TodayProps {
  ledger: Ledger;
  onAdd: () => void;
}

export function Today({ ledger, onAdd }: TodayProps) {
  const { accounts, entries } = ledger;
  const now = useMemo(() => new Date(), []);

  const totals = useMemo(() => periodTotals(accounts, entries, monthRange(now)), [accounts, entries, now]);
  const wallets = useMemo(
    () =>
      accounts
        .filter((a) => a.type === 'asset' && a.currency === 'THB' && !a.archived)
        .map((a) => ({ id: a.id, name: a.name, balance: balanceOf(a.id, entries) })),
    [accounts, entries],
  );
  const walletTotal = wallets.reduce((sum, w) => sum + w.balance, 0);
  const integrity = useMemo(() => runIntegrityCheck(accounts, entries), [accounts, entries]);
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
      <header className="page-header">
        <div>
          <h1>วันนี้</h1>
          <p className="muted">{thaiMonthLabel(now)}</p>
        </div>
        <button className="btn btn-primary" onClick={onAdd}>
          บันทึกรายการ
        </button>
      </header>

      <section className="row">
        <div className="glass card hero">
          <div className="muted">เงินในกระเป๋าทั้งหมด</div>
          <div className="hero-number">{formatBaht(satang(walletTotal))}</div>
          <div className="muted">คำนวณจากผลรวมรายการในสมุดบัญชี ไม่ได้เก็บยอดไว้ตรงๆ</div>
        </div>
        <div className="glass card">
          <div className="muted">ตรวจความถูกต้อง</div>
          <div className={integrity.ok ? 'ok' : 'bad'}>
            {integrity.ok ? `ผ่านทั้งหมด (${integrity.checkedEntries} รายการ)` : `พบ ${integrity.issues.length} ปัญหา`}
          </div>
        </div>
      </section>

      <section className="stats">
        <div className="glass card">
          <div className="muted">รายรับเดือนนี้</div>
          <div className="stat income">{formatBaht(satang(totals.income))}</div>
        </div>
        <div className="glass card">
          <div className="muted">รายจ่ายเดือนนี้</div>
          <div className="stat expense">{formatBaht(satang(totals.expense))}</div>
        </div>
        <div className="glass card">
          <div className="muted">คงเหลือสุทธิเดือนนี้</div>
          <div className="stat">{formatBaht(satang(totals.net))}</div>
        </div>
      </section>

      <section className="row">
        <div className="glass card wallets">
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
