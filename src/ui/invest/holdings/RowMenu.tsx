import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type RowAction = 'add' | 'open' | 'edit' | 'delete';
const ITEMS: { id: RowAction; label: string; hint?: string }[] = [
  { id: 'add', label: 'Add a transaction' },
  { id: 'open', label: 'Open holding' },
  { id: 'edit', label: 'Edit', hint: 'Edit the latest price and exchange rate' },
  { id: 'delete', label: 'Delete' },
];

/** เมนู ⋯ ของแถว: คีย์บอร์ดใช้ได้ (ลูกศรขึ้น/ลง · Esc ปิดแล้วโฟกัสกลับปุ่ม) · วางตำแหน่งแบบ fixed ไม่ถูกตารางเลื่อนตัด */
export function RowMenu({ label, onPick }: { label: string; onPick: (a: RowAction, from: HTMLElement) => void }) {
  const [open, setOpen] = useState<{ top: number; right: number } | null>(null);
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
      const r = btn.current?.getBoundingClientRect();
      if (r) setOpen({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
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

  const toggle = () => {
    if (open) return setOpen(null);
    const r = btn.current!.getBoundingClientRect();
    setOpen({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
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
    } else if (e.key === 'Tab') setOpen(null);
  };

  return (
    <>
      <button ref={btn} type="button" className="hd-more" aria-haspopup="menu" aria-expanded={open !== null} aria-label={label} onClick={toggle}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={label} className="hd-menu" style={{ top: open.top, right: open.right }} onKeyDown={onKey}>
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
        </div>
      )}
    </>
  );
}
