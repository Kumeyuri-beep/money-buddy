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
  const built = useMemo(() => {
    if (data === null) return { model: null, failed: false };
    try {
      return { model: buildAnalysisModel(accounts, entries, data, today), failed: false };
    } catch (e) {
      if (e instanceof RangeError) return { model: null, failed: true }; // ตัวเลขใหญ่เกินช่วงปลอดภัย: ไม่ให้ทั้งแอปล้ม
      throw e;
    }
  }, [accounts, entries, data, today]);
  const model = built.model;

  return (
    <div className="invest-tab invest-analysis">
      <header className="an-head">
        <h2 id="inv-analysis-title">วิเคราะห์พอร์ต</h2>
        <p className="muted">ตัวเลขทุกตัวคำนวณจากรายการที่บันทึกไว้ ไม่เดาราคา</p>
      </header>
      {built.failed ? (
        <p className="form-error" role="alert">
          คำนวณไม่ได้: ตัวเลขใหญ่เกินช่วงที่ระบบรองรับ
        </p>
      ) : model === null ? (
        <p className="muted" role="status">
          กำลังโหลดข้อมูลพอร์ต…
        </p>
      ) : !model.hasStocks ? (
        <section className="solid card an-card" aria-labelledby="an-empty-title">
          <h2 id="an-empty-title">ยังไม่มีหุ้นสหรัฐ</h2>
          <p className="muted">เพิ่มหุ้นและบันทึกการซื้อได้ที่แท็บ "รายการ" แล้วกลับมาดูตารางหุ้นที่ถือ ผลตอบแทนรายเดือน และปันผลที่นี่</p>
        </section>
      ) : (
        <>
          <HoldingsCard model={model} currency={currency} />
          <MonthlyReturnsCard model={model} />
          <div className="an-pair">
            <CurrencyCard model={model} />
            <DividendCard model={model} currency={currency} />
          </div>
          <CardUnavailable id="inv-analysis-today" title="ขึ้นลงวันนี้" />
        </>
      )}
    </div>
  );
}
