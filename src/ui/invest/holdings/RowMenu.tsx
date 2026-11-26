import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type RowAction = 'add' | 'open' | 'edit' | 'delete' | 'deleteAsset';
const MENU_H = 5 * 44 + 40; // ความสูงเมนูโดยประมาณ (สูงสุด 5 รายการ × 44px + บรรทัดเหตุผล + ขอบ)
const ITEMS: { id: RowAction; label: string; hint?: string }[] = [
  { id: 'add', label: 'Add a transaction' },
  { id: 'open', label: 'Open holding' },
  { id: 'edit', label: 'Edit', hint: 'Edit the latest price and exchange rate' },
  { id: 'delete', label: 'Delete all records' },
];

/** เมนู ⋯ ของแถว: คีย์บอร์ดใช้ได้ (ลูกศรขึ้น/ลง · Esc ปิดแล้วโฟกัสกลับปุ่ม) · วางตำแหน่งแบบ fixed ไม่ถูกตารางเลื่อนตัด */
/**
 * deleteAsset: ไม่ส่ง = ไม่แสดงรายการ "Delete asset" (มือถือ) · reason = null แปลว่ากดได้ · มีข้อความ = ปิดและแสดงเหตุผลใต้ชื่อรายการ
 */
export function RowMenu({ label, onPick, deleteAsset }: { label: string; onPick: (a: RowAction, from: HTMLElement) => void; deleteAsset?: { reason: string | null } }) {
  const [open, setOpen] = useState<{ top: number; right: number; up: boolean } | null>(null);
  // วางเมนูใน body ทุกขนาดจอ: การ์ดกระจก (backdrop-filter) ทำให้ position: fixed ของลูกอิงกรอบการ์ด ไม่ใช่หน้าจอ เมนูจึงเปิดไกลจากปุ่มหรือหลุดนอกจอ
  // (พบบนคอมตอนทำ Delete asset · ยืนยันบนมือถือ/แท็บเล็ต 26 พ.ย. 2569)
  const inBody = (node: ReactNode): ReactNode => (typeof document !== 'undefined' ? createPortal(node, document.body) : node);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(null);
    };
    // เลื่อนหน้า/ย่อขยายหน้าต่าง = วางเมนูใหม่ให้ตามปุ่ม (ไม่ปิดเมนูกลางคัน)
    const close = () => {
      const next = place();
      if (next) setOpen(next);
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const place = (): { top: number; right: number; up: boolean } | null => {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return null;
    const up = r.bottom + 4 + MENU_H > window.innerHeight && r.top - 4 - MENU_H >= 0; // ล่างไม่พอ = พลิกขึ้น
    return { top: up ? r.top - 4 : r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), up };
  };
  const toggle = () => setOpen(open ? null : place());
  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(null);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Tab') setOpen(null);
  };

  return (
    <>
      <button ref={btn} type="button" className="hd-more" aria-haspopup="menu" aria-expanded={open !== null} aria-label={label} onClick={toggle}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && inBody(
        <div ref={menu} role="menu" aria-label={label} className="hd-menu" style={{ top: open.top, right: open.right, transform: open.up ? 'translateY(-100%)' : undefined }} onKeyDown={onKey}>
          {ITEMS.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`hd-menuitem${it.id === 'delete' ? ' is-danger' : ''}`}
              title={it.hint}
              onClick={() => {
                setOpen(null);
                onPick(it.id, btn.current as HTMLElement);
              }}
            >
              {it.label}
            </button>
          ))}
          {deleteAsset && (
            <button
              type="button"
              role="menuitem"
              className="hd-menuitem is-danger-next"
              aria-disabled={deleteAsset.reason !== null ? 'true' : undefined}
              aria-describedby={deleteAsset.reason !== null ? 'hd-da-why' : undefined}
              onClick={() => {
                if (deleteAsset.reason !== null) return; // ปิดอยู่: ไม่ทำอะไร เหตุผลแสดงอยู่ใต้ชื่อรายการ
                setOpen(null);
                onPick('deleteAsset', btn.current as HTMLElement);
              }}
            >
              Delete asset
              {deleteAsset.reason !== null && (
                <span id="hd-da-why" className="hd-menuhint" aria-hidden="true">
                  {deleteAsset.reason}
                </span>
              )}
            </button>
          )}
        </div>
      )}
    </>
  );
}
