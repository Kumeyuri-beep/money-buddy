import { CardUnavailable } from './CardUnavailable';

/**
 * แท็บ "วิเคราะห์" — โครงเปล่าที่ GM วางไว้ให้ลูกน้อง 2 (ดูบรีฟ docs/plans/brief-invest-analysis.md)
 * ลูกน้อง 2 แทนที่ทั้งแท็บนี้ (ไฟล์นี้และโฟลเดอร์ src/ui/invest/analysis/ เป็นของลูกน้อง 2)
 */
export function AnalysisTab() {
  return (
    <div className="invest-tab invest-analysis">
      <section className="glass-lite card" aria-labelledby="inv-analysis-title">
        <h2 id="inv-analysis-title">วิเคราะห์พอร์ต</h2>
        <p className="muted">ตารางหุ้นที่ถือ ผลตอบแทนรายเดือน และสัดส่วนตามสกุลเงินกำลังพัฒนา</p>
      </section>
      <CardUnavailable id="inv-analysis-today" title="ขึ้นลงวันนี้" />
    </div>
  );
}
