import { useMemo } from 'react';
import { CardUnavailable } from './CardUnavailable';
import { useInvest } from './InvestContext';
import { buildAnalysisModel } from './analysis/analysisModel';
import { HoldingsCard } from './analysis/HoldingsCard';
import { MonthlyReturnsCard } from './analysis/MonthlyReturnsCard';
import { ProfitSourcesCard } from './analysis/ProfitSourcesCard';
import { CurrencyCard, DividendCard } from './analysis/SideCards';
import './analysis/analysis.css';

/**
 * แท็บ "Analytics" (เมนู Analytics → Common และ Growth · Growth = ตารางผลตอบแทนรายเดือน) (แบบ A แนว Snowball · ลูกน้อง 2): ตารางหุ้นที่ถือ (ทั่วไป/ปันผล/กำไร) ผลตอบแทนรายเดือน สัดส่วนสกุลเงิน ปันผลเทียบเงินลงทุน
 * ตัวเลขทุกตัวมาจากฟังก์ชันใน src/domain (ผ่าน analysis/analysisModel) ไม่มีสูตรเงินในคอมโพเนนต์ · สกุลที่แสดงตามปุ่ม ฿/USD ที่หัวโหมด
 */
export function AnalysisTab({ part }: { part: 'common' | 'growth' }) {
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
        <h2 id="inv-analysis-title">{part === 'growth' ? 'Analytics · Growth' : 'Analytics'}</h2>
        <p className="muted">Every figure is calculated from your recorded transactions. Prices are never guessed.</p>
      </header>
      {built.failed ? (
        <p className="form-error" role="alert">
          Cannot calculate: a number is larger than the supported range.
        </p>
      ) : model === null ? (
        <p className="muted" role="status">
          Loading portfolio data…
        </p>
      ) : !model.hasStocks ? (
        <section className="solid card an-card" aria-labelledby="an-empty-title">
          <h2 id="an-empty-title">No US stocks yet</h2>
          <p className="muted">Add a stock and record a purchase under Portfolio → Holdings, then come back to see your holdings, monthly returns and dividends here.</p>
        </section>
      ) : (
        part === 'growth' ? (
          <MonthlyReturnsCard model={model} />
        ) : (
          <>
            <HoldingsCard model={model} currency={currency} />
            <ProfitSourcesCard profit={model.profit} currency={currency} />
            <div className="an-pair">
              <CurrencyCard model={model} />
              <DividendCard model={model} currency={currency} />
            </div>
            <CardUnavailable id="inv-analysis-today" title="Today's movers" />
          </>
        )
      )}
    </div>
  );
}
