import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { MAX_MEMO_LENGTH } from '../domain/ledger/limits';
import { hideMemo, loadHiddenMemos, saveHiddenMemos, suggestMemos, type MemoIndex } from '../app/memoSuggest';
import type { FormKind } from '../app/entryForm';

interface Props {
  value: string;
  onChange: (value: string) => void;
  kind: FormKind;
  /** ดัชนีบันทึกช่วยจำของผู้ใช้คนนี้ (คำนวณในเครื่องจากรายการที่โหลดแล้ว) */
  index: MemoIndex;
  /** ชื่อผู้ใช้ (แยกที่เก็บรายการที่ลบในเครื่อง) */
  user: string;
  /** เลือกคำแนะนำที่เคยใช้กับหมวดเดียวกันทุกครั้ง: ให้ฟอร์มตั้งหมวดให้ (ผู้ใช้เปลี่ยนเองได้ · ไม่เติมจำนวนเงิน) */
  onPickCounter: (counterId: string) => void;
}

/**
 * ช่อง "บันทึกช่วยจำ" แบบเดาคำ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569) · combobox ตามมาตรฐาน ARIA
 * ลูกศรขึ้นลงเลือก · Enter ยืนยัน (ไม่มีรายการที่เลือกอยู่ Enter = บันทึกฟอร์มตามปกติ) · Esc ปิดรายการ (ไม่ปิดกล่องโต้ตอบ) · Delete ลบคำแนะนำที่เลือกอยู่ · แตะ/คลิกเลือก · ปุ่ม ✕ ลบคำแนะนำ
 * คำนวณในเครื่องทั้งหมด ไม่ส่งข้อความไปที่ใด · มือถือรายการเด้งเหนือช่อง (แป้นพิมพ์อยู่ใต้ช่อง จึงไม่บัง)
 */
export function MemoField({ value, onChange, kind, index, user, onPickCounter }: Props) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [hidden, setHidden] = useState<Set<string>>(() => loadHiddenMemos(user));
  const [announce, setAnnounce] = useState('');

  const suggestions = useMemo(() => suggestMemos(index[kind], value, hidden), [index, kind, value, hidden]);
  const open = focused && !dismissed && suggestions.length > 0;
  const activeIndex = open && active >= 0 && active < suggestions.length ? active : -1;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const pick = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    onChange(s.text);
    if (s.counterId !== null) onPickCounter(s.counterId);
    setDismissed(true);
    setActive(-1);
    setAnnounce(`เลือก ${s.text} แล้ว${s.counterId !== null ? ' ตั้งหมวดให้ตามที่เคยใช้ เปลี่ยนได้' : ''}`);
  };

  const remove = (i: number) => {
    const s = suggestions[i];
    if (!s) return;
    const next = hideMemo(hidden, s.key);
    setHidden(next);
    saveHiddenMemos(user, next);
    setActive(-1);
    setAnnounce(`ลบคำแนะนำ ${s.text} แล้ว`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        e.preventDefault();
        setDismissed(false);
        setActive(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(activeIndex <= 0 ? suggestions.length - 1 : activeIndex - 1);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault(); // เลือกคำแนะนำ ไม่บันทึกฟอร์ม
      pick(activeIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault(); // ปิดแค่รายการ ไม่ปิดกล่องโต้ตอบ
      e.stopPropagation();
      setDismissed(true);
      setActive(-1);
    } else if (e.key === 'Delete' && activeIndex >= 0) {
      e.preventDefault();
      remove(activeIndex);
    }
  };

  return (
    <div className="field memo-field">
      <label htmlFor="entry-memo">บันทึกช่วยจำ (ไม่ใส่ก็ได้)</label>
      <div className="memo-input-wrap">
        <input
          id="entry-memo"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={hintId}
          autoComplete="off"
          maxLength={MAX_MEMO_LENGTH}
          placeholder="เช่น กาแฟหน้าออฟฟิศ"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setDismissed(false);
            setActive(-1);
          }}
          onFocus={(e) => {
            setFocused(true);
            // มือถือ: ให้ช่องอยู่เหนือแถบปุ่มค้างด้านล่าง (ไม่ให้แป้นพิมพ์/แถบปุ่มบังช่องและรายการ)
            e.currentTarget.scrollIntoView({ block: 'nearest' });
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul id={listId} role="listbox" aria-label="คำแนะนำจากข้อความที่เคยบันทึก" className="memo-suggest">
            {suggestions.map((s, i) => (
              <li key={s.key} id={optionId(i)} role="option" aria-selected={i === activeIndex} className={i === activeIndex ? 'memo-option memo-option-active' : 'memo-option'}>
                {/* mousedown ห้ามดึงโฟกัสออกจากช่อง (ไม่งั้นรายการปิดก่อนคลิกถูกนับ) */}
                <span className="memo-option-text" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}>
                  {s.text}
                </span>
                <button type="button" tabIndex={-1} className="memo-option-remove" aria-label={`ไม่ต้องแนะนำ ${s.text} อีก`} title="ไม่ต้องแนะนำข้อความนี้อีก" onMouseDown={(e) => e.preventDefault()} onClick={() => remove(i)}>
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p id={hintId} className="sr-only">
        พิมพ์แล้วจะมีคำแนะนำจากข้อความที่เคยบันทึก ใช้ลูกศรขึ้นลงเลือก กด Enter เพื่อใช้ข้อความนั้น กด Delete เพื่อลบคำแนะนำที่เลือกอยู่ กด Esc เพื่อปิดรายการ
      </p>
      <p className="sr-only" role="status">
        {open ? `มีคำแนะนำ ${suggestions.length} รายการ` : announce}
      </p>
    </div>
  );
}
