import { createPortal } from 'react-dom';
import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { layoutOffsets, magnifyScale } from './dockMagnify';

export interface DockItem<Id extends string> {
  id: Id;
  label: string;
  /** path ของไอคอนเส้น 24x24 (ชุดเดียวกับแถบข้าง) */
  icon: string;
}

interface Props<Id extends string> {
  items: readonly DockItem<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** "+ เพิ่มรายการ": ปุ่มทองรายการแรกของ dock */
  primaryAction?: { label: string; icon: string; onSelect: () => void };
}

/** ขนาดช่องไอคอนตอนพัก (px) ต้องตรงกับ --dock-size ใน styles.css */
const BASE = 44;

function Icon({ path }: { path: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * เมนู dock (จอ ≥1024px · CSS ซ่อนที่แคบกว่านั้น): กระจกลอยกลางล่าง ไอคอนขยายตามเมาส์แบบ macOS
 * - ขยายด้วย transform: scale เท่านั้น (ตั้ง CSS variable ผ่าน ref + rAF ไม่ re-render ต่อการขยับเมาส์) · เมาส์จริงเท่านั้น (ไม่ขยายตอนแตะ/ปากกา)
 * - ทุกไอคอนเป็น <button> จริง ชื่อไทยใน aria-label · tooltip ชื่อหน้าตอนชี้และตอนโฟกัสคีย์บอร์ด (Esc ซ่อนชั่วคราว)
 * - prefers-reduced-motion = ไม่ขยาย (ทั้ง JS และ CSS) · วาดผ่าน portal ที่ body เหมือนเมนูมือถือ (ไม่ติด overflow ของ .page)
 */
export function Dock<Id extends string>({ items, current, onSelect, primaryAction }: Props<Id>) {
  const navRef = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const lastX = useRef(0);

  const reset = () => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    navRef.current?.querySelectorAll<HTMLElement>('.dock-cell').forEach((cell) => {
      cell.style.removeProperty('--s');
      cell.style.removeProperty('--dx');
    });
  };

  useEffect(() => reset, []);

  const apply = () => {
    frame.current = null;
    const nav = navRef.current;
    if (!nav) return;
    const navLeft = nav.getBoundingClientRect().left;
    const cells = Array.from(nav.querySelectorAll<HTMLElement>('.dock-cell'));
    // ตำแหน่งตอนพักจาก layout (offsetLeft ไม่ถูก transform กระทบ) → ระยะเมาส์ไม่แกว่งตามไอคอนที่กำลังขยาย
    const scales = cells.map((c) => magnifyScale(lastX.current - (navLeft + nav.clientLeft + c.offsetLeft + c.offsetWidth / 2)));
    const offsets = layoutOffsets(scales, BASE);
    cells.forEach((c, i) => {
      c.style.setProperty('--s', scales[i]!.toFixed(4));
      c.style.setProperty('--dx', `${offsets[i]!.toFixed(2)}px`);
    });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    navRef.current?.removeAttribute('data-tips-off');
    if (e.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lastX.current = e.clientX;
    if (frame.current === null) frame.current = window.requestAnimationFrame(apply);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') navRef.current?.setAttribute('data-tips-off', '');
  };

  return createPortal(
    <nav
      ref={navRef}
      id="dock-nav"
      className="dock glass-lite"
      aria-label="เมนูหลัก"
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      onKeyDown={onKeyDown}
      onFocus={() => navRef.current?.removeAttribute('data-tips-off')}
    >
      <ul className="dock-list">
        {primaryAction && (
          <>
            <li className="dock-cell">
              <button type="button" className="dock-item dock-item-add" aria-label={primaryAction.label} onClick={primaryAction.onSelect}>
                <Icon path={primaryAction.icon} />
              </button>
              <span className="dock-tip" aria-hidden="true">
                {primaryAction.label}
              </span>
            </li>
            <li className="dock-cell dock-sep" aria-hidden="true" />
          </>
        )}
        {items.map(({ id, label, icon }) => {
          const active = id === current;
          return (
            <li key={id} className="dock-cell">
              <button
                type="button"
                className={active ? 'dock-item dock-item-active' : 'dock-item'}
                aria-label={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSelect(id)}
              >
                <Icon path={icon} />
              </button>
              <span className="dock-tip" aria-hidden="true">
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>,
    document.body,
  );
}
