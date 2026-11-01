import type { ReactNode } from 'react';

export type ViewId = 'today' | 'ledger';

interface ShellProps {
  children: ReactNode;
  /** แสดงเมนูหลักหรือไม่ (หน้าตั้งต้นไม่แสดง) */
  showNav?: boolean;
  current?: ViewId;
  onNavigate?: (view: ViewId) => void;
  /** ปุ่มด้านล่างแถบข้าง */
  footer?: ReactNode;
}

const NAV: { id: ViewId | null; label: string }[] = [
  { id: 'today', label: 'วันนี้' },
  { id: 'ledger', label: 'รายการ' },
  { id: null, label: 'แผน' },
  { id: null, label: 'ความมั่งคั่ง' },
  { id: null, label: 'ภาษีและรายงาน' },
];

export function Shell({ children, showNav = true, current = 'today', onNavigate, footer }: ShellProps) {
  return (
    <div className="page">
      <div className="glow glow-gold" aria-hidden="true" />
      <div className="glow glow-blue" aria-hidden="true" />
      <div className="glow glow-green" aria-hidden="true" />

      <aside className="glass sidebar">
        <div className="brand">
          <span className="brand-mark">฿</span>
          <span className="brand-name">Money Buddy</span>
        </div>
        {showNav && (
          <nav aria-label="เมนูหลัก">
            {NAV.map(({ id, label }) => {
              if (id === null) {
                return (
                  <span key={label} className="nav-item nav-item-soon">
                    {label}
                    <span className="soon">เร็วๆ นี้</span>
                  </span>
                );
              }
              const active = id === current;
              return (
                <button
                  key={id}
                  className={active ? 'nav-item nav-item-active' : 'nav-item'}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onNavigate?.(id)}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        )}
        <div className="sidebar-footer">{footer}</div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
