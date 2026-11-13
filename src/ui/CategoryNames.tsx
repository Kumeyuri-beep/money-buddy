import { useEffect, useState, type FormEvent } from 'react';
import { friendlyError } from '../app/errorText';
import { isCategory } from '../domain/ledger/accountName';
import { MAX_NAME_LENGTH } from '../domain/ledger/limits';
import type { Account } from '../domain/ledger/types';
import { useRepository } from './RepositoryContext';

type Note = { text: string; error: boolean };

/**
 * เปลี่ยนชื่อหมวดรายรับ/รายจ่าย (เจ้าของสั่ง 13 พ.ย. 2569 แบบเดียวกับชื่อกระเป๋า): เปลี่ยนได้เฉพาะ "ชื่อที่แสดง"
 * รหัสบัญชี ยอด และรายการไม่เปลี่ยน · ไม่เปลี่ยนชื่อให้ผู้ใช้เอง · ตรวจกติกาชื่อที่ชั้นเก็บข้อมูล (renameCategory) ที่นี่แสดงข้อความตามผล
 */
export function CategoryNames({ onChanged }: { onChanged: () => void }) {
  const repo = useRepository();
  const [cats, setCats] = useState<Account[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    repo
      .loadLedger()
      .then(({ accounts }) => {
        if (cancelled) return;
        const list = accounts.filter((a) => isCategory(a) && !a.archived);
        setCats(list);
        setDrafts(Object.fromEntries(list.map((a) => [a.id, a.name])));
      })
      .catch((e) => !cancelled && setLoadError(friendlyError(e, 'โหลดรายชื่อหมวดไม่สำเร็จ ลองโหลดหน้านี้ใหม่')));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const save = async (event: FormEvent, cat: Account) => {
    event.preventDefault();
    if (busyId) return;
    setBusyId(cat.id);
    setNotes((n) => ({ ...n, [cat.id]: { text: '', error: false } }));
    try {
      const updated = await repo.renameCategory(cat.id, drafts[cat.id] ?? '');
      setCats((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));
      setDrafts((d) => ({ ...d, [cat.id]: updated.name }));
      setNotes((n) => ({ ...n, [cat.id]: { text: '✓ เปลี่ยนชื่อแล้ว', error: false } }));
      onChanged();
      // ปุ่มกลายเป็น disabled (ชื่อตรงกับของเดิม) → คืนโฟกัสคีย์บอร์ดให้ช่องกรอก ไม่ให้หลุด
      document.getElementById(`cn-${cat.id}`)?.focus();
    } catch (e) {
      setNotes((n) => ({ ...n, [cat.id]: { text: `ไม่สำเร็จ: ${friendlyError(e, 'เปลี่ยนชื่อไม่สำเร็จ ลองอีกครั้ง')}`, error: true } }));
    } finally {
      setBusyId(null);
    }
  };

  const group = (type: 'income' | 'expense', title: string) => {
    const list = (cats ?? []).filter((a) => a.type === type);
    if (list.length === 0) return null;
    return (
      <div className="category-name-group" role="group" aria-labelledby={`cn-group-${type}`}>
        <h3 id={`cn-group-${type}`}>{title}</h3>
        <ul className="wallet-name-list">
          {list.map((c) => {
            const draft = drafts[c.id] ?? c.name;
            const note = notes[c.id];
            const changed = draft.trim() !== c.name;
            return (
              <li key={c.id}>
                <form className="wallet-name-row" onSubmit={(e) => void save(e, c)}>
                  <div className="field">
                    <label htmlFor={`cn-${c.id}`} className="sr-only">
                      ชื่อ{title}: {c.name}
                    </label>
                    <input
                      id={`cn-${c.id}`}
                      type="text"
                      maxLength={MAX_NAME_LENGTH}
                      autoComplete="off"
                      value={draft}
                      aria-invalid={note?.error ? true : undefined}
                      aria-describedby={note ? `cn-note-${c.id}` : undefined}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
                    />
                  </div>
                  <button type="submit" className="btn btn-ghost" aria-label={`บันทึกชื่อ${title} ${c.name}`} disabled={!changed || busyId !== null}>
                    {busyId === c.id ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
                  </button>
                  <p id={`cn-note-${c.id}`} role={note?.error ? 'alert' : 'status'} className={note?.error ? 'form-error' : 'auth-ok'}>
                    {note?.text ?? ''}
                  </p>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  return (
    <section className="solid card wallet-names" aria-labelledby="category-names-title">
      <h2 id="category-names-title">ชื่อหมวดรายรับ-รายจ่าย</h2>
      <p className="muted small">เปลี่ยนได้เฉพาะชื่อที่แสดง ยอดเงินและรายการเดิมไม่เปลี่ยน ชื่อต้องไม่ซ้ำกับหมวดประเภทเดียวกัน ยาวได้ไม่เกิน {MAX_NAME_LENGTH} ตัวอักษร</p>
      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}
      {cats === null && !loadError && <p className="muted">กำลังโหลด…</p>}
      {cats?.length === 0 && <p className="muted">ยังไม่มีหมวด</p>}
      {cats !== null && cats.length > 0 && (
        <details className="archived-details">
          <summary>แสดงรายการหมวด ({cats.length} หมวด)</summary>
          {group('income', 'หมวดรายรับ')}
          {group('expense', 'หมวดรายจ่าย')}
        </details>
      )}
    </section>
  );
}
