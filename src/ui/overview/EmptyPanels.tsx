
/** เป้าเกษียณ (glass-lite): ยังไม่มีฟีเจอร์ จึงเป็นสถานะว่าง (สัดส่วนพอร์ตย้ายไป AllocationPanel แล้ว) */
export function RetirementPanel() {
  return (
    <section className="glass-lite card empty-panel" aria-labelledby="retire-title">
      <h2 id="retire-title">เป้าเกษียณปีนี้</h2>
      <div className="summary-empty">ยังไม่ได้ตั้งเป้าเกษียณ</div>
      <p className="muted small">เร็วๆ นี้ · ความคืบหน้าจะแสดงที่นี่</p>
    </section>
  );
}
