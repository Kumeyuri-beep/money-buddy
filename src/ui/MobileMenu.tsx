import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';

export interface MobileMenuItem<Id extends string> {
  id: Id;
  label: string;
  /** path ของไอคอนเส้น 24x24 */
  icon: string;
}

interface Props<Id extends string> {
  items: readonly MobileMenuItem<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
}

const MENU_ICON = 'M4 7h16M4 12h16M4 17h16'; // ขีดสามเส้น: สัญลักษณ์เมนูที่คนรู้จักมากที่สุด
const CLOSE_ICON = 'M6 6l12 12M18 6L6 18';
/** กว้างกว่านี้ใช้เมนูข้างเดิม (ต้องตรงกับ @media ใน styles.css) */
const MOBILE_MAX = 720;
/** ปัดลงเกินระยะนี้ (px) = ปิด */
const SWIPE_CLOSE_PX = 80;
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function Icon({ path }: { path: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * เมนูมือถือแบบ pop up: ปุ่มลอยกลมมุมขวาล่าง → bottom sheet ตาราง 3 คอลัมน์ (7 เมนู = 3 แถว แถวสุดท้ายมี 1 ช่อง)
 * ปิดได้ด้วยแตะนอกกรอบ ปุ่มปิด ปัดลง Esc และปิดเองเมื่อเลือกเมนู · โฟกัสวนอยู่ใน sheet ตอนเปิด แล้วคืนให้ปุ่มลอยตอนปิด
 * วาดผ่าน portal ที่ body (ไม่ติดอยู่ใน .page ที่มี overflow: hidden · กันปัญหา position: fixed บน Safari) · จอกว้างไม่แสดง (CSS)
 */
export function MobileMenu<Id extends string>({ items, current, onSelect }: Props<Id>) {
  const [open, setOpen] = useState(false);
  const [dragY, setDragY] = useState(0);
  const fabRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    setDragY(0);
    touchStart.current = null;
    if (restoreFocus) window.setTimeout(() => fabRef.current?.focus(), 0);
  }, []);

  // เปิด: ล็อกการเลื่อนหน้าหลัง, ย้ายโฟกัสเข้า sheet (หน้าปัจจุบันก่อน), ปิดเมื่อกด Esc ที่ใดก็ได้หรือหน้าจอกว้างขึ้น
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const active = sheetRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    (active ?? sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onResize = () => {
      if (window.innerWidth > MOBILE_MAX) close(false);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // โฟกัสวนอยู่ใน sheet (Tab / Shift+Tab)
  const trapTab = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (nodes.length === 0) return;
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || !sheetRef.current?.contains(activeEl))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (activeEl === last || !sheetRef.current?.contains(activeEl))) {
      e.preventDefault();
      first.focus();
    }
  };

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    // ลากปิดได้เฉพาะเมื่อเนื้อหา sheet อยู่บนสุด (ไม่ขัดกับการเลื่อนบนจอเตี้ย/แนวนอน)
    touchStart.current = (sheetRef.current?.scrollTop ?? 0) > 0 ? null : (e.touches[0]?.clientY ?? null);
  };
  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStart.current === null) return;
    const dy = (e.touches[0]?.clientY ?? touchStart.current) - touchStart.current;
    setDragY(dy > 0 ? dy : 0);
  };
  const onTouchEnd = () => {
    if (dragY > SWIPE_CLOSE_PX) close();
    else setDragY(0);
    touchStart.current = null;
  };

  return (
    <>
      <button
        ref={fabRef}
        type="button"
        className="fab"
        aria-label="เมนู"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'mobile-menu-sheet' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon path={MENU_ICON} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="sheet-backdrop" onClick={() => close()} aria-hidden="true" />
            <div
              id="mobile-menu-sheet"
              ref={sheetRef}
              className="sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-menu-title"
              style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
              onKeyDown={trapTab}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <div className="sheet-handle" aria-hidden="true" />
              <div className="sheet-head">
                <h2 id="mobile-menu-title">เมนู</h2>
                <button type="button" className="sheet-close" aria-label="ปิดเมนู" onClick={() => close()}>
                  <Icon path={CLOSE_ICON} />
                </button>
              </div>
              <nav aria-label="เมนูหลัก">
                <ul className="sheet-grid">
                  {items.map(({ id, label, icon }) => {
                    const active = id === current;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={active ? 'sheet-item sheet-item-active' : 'sheet-item'}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => {
                            onSelect(id);
                            close();
                          }}
                        >
                          <Icon path={icon} />
                          <span>{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
