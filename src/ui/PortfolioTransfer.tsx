import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { baht } from '../app/bahtFormat';
import { investError } from './invest/investError';
import { newId } from '../app/ids';
import { classifyPortfolioTransfer } from '../domain/invest/portfolioMoney';
import { emptyInvestments, type InvestmentData } from '../domain/invest/types';
import { createEntry } from '../domain/ledger/entry';
import { isSupportedEntryDate, lengthWithin, MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import type { Account, Entry } from '../domain/ledger/types';
import { parseBahtToSatang } from '../domain/money/satang';
import { nextCreatedAt } from '../storage/repository';
import { useRepository } from './RepositoryContext';

interface Props {
  today: string;
  accounts: readonly Account[];
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
}

/**
 * โอนเข้า/ออกพอร์ต (A3-2 · R23): ย้ายเงินบาทระหว่างกระเป๋าเงินใช้จ่ายกับบัญชีเงินสดที่ติดป้ายเงินลงทุน (เช่น เงินที่พักกับโบรกเกอร์)
 * บันทึกเป็น Entry 2 บรรทัดสินทรัพย์↔สินทรัพย์ ไม่ใช่รายรับ/รายจ่าย จึงไม่อยู่ในกราฟหมวด และไม่ทำให้ "ใช้ได้วันนี้" ลดลงจากการโอน
 * แสดงเมื่อมีบัญชีเงินสดป้ายเงินลงทุน (บาท ไม่ผูกสินทรัพย์) เท่านั้น · ตั้งป้ายได้ที่ "ชื่อและป้ายกระเป๋า" ในหน้าบัญชี
 */
export function PortfolioTransfer({ today, accounts, wallets, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [direction, setDirection] = useState<'to-portfolio' | 'from-portfolio'>('to-portfolio');
  const [walletId, setWalletId] = useState('');
  const [brokerId, setBrokerId] = useState('');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    repo
      .loadInvestments()
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(emptyInvestments()));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const brokers = useMemo(() => {
    const bound = new Set((data?.assets ?? []).map((a) => a.accountId));
    return accounts.filter((a) => a.type === 'asset' && a.currency === 'THB' && a.kind === 'investment' && !a.archived && !bound.has(a.id));
  }, [accounts, data]);

  if (data === null || brokers.length === 0) return null;
  const wallet = wallets.find((w) => w.id === walletId)?.id ?? wallets[0]?.id ?? '';
  const broker = brokers.find((b) => b.id === brokerId)?.id ?? brokers[0]!.id;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setMessage('');
    if (!isSupportedEntryDate(date)) return setError('Invalid date (YYYY-MM-DD, year 1900-2999)');
    if (date > today) return setError('Cannot record a future date');
    if (!lengthWithin(memo, 0, MAX_MEMO_LENGTH)) return setError(`Note must be at most ${MAX_MEMO_LENGTH} characters`);
    let satang: number;
    try {
      satang = parseBahtToSatang(amount);
    } catch {
      return setError('Invalid amount');
    }
    if (satang < 1 || /^\s*[+-]/.test(amount)) return setError('Amount must be greater than 0 (at least 0.01 THB)');
    if (wallet === '' || broker === '') return setError('Choose a wallet and an investment account');
    const label = direction === 'to-portfolio' ? 'Transfer to portfolio' : 'Transfer from portfolio';
    const lines =
      direction === 'to-portfolio'
        ? [{ accountId: broker, amount: satang }, { accountId: wallet, amount: -satang }]
        : [{ accountId: wallet, amount: satang }, { accountId: broker, amount: -satang }];
    const input = { id: newId('entry'), date, memo: memo.trim() === '' ? label : `${label} · ${memo.trim()}`, source: 'manual' as const, createdAt: nextCreatedAt(), lines };
    try {
      createEntry(accounts, input); // ตรวจกติกาสมุดก่อนส่ง (สมดุล วันที่ บัญชีมีจริง)
    } catch (err) {
      return setError(investError(err));
    }
    // ตรวจซ้ำว่าเป็นการโอนเข้า/ออกพอร์ตจริงตามนิยาม R23 (กันบัญชีที่ผูกสินทรัพย์หรือสกุลผิด)
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const kind = classifyPortfolioTransfer({ ...input, source: 'manual' } as Entry, byId, new Set(data.assets.map((a) => a.accountId)));
    if (kind !== direction) return setError('The selected accounts are not a transfer between a spending wallet and an investment account');
    setError('');
    setBusy(true);
    try {
      await repo.appendEntry(input);
      setAmount('');
      setMemo('');
      setMessage(`${label}: ${baht(satang)} recorded`);
      onLedgerChanged();
    } catch (err) {
      setError(investError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="solid card pf-transfer" aria-labelledby="pf-xfer-title">
      <h2 id="pf-xfer-title">Transfer to/from portfolio</h2>
      <p className="muted small">Move baht between a spending wallet and an investment account (for example, cash held with a broker). It is not counted as income or an expense, and "Available today" does not include money in investment accounts.</p>
      <form onSubmit={submit} className="settings-form" noValidate>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pf-x-dir">Direction</label>
            <select id="pf-x-dir" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              <option value="to-portfolio">Transfer to portfolio (from spending wallet)</option>
              <option value="from-portfolio">Transfer from portfolio (to spending wallet)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-x-date">Date</label>
            <input id="pf-x-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pf-x-wallet">Spending wallet</label>
            <select id="pf-x-wallet" value={wallet} onChange={(e) => setWalletId(e.target.value)}>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-x-broker">Investment account</label>
            <select id="pf-x-broker" value={broker} onChange={(e) => setBrokerId(e.target.value)}>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pf-x-amount">Amount (THB)</label>
            <input id="pf-x-amount" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'pf-x-err' : undefined} />
          </div>
          <div className="field">
            <label htmlFor="pf-x-memo">Note (optional)</label>
            <input id="pf-x-memo" autoComplete="off" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
        </div>
        <div role="alert">
          {error && (
            <p id="pf-x-err" className="avg-err">
              {error}
            </p>
          )}
        </div>
        <div role="status">{message && <p className="muted">{message}</p>}</div>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || wallets.length === 0}>
            {busy ? 'Saving…' : 'Save transfer'}
          </button>
        </div>
      </form>
    </section>
  );
}
