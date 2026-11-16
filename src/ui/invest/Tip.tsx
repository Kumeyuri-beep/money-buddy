import { useId, useState, type FocusEvent, type ReactNode } from 'react';

/**
 * ข้อความช่วยเหลือแบบ tooltip ของโหมด /invest (ภาษาอังกฤษ) · ใช้ aria-disabled แทน disabled เพื่อให้โฟกัสด้วยคีย์บอร์ดและอ่านคำอธิบายได้
 * ขึ้นเมื่อชี้หรือโฟกัส · ชี้เข้าไปที่ข้อความได้ (hoverable) · กด Esc ปิด (WCAG 1.4.13)
 */
function useTip() {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return {
    id,
    dismissed,
    reset: () => setDismissed(false),
    /** โฟกัสย้ายภายในกลุ่มเดียวกันไม่ถือว่าออก (กด Esc แล้วกด Tab ในกลุ่ม ข้อความไม่เด้งกลับ) */
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDismissed(false);
    },
    onKeyDown: (e: { key: string }) => {
      if (e.key === 'Escape') setDismissed(true);
    },
  };
}

/** ปุ่มที่ยังใช้ไม่ได้ (Coming soon / รอข้อมูลอัตโนมัติ) พร้อมคำอธิบาย */
export function TipButton({ tip, className, ariaLabel, children }: { tip: string; className?: string; ariaLabel?: string; children: ReactNode }) {
  const t = useTip();
  return (
    <span className={`iv-tipwrap${t.dismissed ? ' is-dismissed' : ''}`} onMouseLeave={t.reset} onBlur={t.onBlur}>
      <button type="button" className={className} aria-disabled="true" aria-label={ariaLabel} aria-describedby={t.id} onKeyDown={t.onKeyDown} onClick={(e) => e.preventDefault()}>
        {children}
      </button>
      <span role="tooltip" id={t.id} className="iv-tip">
        {tip}
      </span>
    </span>
  );
}

/** ไอคอน ⓘ ที่ขึ้นคำอธิบายเมื่อชี้หรือโฟกัส */
export function InfoTip({ label, tip }: { label: string; tip: string }) {
  const t = useTip();
  return (
    <span className={`iv-tipwrap${t.dismissed ? ' is-dismissed' : ''}`} onMouseLeave={t.reset} onBlur={t.onBlur}>
      <button type="button" className="iv-info" aria-label={label} aria-describedby={t.id} onKeyDown={t.onKeyDown}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.2v4M8 4.8v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      <span role="tooltip" id={t.id} className="iv-tip">
        {tip}
      </span>
    </span>
  );
}

/** ปุ่มที่ใช้งานได้จริงแต่มีคำอธิบายขึ้นเฉพาะตอนชี้/โฟกัส (เช่น ปุ่มสลับการเรียง) */
export function TipAction({ tip, className, ariaLabel, onClick, children }: { tip: string; className?: string; ariaLabel: string; onClick: () => void; children: ReactNode }) {
  const t = useTip();
  return (
    <span className={`iv-tipwrap${t.dismissed ? ' is-dismissed' : ''}`} onMouseLeave={t.reset} onBlur={t.onBlur}>
      <button type="button" className={className} aria-label={ariaLabel} aria-describedby={t.id} onKeyDown={t.onKeyDown} onClick={onClick}>
        {children}
      </button>
      <span role="tooltip" id={t.id} className="iv-tip iv-tip-right">
        {tip}
      </span>
    </span>
  );
}
