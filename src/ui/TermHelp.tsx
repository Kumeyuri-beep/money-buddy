import { useId, useState, type KeyboardEvent } from 'react';
import { glossaryText, type GlossaryTerm } from '../domain/invest/glossary';

/**
 * ปุ่ม "ความหมาย" ข้างศัพท์: แตะ/กดแล้วเห็นคำอธิบายสั้นใต้ปุ่ม (รูปแบบ disclosure: aria-expanded + aria-controls) ใช้ได้บนมือถือและคีย์บอร์ด
 * ไม่ใช้ hover/title อย่างเดียว · Esc ปิดได้ · ไม่มีคำอธิบายของศัพท์นั้น = ไม่แสดงอะไร
 */
export function TermHelp({ term }: { term: GlossaryTerm }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = glossaryText(term);
  if (text === null) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation(); // ไม่ให้ Esc ปิดฟอร์มทั้งใบ
      setOpen(false);
    }
  };
  return (
    <span className="term-help" onKeyDown={onKeyDown}>
      <button type="button" className="term-help-btn" aria-expanded={open} aria-controls={id} aria-label={`ความหมายของคำว่า ${term}`} onClick={() => setOpen((v) => !v)}>
        ความหมาย
      </button>
      <span id={id} className="term-help-text muted small" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
