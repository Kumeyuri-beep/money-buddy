import { investPage, type InvestPageId } from '../../app/investRoute';

/** หน้าย่อยที่ยังไม่ทำ: บอกว่าหน้านี้จะมีอะไร รออะไร และใช้ข้อมูลของผู้ใช้เองได้หรือต้องรอข้อมูลตลาด (ไม่มีตัวเลขเงินใดๆ) */
export function ComingSoonPage({ page, onHome }: { page: InvestPageId; onHome: () => void }) {
  const p = investPage(page);
  return (
    <div className="invest-tab iv-soon" lang="en">
      <section className="iv-card iv-soon-card" aria-labelledby="iv-soon-title">
        <p className="iv-soon-tag">Coming soon</p>
        <h2 id="iv-soon-title">{p.title}</h2>
        <p>{p.about}</p>
        <p className="iv-soon-needs">
          <strong>{p.source === 'market' ? 'Waiting for:' : 'Status:'}</strong> {p.needs}
        </p>
        <button type="button" className="iv-btn" onClick={onHome}>
          Back to Dashboard
        </button>
      </section>
    </div>
  );
}
