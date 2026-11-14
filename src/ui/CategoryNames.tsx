import { useEffect, useState, type FormEvent } from 'react';
import { friendlyError } from '../app/errorText';
import { newId } from '../app/ids';
import { checkCategoryHide, hiddenCategories, isCategory, visibleCategories } from '../domain/ledger/accountName';
import { MAX_NAME_LENGTH } from '../domain/ledger/limits';
import type { Account } from '../domain/ledger/types';
import { useRepository } from './RepositoryContext';

type Note = { text: string; error: boolean };
type CatType = 'income' | 'expense';

const TITLES: Record<CatType, string> = { income: 'หมวดรายรับ', expense: 'หมวดรายจ่าย' };

/**
 * จัดการหมวดรายรับ/รายจ่าย: เปลี่ยนชื่อ (เจ้าของสั่ง 13 พ.ย. 2569) · เพิ่มหมวดใหม่ · ซ่อน/เปิดกลับ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569)
 * เปลี่ยนได้เฉพาะ "ชื่อที่แสดง" รหัสบัญชี ยอด และรายการไม่เปลี่ยน · ซ่อน = ไม่แสดงในฟอร์มบันทึกรายการ แต่ไม่ลบจริง (รายการเก่ายังอ้างถึงและแสดงชื่อเดิม) เปิดกลับได้
 * หมวดผลการลงทุนที่ระบบสร้างไม่อยู่ในรายการนี้ (ห้ามแก้/ซ่อน) · ตรวจกติกาที่ชั้นเก็บข้อมูล (renameCategory/addCategory/setCategoryHidden) ที่นี่แสดงข้อความตามผล
 */
export function CategoryNames({ onChanged }: { onChanged: () => void }) {
  const repo = useRepository();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newNames, setNewNames] = useState<Record<CatType, string>>({ income: '', expense: '' });
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    repo
      .loadLedger()
      .then(({ accounts: all }) => {
        if (cancelled) return;
        setAccounts(all);
        setDrafts(Object.fromEntries(all.filter(isCategory).map((a) => [a.id, a.name])));
      })
      .catch((e) => !cancelled && setLoadError(friendlyError(e, 'โหลดรายชื่อหมวดไม่สำเร็จ ลองโหลดหน้านี้ใหม่')));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const setNote = (key: string, text: string, error: boolean) => setNotes((n) => ({ ...n, [key]: { text, error } }));
  const replace = (updated: Account) => setAccounts((list) => (list ?? []).map((a) => (a.id === updated.id ? updated : a)));

  const save = async (event: FormEvent, cat: Account) => {
    event.preventDefault();
    if (busyId) return;
    setBusyId(cat.id);
    setNote(cat.id, '', false);
    try {
      const updated = await repo.renameCategory(cat.id, drafts[cat.id] ?? '');
      replace(updated);
      setDrafts((d) => ({ ...d, [cat.id]: updated.name }));
      setNote(cat.id, '✓ เปลี่ยนชื่อแล้ว', false);
      onChanged();
      // ปุ่มกลายเป็น disabled (ชื่อตรงกับของเดิม) → คืนโฟกัสคีย์บอร์ดให้ช่องกรอก ไม่ให้หลุด
      document.getElementById(`cn-${cat.id}`)?.focus();
    } catch (e) {
      setNote(cat.id, `ไม่สำเร็จ: ${friendlyError(e, 'เปลี่ยนชื่อไม่สำเร็จ ลองอีกครั้ง')}`, true);
    } finally {
      setBusyId(null);
    }
  };

  const add = async (event: FormEvent, type: CatType) => {
    event.preventDefault();
    if (busyId) return;
    setBusyId(`add-${type}`);
    setNote(`add-${type}`, '', false);
    try {
      const created = await repo.addCategory({ id: newId('cat'), type, name: newNames[type] });
      setAccounts((list) => [...(list ?? []), created]);
      setDrafts((d) => ({ ...d, [created.id]: created.name }));
      setNewNames((n) => ({ ...n, [type]: '' }));
      setNote(`add-${type}`, `✓ เพิ่มหมวด "${created.name}" แล้ว`, false);
      onChanged();
      document.getElementById(`cn-add-${type}`)?.focus();
    } catch (e) {
      setNote(`add-${type}`, `ไม่สำเร็จ: ${friendlyError(e, 'เพิ่มหมวดไม่สำเร็จ ลองอีกครั้ง')}`, true);
    } finally {
      setBusyId(null);
    }
  };

  const toggleHidden = async (cat: Account, hidden: boolean) => {
    if (busyId) return;
    setBusyId(cat.id);
    setNote(cat.id, '', false);
    try {
      const updated = await repo.setCategoryHidden(cat.id, hidden);
      replace(updated);
      onChanged();
      // ปุ่มที่กดหายไปจากรายการ → คืนโฟกัสให้จุดที่ยังอยู่ (ช่องเพิ่มหมวดของประเภทนั้น / หัวข้อหมวดที่ซ่อน)
      // โฟกัสไปที่หัวข้อกลุ่ม (ไม่ใช่ช่องกรอก: บนมือถือแป้นพิมพ์จะเด้งและหน้าเลื่อนไปเอง) · ข้อความผลอยู่ในกลุ่มที่ผู้ใช้กดอยู่ (ซ่อน = กลุ่มประเภทนั้น · เปิดกลับ = กลุ่มหมวดที่ซ่อนอยู่)
      document.getElementById(hidden ? `cn-group-${cat.type}` : 'cn-hidden-title')?.focus();
      if (hidden) setNote(`status-${cat.type}`, `✓ ซ่อนหมวด "${cat.name}" แล้ว (เปิดกลับได้ที่ "หมวดที่ซ่อนอยู่")`, false);
      else setNote('status-hidden', `✓ เปิดหมวด "${cat.name}" กลับแล้ว`, false);
    } catch (e) {
      setNote(cat.id, `ไม่สำเร็จ: ${friendlyError(e, hidden ? 'ซ่อนหมวดไม่สำเร็จ ลองอีกครั้ง' : 'เปิดหมวดกลับไม่สำเร็จ ลองอีกครั้ง')}`, true);
      setNote(`status-${cat.type}`, '', false);
      setNote('status-hidden', '', false);
    } finally {
      setBusyId(null);
    }
  };

  const all = accounts ?? [];
  const group = (type: CatType) => {
    const title = TITLES[type];
    const list = visibleCategories(all, type);
    const status = notes[`status-${type}`];
    const addNote = notes[`add-${type}`];
    return (
      <div className="category-name-group" role="group" aria-labelledby={`cn-group-${type}`}>
        <h3 id={`cn-group-${type}`} tabIndex={-1}>
          {title}
        </h3>
        <p role="status" className="auth-ok">
          {status?.text ?? ''}
        </p>
        <ul className="wallet-name-list">
          {list.map((c) => {
            const draft = drafts[c.id] ?? c.name;
            const note = notes[c.id];
            const changed = draft.trim() !== c.name;
            const hideCheck = checkCategoryHide(all, c.id, true);
            return (
              <li key={c.id}>
                <form className="wallet-name-row category-row" onSubmit={(e) => void save(e, c)}>
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    aria-label={`ซ่อน${title} ${c.name}`}
                    aria-describedby={hideCheck.ok ? undefined : `cn-hide-why-${type}`}
                    disabled={!hideCheck.ok || busyId !== null}
                    onClick={() => void toggleHidden(c, true)}
                  >
                    ซ่อน
                  </button>
                  <p id={`cn-note-${c.id}`} role={note?.error ? 'alert' : 'status'} className={note?.error ? 'form-error' : 'auth-ok'}>
                    {note?.text ?? ''}
                  </p>
                </form>
              </li>
            );
          })}
        </ul>
        {list.length === 1 && (
          <p id={`cn-hide-why-${type}`} className="muted small">
            ต้องเหลือไว้อย่างน้อย 1 หมวด จึงซ่อนไม่ได้ (อยากซ่อนอันนี้ ให้เพิ่มหมวดใหม่ก่อน)
          </p>
        )}
        <form className="wallet-name-row category-row category-add" onSubmit={(e) => void add(e, type)}>
          <div className="field">
            <label htmlFor={`cn-add-${type}`}>เพิ่ม{title}ใหม่</label>
            <input
              id={`cn-add-${type}`}
              type="text"
              maxLength={MAX_NAME_LENGTH}
              autoComplete="off"
              placeholder={type === 'expense' ? 'เช่น ค่ากาแฟ' : 'เช่น ขายของออนไลน์'}
              value={newNames[type]}
              aria-invalid={addNote?.error ? true : undefined}
              aria-describedby={addNote ? `cn-note-add-${type}` : undefined}
              onChange={(e) => setNewNames((n) => ({ ...n, [type]: e.target.value }))}
            />
          </div>
          <button type="submit" className="btn btn-ghost" disabled={newNames[type].trim() === '' || busyId !== null}>
            {busyId === `add-${type}` ? 'กำลังเพิ่ม…' : 'เพิ่มหมวด'}
          </button>
          <p id={`cn-note-add-${type}`} role={addNote?.error ? 'alert' : 'status'} className={addNote?.error ? 'form-error' : 'auth-ok'}>
            {addNote?.text ?? ''}
          </p>
        </form>
      </div>
    );
  };

  const hidden = hiddenCategories(all);
  const total = all.filter(isCategory).length;

  return (
    <section className="solid card wallet-names" aria-labelledby="category-names-title">
      <h2 id="category-names-title">ชื่อหมวดรายรับ-รายจ่าย</h2>
      <p className="muted small">เปลี่ยนได้เฉพาะชื่อที่แสดง ยอดเงินและรายการเดิมไม่เปลี่ยน ชื่อต้องไม่ซ้ำกับหมวดประเภทเดียวกัน ยาวได้ไม่เกิน {MAX_NAME_LENGTH} ตัวอักษร</p>
      <p className="muted small">เพิ่มหมวดใหม่หรือซ่อนหมวดที่ไม่ใช้ได้ · หมวดที่ซ่อนไม่ถูกลบ รายการเก่ายังเห็นชื่อหมวดเดิม และเปิดกลับได้ตลอด</p>
      {loadError && (
        <p role="alert" className="form-error">
          {loadError}
        </p>
      )}
      {accounts === null && !loadError && <p className="muted">กำลังโหลด…</p>}
      {accounts !== null && total === 0 && <p className="muted">ยังไม่มีหมวด</p>}
      {accounts !== null && total > 0 && (
        <details className="archived-details">
          <summary>แสดงรายการหมวด ({total - hidden.length} หมวดที่ใช้งาน{hidden.length > 0 ? ` · ซ่อนอยู่ ${hidden.length}` : ''})</summary>
          {group('income')}
          {group('expense')}
          <div className="category-name-group" role="group" aria-labelledby="cn-hidden-title">
            <h3 id="cn-hidden-title" tabIndex={-1}>
              หมวดที่ซ่อนอยู่
            </h3>
            <p id="cn-hidden-summary" className="muted small">
              {hidden.length === 0 ? 'ยังไม่มีหมวดที่ซ่อน' : `${hidden.length} หมวด · ไม่แสดงในฟอร์มบันทึกรายการ แต่รายการเก่ายังเห็นชื่อหมวดเดิม`}
            </p>
            <p role="status" className="auth-ok">
              {notes['status-hidden']?.text ?? ''}
            </p>
            <ul className="wallet-name-list">
              {hidden.map((c) => {
                const note = notes[c.id];
                return (
                  <li key={c.id} className="category-hidden-row">
                    <div className="wallet-name-row category-row">
                      <span className="category-hidden-name">
                        {c.name} <span className="muted small">({c.type === 'income' ? 'รายรับ' : 'รายจ่าย'})</span>
                      </span>
                      <button type="button" className="btn btn-ghost" aria-label={`เปิดหมวด ${c.name} กลับมาใช้`} disabled={busyId !== null} onClick={() => void toggleHidden(c, false)}>
                        เปิดกลับ
                      </button>
                      <p role={note?.error ? 'alert' : 'status'} className={note?.error ? 'form-error' : 'auth-ok'}>
                        {note?.text ?? ''}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
