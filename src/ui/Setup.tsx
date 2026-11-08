import { useState, type FormEvent } from 'react';
import { thaiIsoDate } from '../app/dates';
import { buildInitialLedger, DEFAULT_WALLETS, SetupError, type WalletInput } from '../app/setup';
import { db } from '../storage/instance';
import { saveInitialLedger } from '../storage/repository';

interface SetupProps {
  onDone: () => void;
}

export function Setup({ onDone }: SetupProps) {
  const [wallets, setWallets] = useState<WalletInput[]>(() => DEFAULT_WALLETS.map((w) => ({ ...w })));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const update = (index: number, patch: Partial<WalletInput>) => {
    setWallets((list) => list.map((w, i) => (i === index ? { ...w, ...patch } : w)));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const ledger = buildInitialLedger(wallets, thaiIsoDate());
      await saveInitialLedger(db, ledger);
      onDone();
    } catch (e) {
      setError(e instanceof SetupError || e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <>
      <header>
        <h1>เริ่มต้นใช้งาน</h1>
        <p className="muted">ใส่เงินที่มีอยู่ในแต่ละกระเป๋าวันนี้ ข้อมูลเก็บไว้ในเบราว์เซอร์ของคุณเท่านั้น</p>
      </header>

      <form className="glass-lite card setup" onSubmit={submit}>
        <h2>กระเป๋าเงิน</h2>
        {wallets.map((w, i) => (
          <div className="setup-row" key={i}>
            <div className="field">
              <label htmlFor={`name-${i}`}>ชื่อกระเป๋า</label>
              <input
                id={`name-${i}`}
                type="text"
                value={w.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`open-${i}`}>เงินที่มีวันนี้ (บาท)</label>
              <input
                id={`open-${i}`}
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={w.opening}
                onChange={(e) => update(i, { opening: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`ลบกระเป๋า ${w.name || i + 1}`}
              onClick={() => setWallets((list) => list.filter((_, j) => j !== i))}
              disabled={wallets.length === 1}
            >
              ลบ
            </button>
          </div>
        ))}

        <div className="setup-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setWallets((list) => [...list, { name: '', opening: '' }])}
          >
            เพิ่มกระเป๋า
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            เริ่มใช้งาน
          </button>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </form>
    </>
  );
}
