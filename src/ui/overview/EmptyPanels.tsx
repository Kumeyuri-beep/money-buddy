
/** เป้าเกษียณ (glass-lite): ทางเข้าเครื่องคิดเลขเกษียณ (เฟส 1) · ความคืบหน้าตามพอร์ตจริงจะมาในเฟส 2 */
export function RetirementPanel({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="glass-lite card empty-panel" aria-labelledby="retire-title">
      <h2 id="retire-title">เป้าเกษียณ</h2>
      <div className="summary-empty">ประมาณว่าต้องมีเงินเท่าไรตอนเกษียณ</div>
      <button type="button" className="card-link" onClick={onOpen}>
        เปิดเครื่องคิดเลขเกษียณ →
      </button>
      <p className="muted small">เป็นการประมาณการ ไม่ใช่ยอดจริง · ความคืบหน้าตามพอร์ตจริงจะมาในรุ่นถัดไป</p>
    </section>
  );
}
