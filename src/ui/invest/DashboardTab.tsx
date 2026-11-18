import { useMemo } from 'react';
import { investError } from './investError';
import { useInvest } from './InvestContext';
import { MissingRateNotice } from './MissingRateNotice';
import { LowerCards } from './dashboard/LowerCards';
import { PortfolioCard } from './dashboard/PortfolioCard';
import { StatCards } from './dashboard/StatCards';
import { buildDashboardView } from './dashboard/dashboardView';
import './dashboard/dashboard.css';

/**
 * แท็บ Dashboard ของโหมด /invest (แบบร่างใหม่ · ภาษาอังกฤษ) · PR 1: 4 การ์ดตัวเลข + การ์ด Portfolio · PR 2: การ์ดล่าง (Top day gainers/losers, events, Future payments, My goal)
 * ตัวเลขทั้งหมดมาจากฟังก์ชันโดเมนผ่าน dashboard/dashboardView.ts · สกุลที่แสดงตามปุ่ม ฿/USD ที่แถบบน
 * (การ์ดความมั่งคั่งรวมเดิม WealthPanel ยังอยู่ที่หน้าภาพรวมของแอป ไม่ได้หายไป)
 */
export function DashboardTab() {
  const { today, accounts, entries, data, currency, onOpenRetirement } = useInvest();
  // สร้างมุมมองใน try/catch: ข้อมูลพังเฉพาะแท็บนี้ ไม่ทำให้ทั้งโหมดล้ม
  const built = useMemo(() => {
    if (data === null) return null;
    try {
      return { view: buildDashboardView(accounts, entries, data, today), failure: '' };
    } catch (e) {
      return { view: null, failure: investError(e) };
    }
  }, [accounts, entries, data, today]);

  if (built === null) return null;
  return (
    <div className="invest-tab iv-dash" lang="en">
      {built.view === null ? (
        <p className="form-error" role="alert">
          Could not show the dashboard: {built.failure}
        </p>
      ) : (
        <>
          <MissingRateNotice trades={built.view.us.missingRate} tickerOf={(id) => built.view?.us.rows.find((r) => r.assetId === id)?.ticker ?? ''} />
          <StatCards view={built.view} currency={currency} onOpenRetirement={onOpenRetirement} />
          <PortfolioCard view={built.view} currency={currency} />
          <LowerCards view={built.view} currency={currency} onOpenRetirement={onOpenRetirement} />
        </>
      )}
    </div>
  );
}
