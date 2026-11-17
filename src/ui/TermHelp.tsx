import { useId, useState, type KeyboardEvent } from 'react';
import type { GlossaryTerm } from '../domain/invest/glossary';

/**
 * คำอธิบายศัพท์ภาษาอังกฤษสำหรับโหมด /invest (คีย์ยังเป็นคำไทยตาม GLOSSARY ของ domain เพื่อไม่แตะ domain) · ไม่เกี่ยวกับการคำนวณเงิน
 * เป็นหลักการทั่วไป ไม่ใช่คำแนะนำด้านภาษี
 */
export const TERM_EN: Record<GlossaryTerm, { name: string; text: string }> = {
  'ปันผลเป็นเงินสด': {
    name: 'Cash dividend',
    text: 'The fund or company shares profit with you as cash. The money goes into your wallet (after tax, if any) and the number of units you hold does not change.',
  },
  'ปันผลลงทุนต่อ': {
    name: 'Reinvested dividend',
    text: 'The payer uses your dividend to buy more units for you. You do not receive cash, but the number of units you hold goes up.',
  },
  'ภาษีหัก ณ ที่จ่าย': {
    name: 'Withholding tax',
    text: 'Tax the payer deducts before sending your dividend, so you receive that much less than the gross dividend. Keep the record in case you need it when filing taxes.',
  },
};

/**
 * ปุ่ม "Meaning" ข้างศัพท์: แตะ/กดแล้วเห็นคำอธิบายสั้นใต้ปุ่ม (รูปแบบ disclosure: aria-expanded + aria-controls) ใช้ได้บนมือถือและคีย์บอร์ด
 * ไม่ใช้ hover/title อย่างเดียว · Esc ปิดได้ · ไม่มีคำอธิบายของศัพท์นั้น = ไม่แสดงอะไร
 */
export function TermHelp({ term }: { term: GlossaryTerm }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const entry = TERM_EN[term] as { name: string; text: string } | undefined;
  if (entry === undefined) return null;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation(); // ไม่ให้ Esc ปิดฟอร์มทั้งใบ
      setOpen(false);
    }
  };
  return (
    <span className="term-help" onKeyDown={onKeyDown}>
      <button type="button" className="term-help-btn" aria-expanded={open} aria-controls={id} aria-label={`Meaning of ${entry.name}`} onClick={() => setOpen((v) => !v)}>
        Meaning
      </button>
      <span id={id} className="term-help-text muted small" hidden={!open}>
        {entry.text}
      </span>
    </span>
  );
}
