import { useMemo } from 'react';
import { friendlyError } from '../../app/errorText';
import { WealthPanel } from '../overview/WealthPanel';
import { useInvest } from './InvestContext';
import { DashboardBody } from './dashboard/DashboardCards';
import { buildDashboardView } from './dashboard/dashboardView';
import './dashboard/dashboard.css';

/**
 * แท็บ "แดชบอร์ด" ของโหมดพอร์ต (แบบ A แนว Snowball · ดูบรีฟ docs/plans/brief-invest-dashboard.md)
 * ตัวเลขทั้งหมดมาจากฟังก์ชันโดเมน (ดู dashboard/dashboardView.ts) · สกุลที่แสดงตามปุ่ม ฿/USD ที่หัวโหมด
 * การ์ด "ความมั่งคั่งรวม" เดิม (WealthPanel · ตัวเลขเดิมไม่เปลี่ยน) คงไว้ท้ายหน้า เพื่อไม่ให้ฟีเจอร์เดิมหาย
 */
export function DashboardTab() {
  const { today, accounts, entries, data, currency } = useInvest();
  // สร้างมุมมองใน try/catch: ข้อมูลพังเฉพาะแท็บนี้ ไม่ทำให้ทั้งโหมดล้ม
  const built = useMemo(() => {
    if (data === null) return null;
    try {
      return { view: buildDashboardView(accounts, entries, data, today), failure: '' };
    } catch (e) {
      return { view: null, failure: friendlyError(e) };
    }
  }, [accounts, entries, data, today]);

  if (built === null) return null;
  return (
    <div className="invest-tab invest-dashboard dash">
      {built.view === null ? (
        <p className="form-error" role="alert">
          แสดงแดชบอร์ดไม่สำเร็จ: {built.failure}
        </p>
      ) : (
        <DashboardBody view={built.view} currency={currency} />
      )}
      <WealthPanel accounts={accounts} entries={entries} today={today} investments={data} />
    </div>
  );
}
