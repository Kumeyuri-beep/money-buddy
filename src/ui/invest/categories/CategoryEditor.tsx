import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CATEGORY_PROBLEM_TEXT } from '../../../domain/invest/categories';
import {
  addDraftCategory, draftsToCategories, draftTotals, mergeCategories, moveCategory, percentTextToBps, removeCategory,
  type CategoryState, type DraftTotals,
} from '../../../domain/invest/categoriesView';
import { CATEGORY_NAME_MAX, MAX_CATEGORIES, type Asset } from '../../../domain/invest/types';
import { newId } from '../../../app/ids';
import { bpsText } from '../dashboard/dashboardView';

/** ตัวแก้หมวด (ปุ่ม Change): ชื่อ · เป้า % · ลำดับ · ลบ · ย้ายสินทรัพย์ · รวมหมวด · ผลรวมเป้าต้อง 100% จึง Save ได้ · ตรวจด้วย domain/invest/categoriesView */

export function totalsMessage(t: DraftTotals): string {
  switch (t.status) {
    case 'none': return 'No targets set. Targets are optional; set one for every category to compare them with your actual allocation.';
    case 'ok': return 'Targets total 100%.';
    case 'under': return `Targets total ${bpsText(t.totalBps)}. Add ${bpsText(-t.diffBps)} more to reach 100%.`;
    case 'over': return `Targets total ${bpsText(t.totalBps)}. Remove ${bpsText(t.diffBps)} to reach 100%.`;
    case 'partial': return 'Set a target for every category, or clear all targets.';
    case 'invalid': return 'Enter each target as a number from 0 to 100 with up to 2 decimals (for example 7.5).';
  }
}

interface Props {
  state: CategoryState;
  onChange: (s: CategoryState) => void;
  assets: readonly Asset[];
  busy: boolean;
  error: string;
  notice: string;
  onSave: () => void;
  /** ขอปิดตัวแก้ (ปุ่ม Cancel หรือ Esc) · หน้าหลักถามยืนยันถ้ามีการแก้ค้าง */
  onCancel: () => void;
  /** กำลังถามยืนยันทิ้งการแก้ */
  confirming: boolean;
  onKeep: () => void;
  onDiscard: () => void;
}

export function CategoryEditor({ state, onChange, assets, busy, error, notice, onSave, onCancel, confirming, onKeep, onDiscard }: Props) {
  const { drafts } = state;
  const totals = draftTotals(drafts);
  const result = draftsToCategories(drafts);
  const targetIssue = totals.status !== 'none' && totals.status !== 'ok';
  const canSave = result.ok && !busy;
  const nameProblem = !result.ok && !targetIssue ? CATEGORY_PROBLEM_TEXT[result.problem].en : '';
  const [mergeFrom, setMergeFrom] = useState('');
  const [mergeInto, setMergeInto] = useState('');
  const focusId = useRef<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // ประกาศผลรวมเป้าให้โปรแกรมอ่านหน้าจอหลังหยุดพิมพ์ ไม่ใช่ทุกตัวอักษร (ข้อความที่เห็นบนจอยังเปลี่ยนทันที)
  const message = totalsMessage(totals);
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setAnnounce(message), 800);
    return () => window.clearTimeout(t);
  }, [message]);
  const onEsc = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented || busy || e.target instanceof HTMLSelectElement) return;
    e.preventDefault();
    if (confirming) onKeep();
    else onCancel();
  };

  useEffect(() => {
    if (focusId.current !== null) {
      document.getElementById(focusId.current)?.focus();
      focusId.current = null;
    }
  });

  const add = () => {
    let n = drafts.length + 1;
    const names = new Set(drafts.map((d) => d.name.trim().toLowerCase()));
    while (names.has(`category ${n}`)) n += 1;
    const id = newId('cat');
    focusId.current = `cg-name-${id}`;
    onChange(addDraftCategory(state, id, `Category ${n}`));
  };

  const setDraft = (id: string, patch: Partial<{ name: string; targetText: string }>) => onChange({ ...state, drafts: drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)) });
  const mergeOk = mergeFrom !== '' && mergeInto !== '' && mergeFrom !== mergeInto;

  return (
    <section className="solid card cg-editor" aria-labelledby="cg-edit-title" onKeyDown={onEsc}>
      <h3 id="cg-edit-title" className="cg-card-title" tabIndex={-1}>Edit categories</h3>
      <p className="muted cg-help">Name each category and give it a target %. Targets must total exactly 100% before you can save. Changes are saved together when you press Save.</p>
      <div role="status">{notice !== '' && <p className="muted">{notice}</p>}</div>

      {drafts.length === 0 ? (
        <p className="muted">{assets.length === 0 ? 'No categories left. Press Save to keep this change, or add a category.' : 'No categories yet. Add one, or use "Create categories from sectors".'}</p>
      ) : (
        <ul className="cg-list" aria-label="Categories">
          {drafts.map((d, i) => (
            <li key={d.id} className="cg-item">
              <div className="iv-field cg-f-name">
                <label htmlFor={`cg-name-${d.id}`}>Name</label>
                <input id={`cg-name-${d.id}`} type="text" autoComplete="off" maxLength={CATEGORY_NAME_MAX + 20} value={d.name} onChange={(e) => setDraft(d.id, { name: e.target.value })} />
              </div>
              <div className="iv-field cg-f-target">
                <label htmlFor={`cg-target-${d.id}`}>Target %</label>
                <input
                  id={`cg-target-${d.id}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 7.5"
                  value={d.targetText}
                  aria-invalid={percentTextToBps(d.targetText).kind === 'invalid' ? true : undefined}
                  aria-describedby={percentTextToBps(d.targetText).kind === 'invalid' ? `cg-terr-${d.id}` : undefined}
                  onChange={(e) => setDraft(d.id, { targetText: e.target.value })}
                />
                {percentTextToBps(d.targetText).kind === 'invalid' && (
                  <span id={`cg-terr-${d.id}`} className="form-error cg-terr">
                    Use a number from 0 to 100 with up to 2 decimals.
                  </span>
                )}
              </div>
              <div className="cg-tools">
                <button
                  id={`cg-up-${d.id}`}
                  type="button"
                  className="iv-btn"
                  aria-disabled={i === 0 ? true : undefined}
                  aria-label={`Move ${d.name} up`}
                  onClick={() => {
                    if (i === 0) return;
                    focusId.current = `cg-up-${d.id}`;
                    onChange(moveCategory(state, d.id, -1));
                  }}
                >
                  <span aria-hidden="true">↑</span>
                </button>
                <button
                  id={`cg-down-${d.id}`}
                  type="button"
                  className="iv-btn"
                  aria-disabled={i === drafts.length - 1 ? true : undefined}
                  aria-label={`Move ${d.name} down`}
                  onClick={() => {
                    if (i === drafts.length - 1) return;
                    focusId.current = `cg-down-${d.id}`;
                    onChange(moveCategory(state, d.id, 1));
                  }}
                >
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  type="button"
                  className="iv-btn iv-btn-danger"
                  aria-label={`Delete ${d.name}`}
                  onClick={() => {
                    focusId.current = 'cg-add';
                    if (mergeFrom === d.id) setMergeFrom('');
                    if (mergeInto === d.id) setMergeInto('');
                    onChange(removeCategory(state, d.id));
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="cg-add-row">
        <button id="cg-add" ref={addRef} type="button" className="iv-btn" disabled={drafts.length >= MAX_CATEGORIES} onClick={add}>
          Add category
        </button>
        {drafts.length >= MAX_CATEGORIES && <span className="muted small">Up to {MAX_CATEGORIES} categories.</span>}
      </div>

      <p className={`cg-total is-${totals.status}`} id="cg-total">
        {drafts.length === 0 ? '' : message}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>
      {nameProblem !== '' && (
        <p className="form-error" role="alert">
          {nameProblem}
        </p>
      )}

      {drafts.length >= 2 && (
        <fieldset className="cg-merge">
          <legend>Merge categories</legend>
          <div className="iv-field">
            <label htmlFor="cg-merge-from">Move everything from</label>
            <select id="cg-merge-from" value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)}>
              <option value="">Choose a category</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="iv-field">
            <label htmlFor="cg-merge-into">into</label>
            <select id="cg-merge-into" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">Choose a category</option>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="iv-btn"
            disabled={!mergeOk}
            onClick={() => {
              onChange(mergeCategories(state, mergeFrom, mergeInto));
              setMergeFrom('');
              setMergeInto('');
              focusId.current = `cg-name-${mergeInto}`;
            }}
          >
            Merge
          </button>
          <p className="muted small cg-merge-note">The first category is removed and its targets are added to the second. Check the total before saving.</p>
        </fieldset>
      )}

      {assets.length > 0 && (
        <div className="cg-assign">
          <h4 className="cg-sub-title">Assign stocks</h4>
          <ul className="cg-list" aria-label="Stocks and their categories">
            {assets.map((a) => {
              const label = a.ticker && a.ticker !== '' ? a.ticker : a.name;
              return (
                <li key={a.id} className="cg-item cg-item-asset">
                  <div className="cg-asset">
                    <span className="cg-name">{label}</span>
                    <span className="cg-sub">{a.sector && a.sector !== '' ? `Sector: ${a.sector}` : a.ticker ? a.name : 'No sector'}</span>
                  </div>
                  <div className="iv-field cg-f-cat">
                    <label htmlFor={`cg-as-${a.id}`}>
                      <span className="sr-only">Category of </span>
                      {label}
                    </label>
                    <select
                      id={`cg-as-${a.id}`}
                      value={state.assign[a.id] ?? ''}
                      onChange={(e) => {
                        const assign = { ...state.assign };
                        if (e.target.value === '') delete assign[a.id];
                        else assign[a.id] = e.target.value;
                        onChange({ ...state, assign });
                      }}
                    >
                      <option value="">Uncategorized</option>
                      {drafts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div role="alert">{error !== '' && <p className="form-error">{error}</p>}</div>
      {confirming && (
        <div className="cg-confirm" role="alertdialog" aria-labelledby="cg-confirm-title" aria-describedby="cg-confirm-desc">
          <p id="cg-confirm-title" className="cg-confirm-title">Discard your changes?</p>
          <p id="cg-confirm-desc" className="muted">You have unsaved changes to your categories. They will be lost.</p>
          <div className="cg-actions">
            <button type="button" className="iv-btn" autoFocus onClick={onKeep}>
              Keep editing
            </button>
            <button type="button" className="iv-btn iv-btn-danger" onClick={onDiscard}>
              Discard changes
            </button>
          </div>
        </div>
      )}
      <div className="cg-actions">
        <button type="button" className="iv-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="iv-btn iv-btn-gold" disabled={!canSave} aria-describedby="cg-total" onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
