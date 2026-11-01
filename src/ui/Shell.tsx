import type { ReactNode } from 'react';

interface ShellProps {
  children: ReactNode;
  /** แสดงเมนูหลักหรือไม่ (หน้าตั้งต้นไม่แสดง) */
  showNav?: boolean;
  /** ปุ่มด้านล่างแถบข้าง */
  footer?: ReactNode;
}

const NAV = ['วันนี้', 'รายการ', 'แผน', 'ความมั่งคั่ง', 'ภาษีและรายงาน'] as const;

export function Shell({ children, showNav = true, footer }: ShellProps) {
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
            {NAV.map((label, i) => (
              <button
                key={label}
                className={i === 0 ? 'nav-item nav-item-active' : 'nav-item'}
                aria-current={i === 0 ? 'page' : undefined}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className="sidebar-footer">{footer}</div>
      </aside>

      <main className="content">{children}</main>
    </div>
  );
}
