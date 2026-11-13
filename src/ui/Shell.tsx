import type { ReactNode } from 'react';
import { MobileMenu } from './MobileMenu';

export type ViewId = 'today' | 'ledger' | 'bills' | 'account' | 'averaging' | 'portfolio' | 'retirement' | 'tax';

interface ShellProps {
  children: ReactNode;
  /** แสดงเมนูหลักหรือไม่ (หน้าตั้งต้นไม่แสดง) */
  showNav?: boolean;
  current?: ViewId;
  onNavigate?: (view: ViewId) => void;
  /** สถานะท้ายแถบข้าง (ผลตรวจความถูกต้องของสมุดบัญชี) */
  status?: ReactNode;
  /** ปุ่มด้านล่างแถบข้าง */
  footer?: ReactNode;
  /** ชื่อผู้ใช้ที่ล็อกอินอยู่ (แสดงในการ์ดโปรไฟล์) */
  accountName?: string;
  /** ปุ่ม "ออกจากระบบ" ใต้การ์ดโปรไฟล์ (เห็นชัดในแถบเมนูทุกหน้า) */
  onSignOut?: () => void;
}

interface NavItem {
  /** null = ยังไม่มีหน้า (แสดงเป็นรายการปิดใช้งาน "เร็วๆ นี้") */
  id: ViewId | null;
  label: string;
  /** path ของไอคอนเส้น 24x24 */
  icon: string;
}

const NAV_MAIN: NavItem[] = [
  { id: 'today', label: 'ภาพรวม', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { id: 'ledger', label: 'รายรับ-รายจ่าย', icon: 'M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4' },
  { id: 'bills', label: 'บิลและเป้า', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6' },
  { id: 'portfolio', label: 'พอร์ตการลงทุน', icon: 'M3 8h18v12H3zM8 8V5h8v3' },
  { id: null, label: 'แผนลงทุน', icon: 'M4 20V11M10 20V5M16 20v-7M2 20h20' },
  { id: null, label: 'ปรับสมดุลพอร์ต', icon: 'M12 3v18M5 7h14M5 7l-3 6h6zM19 7l-3 6h6z' },
];

const NAV_TOOLS: NavItem[] = [
  { id: 'retirement', label: 'วางแผนเกษียณ', icon: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z' },
  { id: 'tax', label: 'คำนวณภาษี', icon: 'M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01' },
  { id: 'averaging', label: 'ถัวเฉลี่ยต้นทุน', icon: 'M3 7l6 6 4-4 8 8M21 11v6h-6' },
  { id: 'account', label: 'โปรไฟล์', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
];

/** เมนูมือถือ (ปุ่มลอย → bottom sheet 3 คอลัมน์ 8 รายการ · "วางแผนเกษียณ" เป็นรายการที่ 7 ตามเจ้าของ 12 พ.ย. 2569 · "ภาษี" เป็นรายการที่ 8 เฟส 1 ภาษี): เฉพาะหน้าที่มีจริง (ไม่แสดง "เร็วๆ นี้") ใช้ไอคอนชุดเดียวกับแถบข้าง */
const NAV_BOTTOM: { id: ViewId; short: string; icon: string }[] = [
  { id: 'today', short: 'ภาพรวม', icon: NAV_MAIN[0]!.icon },
  { id: 'ledger', short: 'รายการ', icon: NAV_MAIN[1]!.icon },
  { id: 'bills', short: 'บิลและเป้า', icon: NAV_MAIN[2]!.icon },
  { id: 'portfolio', short: 'พอร์ต', icon: NAV_MAIN[3]!.icon },
  { id: 'averaging', short: 'ถัวเฉลี่ย', icon: NAV_TOOLS[2]!.icon },
  { id: 'account', short: 'โปรไฟล์', icon: NAV_TOOLS[3]!.icon },
  { id: 'retirement', short: 'แผนเกษียณ', icon: NAV_TOOLS[0]!.icon },
  { id: 'tax', short: 'ภาษี', icon: NAV_TOOLS[1]!.icon },
];

function Icon({ path }: { path: string }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

export function Shell({ children, showNav = true, current = 'today', onNavigate, status, footer, accountName, onSignOut }: ShellProps) {
  const renderItem = ({ id, label, icon }: NavItem) => {
    if (id === null) {
      return (
        <span key={label} className="nav-item nav-item-soon" aria-disabled="true">
          <Icon path={icon} />
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
        <Icon path={icon} />
        {label}
      </button>
    );
  };

  return (
    <div className="page">
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        ข้ามไปเนื้อหาหลัก
      </a>
      <div className="glow glow-violet" aria-hidden="true" />
      <div className="glow glow-teal" aria-hidden="true" />
      <div className="glow glow-gold" aria-hidden="true" />
      <div className="glow glow-pink" aria-hidden="true" />

      <aside className="glass-lite sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            MB
          </span>
          <div>
            <div className="brand-name">Money Buddy</div>
            <div className="muted brand-tagline">เกษียณเป็นเรื่องของคนวางแผน</div>
          </div>
        </div>
        {showNav && (
          <>
            <div className="profile">
              <span className="profile-avatar">
                <Icon path="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
              </span>
              <div>
                <div className="profile-name">{accountName ?? 'บัญชีของคุณ'}</div>
                <div className="muted profile-sub">ข้อมูลเก็บในบัญชีของคุณ</div>
              </div>
            </div>
            {onSignOut ? (
              <button className="btn btn-ghost nav-signout" onClick={onSignOut}>
                ออกจากระบบ
              </button>
            ) : null}
            <nav aria-label="เมนูหลัก">
              <div className="nav-label">เมนูหลัก</div>
              {NAV_MAIN.map(renderItem)}
              <div className="nav-label">เครื่องมือ</div>
              {NAV_TOOLS.map(renderItem)}
            </nav>
          </>
        )}
        <div className="sidebar-footer">
          {status}
          {footer}
        </div>
      </aside>

      <main id="main" className="content" tabIndex={-1}>
        {children}
      </main>

      {showNav && (
        <MobileMenu
          items={NAV_BOTTOM.map(({ id, short, icon }) => ({ id, label: short, icon }))}
          current={current}
          onSelect={(id) => onNavigate?.(id)}
        />
      )}
    </div>
  );
}
