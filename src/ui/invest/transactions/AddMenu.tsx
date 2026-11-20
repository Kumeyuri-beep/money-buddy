import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

export type AddAction = 'buy' | 'sell' | 'dividend' | 'cash' | 'transfer' | 'exchange';

/** ลำดับตามแบบร่าง 21 · ไม่มี "Fee or tax" (เจ้าของตัดออกจากเมนู 19 พ.ย. 2569) */
export const ADD_ITEMS: readonly { id: AddAction; label: string }[] = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
  { id: 'dividend', label: 'Dividend' },
  { id: 'cash', label: 'Cash deposit / withdrawal' },
  { id: 'transfer', label: 'Transfer to / from portfolio' },
  { id: 'exchange', label: 'Currency exchange' },
];

/** เมนู Add ของหน้า Transactions: ลูกศรขึ้น/ลง Home/End เลื่อนรายการ · Esc ปิดแล้วโฟกัสกลับปุ่ม · Tab ปิด */
export function AddMenu({ onPick }: { onPick: (a: AddAction, opener: HTMLElement) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const away = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[n]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      btn.current?.focus();
    } else if (e.key === 'ArrowDown') go((i + 1) % items.length);
    else if (e.key === 'ArrowUp') go((i - 1 + items.length) % items.length);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="tx-addwrap">
      <button
        ref={btn}
        type="button"
        className="iv-btn tx-add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span aria-hidden="true">+</span> Add
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="Add a transaction" className="tx-menu" onKeyDown={onKey}>
          {ADD_ITEMS.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className="tx-menuitem"
              onClick={() => {
                setOpen(false);
                onPick(it.id, btn.current as HTMLElement);
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
