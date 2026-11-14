import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { magnifyScale } from './dockMagnify';

export interface DockItem<Id extends string> {
  id: Id;
  label: string;
  /** path ของไอคอนเส้น 24x24 (ชุดเดียวกับเมนูมือถือ) */
  icon: string;
  /** ชื่อสีพาสเทลของไอคอน (คลาส dock-c-<tone> → โทเคน --dock-hue-<tone> / --dock-ink-<tone>) */
  tone: string;
}

interface Props<Id extends string> {
  items: readonly DockItem<Id>[];
  current: Id;
  onSelect: (id: Id) => void;
  /** "+ เพิ่มรายการ": ปุ่มทองใต้โลโก้ */
  primaryAction?: { label: string; icon: string; onSelect: () => void };
  /** ชื่อผู้ใช้ + สถานะตรวจบัญชี แสดงหัวเมนูบัญชี */
  accountName?: string;
  status?: ReactNode;
  /** เปิดหน้า "โปรไฟล์และตั้งค่า" (หน้านั้นเปิดอยู่ = ปุ่มบัญชีมีวงทอง) */
  onProfile?: () => void;
  profileActive?: boolean;
  onSignOut?: () => void;
}

const ACCOUNT_ICON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0';
const SIGNOUT_ICON = 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10';

function Icon({ path }: { path: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/**
 * เมนู dock แนวตั้งซ้าย (จอ ≥1024px · CSS ซ่อนที่แคบกว่านั้น): กระจกลอยซ้ายกึ่งกลางแนวตั้ง แทนแถบข้างทั้งแถบ
 * บนสุด โลโก้ MB + "เพิ่มรายการ" · กลาง 7 เมนูสีพาสเทล ขยายตามระยะเมาส์ในแนวตั้ง · ล่างสุด ปุ่มบัญชี → เมนู (ผู้ใช้+สถานะ · โปรไฟล์และตั้งค่า · ออกจากระบบ)
 * - ขยายด้วย transform: scale เท่านั้น (ตั้ง CSS variable --s ผ่าน rAF ไม่ re-render ต่อการขยับเมาส์) · เมาส์จริงเท่านั้น · ไม่เลื่อนตำแหน่ง (ช่องว่างกว้างพอไม่ทับกัน)
 * - ทุกไอคอนเป็น <button> ชื่อไทยใน aria-label · tooltip ทางขวาตอนชี้และโฟกัสคีย์บอร์ด (Esc ซ่อนชั่วคราว)
 * - เมนูบัญชีใช้คีย์บอร์ดได้: Enter/Space/ลูกศรลงเปิด · ลูกศรขึ้นลง Home End เลื่อน · Esc ปิดแล้วคืนโฟกัสปุ่มบัญชี · Tab ปิด · คลิกนอกเมนูปิด
 * - prefers-reduced-motion = ไม่ขยาย (ทั้ง JS และ CSS) · วาดในตำแหน่งต้นหน้า (ก่อนเนื้อหา) ให้ลำดับ Tab ตรงกับที่เห็น (WCAG 2.4.3 · ไม่ใช้ portal ต่างจากเมนูมือถือ)
 */
export function Dock<Id extends string>({ items, current, onSelect, primaryAction, accountName, status, onProfile, profileActive, onSignOut }: Props<Id>) {
  const navRef = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const lastY = useRef(0);
  const accountRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const reset = () => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    navRef.current?.querySelectorAll<HTMLElement>('.dock-cell:not(.dock-cell-static)').forEach((cell) => cell.style.removeProperty('--s'));
  };

  useEffect(() => reset, []);

  const apply = () => {
    frame.current = null;
    navRef.current?.querySelectorAll<HTMLElement>('.dock-cell:not(.dock-cell-static)').forEach((cell) => {
      const r = cell.getBoundingClientRect(); // ช่องไม่ถูก transform (ขยายเฉพาะปุ่มข้างใน) → ศูนย์กลางนิ่ง ระยะเมาส์ไม่แกว่ง
      cell.style.setProperty('--s', magnifyScale(lastY.current - (r.top + r.height / 2)).toFixed(4));
    });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    navRef.current?.removeAttribute('data-tips-off');
    if (e.pointerType !== 'mouse') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    lastY.current = e.clientY;
    if (frame.current === null) frame.current = window.requestAnimationFrame(apply);
  };

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) window.setTimeout(() => accountRef.current?.focus(), 0);
  };

  // เมนูบัญชีเปิด: โฟกัสรายการแรก · คลิกนอกเมนูปิด
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !accountRef.current?.contains(t)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(at + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(at <= 0 ? nodes.length : at) - 1]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      // โฟกัสปุ่มบัญชีก่อนถอดเมนู (กันโฟกัสหลุดไป body) แล้วให้ Tab ต่อไปองค์ประกอบถัดไปตามปกติ
      accountRef.current?.focus();
      closeMenu(false);
    }
  };

  const onNavKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && !menuOpen) navRef.current?.setAttribute('data-tips-off', '');
  };

  return (
    <nav
      ref={navRef}
      id="dock-nav"
      className="dock glass-lite"
      aria-label="เมนูหลัก"
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
      onKeyDown={onNavKey}
      onFocus={() => navRef.current?.removeAttribute('data-tips-off')}
    >
      <div className="dock-logo" role="img" aria-label="Money Buddy">
        MB
      </div>
      <span className="dock-line" aria-hidden="true" />
      <ul className="dock-list">
        {primaryAction && (
          <li className="dock-cell">
            <button type="button" className="dock-item dock-item-add" aria-label={primaryAction.label} onClick={primaryAction.onSelect}>
              <Icon path={primaryAction.icon} />
            </button>
            <span className="dock-tip" aria-hidden="true">
              {primaryAction.label}
            </span>
          </li>
        )}
        {items.map(({ id, label, icon, tone }) => {
          const active = id === current;
          return (
            <li key={id} className="dock-cell">
              <button
                type="button"
                className={`dock-item dock-c-${tone}${active ? ' dock-item-active' : ''}`}
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
      <span className="dock-line" aria-hidden="true" />
      <div className="dock-cell dock-cell-static" data-open={menuOpen ? '' : undefined}>
        <button
          ref={accountRef}
          type="button"
          className={`dock-item dock-account${profileActive ? ' dock-account-active' : ''}`}
          aria-label="บัญชีของฉัน"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? 'dock-account-menu' : undefined}
          onClick={() => setMenuOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' && !menuOpen) {
              e.preventDefault();
              setMenuOpen(true);
            }
          }}
        >
          <Icon path={ACCOUNT_ICON} />
        </button>
        <span className="dock-tip" aria-hidden="true">
          บัญชีของฉัน
        </span>
        {menuOpen && (
          <div ref={menuRef} className="dock-menu" onKeyDown={onMenuKey}>
            {/* หัวเมนู (ชื่อผู้ใช้+สถานะ) อยู่นอก role="menu" เพราะ menu ต้องมีแต่ menuitem */}
            <div className="dock-menu-head">
              <span className="dock-menu-name">{accountName ?? 'บัญชีของคุณ'}</span>
              {status}
            </div>
            <div id="dock-account-menu" role="menu" aria-label="เมนูบัญชี" className="dock-menu-items">
            <button
              type="button"
              role="menuitem"
              className="dock-menuitem"
              onClick={() => {
                closeMenu(false);
                onProfile?.();
              }}
            >
              <Icon path={ACCOUNT_ICON} />
              โปรไฟล์และตั้งค่า
            </button>
            {onSignOut && (
              <button
                type="button"
                role="menuitem"
                className="dock-menuitem dock-menuitem-danger"
                onClick={() => {
                  closeMenu(false);
                  onSignOut();
                }}
              >
                <Icon path={SIGNOUT_ICON} />
                ออกจากระบบ
              </button>
            )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
