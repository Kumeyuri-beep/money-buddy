import { useMemo } from 'react';
import { CardUnavailable } from './CardUnavailable';
import { useInvest } from './InvestContext';
import { buildAnalysisModel } from './analysis/analysisModel';
import { HoldingsCard } from './analysis/HoldingsCard';
import { MonthlyReturnsCard } from './analysis/MonthlyReturnsCard';
import { CurrencyCard, DividendCard } from './analysis/SideCards';
import './analysis/analysis.css';

/**
 * แท็บ "วิเคราะห์" (แบบ A แนว Snowball · ลูกน้อง 2): ตารางหุ้นที่ถือ (ทั่วไป/ปันผล/กำไร) ผลตอบแทนรายเดือน สัดส่วนสกุลเงิน ปันผลเทียบเงินลงทุน
 * ตัวเลขทุกตัวมาจากฟังก์ชันใน src/domain (ผ่าน analysis/analysisModel) ไม่มีสูตรเงินในคอมโพเนนต์ · สกุลที่แสดงตามปุ่ม ฿/USD ที่หัวโหมด
 */
export function AnalysisTab() {
  const { today, accounts, entries, data, currency } = useInvest();
  const model = useMemo(() => (data === null ? null : buildAnalysisModel(accounts, entries, data, today)), [accounts, entries, data, today]);

  return (
    <div className="invest-tab invest-analysis">
      <section className="glass-lite card" aria-labelledby="inv-analysis-title">
        <h2 id="inv-analysis-title">วิเคราะห์พอร์ต</h2>
        <p className="muted">ตารางหุ้นที่ถือ ผลตอบแทนรายเดือน และสัดส่วนตามสกุลเงิน · ตัวเลขทุกตัวคำนวณจากรายการที่บันทึกไว้ ไม่เดาราคา</p>
      </section>
      {model === null ? (
        <p className="muted" role="status">
          กำลังโหลดข้อมูลพอร์ต…
        </p>
      ) : (
        <>
          <HoldingsCard model={model} currency={currency} />
          <MonthlyReturnsCard model={model} />
          <div className="an-pair">
            <CurrencyCard model={model} />
            <DividendCard model={model} currency={currency} />
          </div>
        </>
      )}
      <CardUnavailable id="inv-analysis-today" title="ขึ้นลงวันนี้" />
    </div>
  );
}
