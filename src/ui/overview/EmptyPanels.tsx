
/** เป้าเกษียณ + สัดส่วนพอร์ต (glass-lite): ยังไม่มีฟีเจอร์ จึงเป็นสถานะว่าง */
export function RetirementPanel() {
  return (
    <section className="glass-lite card empty-panel" aria-labelledby="retire-title">
      <h2 id="retire-title">เป้าเกษียณปีนี้</h2>
      <div className="summary-empty">ยังไม่ได้ตั้งเป้าเกษียณ</div>
      <p className="muted small">เร็วๆ นี้ · ความคืบหน้าและสัดส่วนพอร์ตจะแสดงที่นี่</p>
    </section>
  );
}
