import { useEffect, useState, type FormEvent } from 'react';
import { friendlyError } from '../app/errorText';
import { isWallet } from '../domain/ledger/accountName';
import { MAX_NAME_LENGTH } from '../domain/ledger/limits';
import type { Account } from '../domain/ledger/types';
import { useRepository } from './RepositoryContext';

/**
 * เปลี่ยนชื่อกระเป๋าเงิน (เจ้าของตัดสิน 13 พ.ย. 2569): เปลี่ยนได้เฉพาะ "ชื่อที่แสดง" · รหัสบัญชีและยอดไม่เปลี่ยน · ไม่เปลี่ยนชื่อให้ผู้ใช้เองเด็ดขาด
 * ตรวจกติกาชื่อที่ชั้นเก็บข้อมูล (renameWallet) ที่นี่แสดงข้อความตามผล
 */
export function WalletNames({ onChanged }: { onChanged: () => void }) {
  const repo = useRepository();
  const [wallets, setWallets] = useState<Account[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, { text: string; error: boolean }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    repo
      .loadLedger()
      .then(({ accounts }) => {
        if (cancelled) return;
        const list = accounts.filter((a) => isWallet(a) && !a.archived);
        setWallets(list);
        setDrafts(Object.fromEntries(list.map((a) => [a.id, a.name])));
      })
      .catch((e) => !cancelled && setLoadError(friendlyError(e, 'โหลดรายชื่อกระเป๋าไม่สำเร็จ ลองโหลดหน้านี้ใหม่')));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const save = async (event: FormEvent, wallet: Account) => {
    event.preventDefault();
    if (busyId) return;
    setBusyId(wallet.id);
    setNotes((n) => ({ ...n, [wallet.id]: { text: '', error: false } }));
    try {
      const updated = await repo.renameWallet(wallet.id, drafts[wallet.id] ?? '');
      setWallets((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));
      setDrafts((d) => ({ ...d, [wallet.id]: updated.name }));
      setNotes((n) => ({ ...n, [wallet.id]: { text: 'เปลี่ยนชื่อแล้ว', error: false } }));
      onChanged();
    } catch (e) {
      setNotes((n) => ({ ...n, [wallet.id]: { text: friendlyError(e, 'เปลี่ยนชื่อไม่สำเร็จ ลองอีกครั้ง'), error: true } }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="solid card wallet-names" aria-labelledby="wallet-names-title">
      <h2 id="wallet-names-title">ชื่อกระเป๋าเงิน</h2>
      <p className="muted small">เปลี่ยนได้เฉพาะชื่อที่แสดง ยอดเงินและรายการเดิมไม่เปลี่ยน ชื่อต้องไม่ซ้ำกัน</p>
      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}
      {wallets === null && !loadError && <p className="muted">กำลังโหลด…</p>}
      {wallets?.length === 0 && <p className="muted">ยังไม่มีกระเป๋าเงิน</p>}
      <ul className="wallet-name-list">
        {(wallets ?? []).map((w, i) => {
          const draft = drafts[w.id] ?? w.name;
          const note = notes[w.id];
          const changed = draft.trim() !== w.name;
          return (
            <li key={w.id}>
              <form className="wallet-name-row" onSubmit={(e) => void save(e, w)}>
                <div className="field">
                  <label htmlFor={`wn-${w.id}`}>ชื่อกระเป๋าที่ {i + 1}</label>
                  <input
                    id={`wn-${w.id}`}
                    type="text"
                    maxLength={MAX_NAME_LENGTH}
                    autoComplete="off"
                    value={draft}
                    aria-invalid={note?.error ? true : undefined}
                    aria-describedby={note ? `wn-note-${w.id}` : undefined}
                    onChange={(e) => setDrafts((d) => ({ ...d, [w.id]: e.target.value }))}
                  />
                </div>
                <button type="submit" className="btn btn-ghost" disabled={!changed || busyId !== null}>
                  {busyId === w.id ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
                </button>
                <p id={`wn-note-${w.id}`} role={note?.error ? 'alert' : 'status'} className={note?.error ? 'form-error' : 'auth-ok'}>
                  {note?.text ?? ''}
                </p>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
