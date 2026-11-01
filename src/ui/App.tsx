import { useMemo } from 'react';
import { balanceOf, classifyEntry, periodTotals } from '../domain/ledger/balance';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Entry } from '../domain/ledger/types';
import { formatBaht, satang } from '../domain/money/satang';
import { accounts, entries } from '../sampleLedger';

const NOVEMBER = { from: '2026-11-01', to: '2026-11-30' };

function walletTotal(): number {
  return accounts
    .filter((a) => a.type === 'asset' && a.currency === 'THB')
    .reduce((sum, a) => sum + balanceOf(a.id, entries), 0);
}

function rowAmount(entry: Entry): { kind: 'income' | 'expense' | 'transfer'; text: string } {
  const kind = classifyEntry(accounts, entry);
  const byType = (type: string) =>
    entry.lines
      .filter((l) => accounts.find((a) => a.id === l.accountId)?.type === type)
      .reduce((s, l) => s + l.amount, 0);
  if (kind === 'expense') return { kind, text: formatBaht(satang(-byType('expense'))) };
  if (kind === 'income') return { kind, text: `+${formatBaht(satang(-byType('income')))}` };
  const moved = entry.lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  return { kind, text: formatBaht(satang(moved)) };
}

export function App() {
  const totals = useMemo(() => periodTotals(accounts, entries, NOVEMBER), []);
  const wallets = useMemo(
    () =>
      accounts
        .filter((a) => a.type === 'asset')
        .map((a) => ({ id: a.id, name: a.name, balance: satang(balanceOf(a.id, entries)) })),
    [],
  );
  const integrity = useMemo(() => runIntegrityCheck(accounts, entries), []);
  const recent = useMemo(() => [...entries].filter((e) => e.source !== 'system').reverse(), []);

  return (
    <div className="page">
      <div className="glow glow-gold" aria-hidden="true" />
      <div className="glow glow-blue" aria-hidden="true" />
      <div className="glow glow-green" aria-hidden="true" />

      <aside className="glass sidebar">
        <div className="brand">
          <span className="brand-mark">฿</span>
          <span className="brand-name">Money Buddy</span>
        </div>
        <nav aria-label="เมนูหลัก">
          <button className="nav-item nav-item-active" aria-current="page">วันนี้</button>
          <button className="nav-item">รายการ</button>
          <button className="nav-item">แผน</button>
          <button className="nav-item">ความมั่งคั่ง</button>
          <button className="nav-item">ภาษีและรายงาน</button>
        </nav>
        <p className="sidebar-note">M0: โครงสร้างพื้นฐานและสูตรเงิน ข้อมูลในหน้านี้เป็นตัวอย่าง</p>
      </aside>

      <main className="content">
        <header>
          <h1>วันนี้</h1>
          <p className="muted">พฤศจิกายน 2569</p>
        </header>

        <section className="row">
          <div className="glass card hero">
            <div className="muted">เงินในกระเป๋าทั้งหมด</div>
            <div className="hero-number">{formatBaht(satang(walletTotal()))}</div>
            <div className="muted">คำนวณจากผลรวมรายการในสมุดบัญชี ไม่ได้เก็บยอดไว้ตรงๆ</div>
          </div>
          <div className="glass card">
            <div className="muted">ตรวจความถูกต้อง</div>
            <div className={integrity.ok ? 'ok' : 'bad'}>
              {integrity.ok
                ? `ผ่านทั้งหมด (${integrity.checkedEntries} รายการ)`
                : `พบ ${integrity.issues.length} ปัญหา`}
            </div>
          </div>
        </section>

        <section className="stats">
          <div className="glass card">
            <div className="muted">รายรับ</div>
            <div className="stat income">{formatBaht(satang(totals.income))}</div>
          </div>
          <div className="glass card">
            <div className="muted">รายจ่าย</div>
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
                <span className="num">{formatBaht(w.balance)}</span>
              </div>
            ))}
          </div>

          <div className="solid card recent">
            <h2>รายการล่าสุด</h2>
            {recent.map((entry) => {
              const row = rowAmount(entry);
              return (
                <div className="tx" key={entry.id}>
                  <div>
                    <div>{entry.memo}</div>
                    <div className="muted small">{entry.date}</div>
                  </div>
                  <div className={`num tx-${row.kind}`}>{row.text}</div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
