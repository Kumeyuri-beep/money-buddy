/**
 * เอฟเฟกต์ liquid glass (14 พ.ย. 2569): แสงสะท้อนบนกระจกขยับตามเมาส์ (คอม) หรือตอบสนองตอนแตะ (มือถือ)
 * - ตัวฟังเหตุการณ์ตัวเดียวระดับเอกสาร (pointermove แบบ passive) · เขียนค่า --fx-x/--fx-y ลงการ์ดใบที่เมาส์อยู่ใบเดียว ผ่าน requestAnimationFrame
 * - ภาพทั้งหมดขยับด้วย transform/opacity ใน CSS (ดู .fx-shine / ::after ใน styles.css) ไม่แตะ layout · ไม่มีไลบรารี
 * - ไม่ขอสิทธิ์เซ็นเซอร์ใดๆ (ไม่ใช้ DeviceOrientation/DeviceMotion) · ผู้ใช้ตั้งลดการเคลื่อนไหว = ไม่ทำงานเลย (เปลี่ยนค่าระหว่างใช้งานก็ตามทัน)
 * ไม่มีสูตรเงิน ไม่แตะข้อมูล
 */

/** การ์ดที่มีเอฟเฟกต์: กระจกแท้ + glass-lite แบบการ์ด (ยกเว้น Sankey ที่เลื่อนแนวนอนได้เอง) + การ์ดหน้าล็อกอิน */
export const FX_SELECTOR = '.glass, .glass-lite.card:not(.sankey), .auth-card';

/** ตำแหน่งแสงในการ์ด (พิกเซล) จากพิกัดเมาส์/นิ้ว: ไม่ออกนอกการ์ด · ฟังก์ชันล้วนเพื่อทดสอบ */
export function fxPosition(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  const x = Math.min(Math.max(clientX - rect.left, 0), Math.max(rect.width, 0));
  const y = Math.min(Math.max(clientY - rect.top, 0), Math.max(rect.height, 0));
  return { x: Math.round(x), y: Math.round(y) };
}

export function startLiquidGlass(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win || typeof win.matchMedia !== 'function') return () => undefined;
  const reduce = win.matchMedia('(prefers-reduced-motion: reduce)');
  let current: HTMLElement | null = null;
  let frame = 0;
  let pending: { card: HTMLElement; x: number; y: number } | null = null;

  const clearCurrent = () => {
    if (current && current.getAttribute('data-fx') === 'on') current.removeAttribute('data-fx');
    current = null;
  };

  const flush = () => {
    frame = 0;
    if (!pending) return;
    const { card, x, y } = pending;
    pending = null;
    const pos = fxPosition(card.getBoundingClientRect(), x, y);
    card.style.setProperty('--fx-x', `${pos.x}px`);
    card.style.setProperty('--fx-y', `${pos.y}px`);
  };

  const schedule = (card: HTMLElement, x: number, y: number) => {
    pending = { card, x, y };
    if (!frame) frame = win.requestAnimationFrame(flush);
  };

  const cardOf = (target: EventTarget | null): HTMLElement | null => (target instanceof win.Element ? (target.closest(FX_SELECTOR) as HTMLElement | null) : null);

  const onMove = (e: PointerEvent) => {
    if (reduce.matches || e.pointerType !== 'mouse') return;
    const card = cardOf(e.target);
    if (card !== current) {
      clearCurrent();
      if (card) {
        current = card;
        card.setAttribute('data-fx', 'on');
      }
    }
    if (card) schedule(card, e.clientX, e.clientY);
  };

  const onLeaveDoc = (e: MouseEvent) => {
    if (e.relatedTarget === null) clearCurrent();
  };

  // มือถือ: คลื่นแสงเกิดตอน "ปล่อยนิ้ว" เมื่อเป็นการแตะจริง (นิ้วขยับ < 8px และไม่เกิน 300ms) ไม่ใช่ตอนเริ่มเลื่อนหน้า
  let touch: { id: number; x: number; y: number; t: number; card: HTMLElement } | null = null;
  const onDown = (e: PointerEvent) => {
    touch = null;
    if (reduce.matches || e.pointerType === 'mouse') return;
    const card = cardOf(e.target);
    if (card) touch = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, card };
  };
  const onUp = (e: PointerEvent) => {
    const start = touch;
    touch = null;
    if (!start || start.id !== e.pointerId || reduce.matches) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 8 || e.timeStamp - start.t > 300) return;
    const { card } = start;
    const pos = fxPosition(card.getBoundingClientRect(), start.x, start.y);
    card.style.setProperty('--fx-x', `${pos.x}px`);
    card.style.setProperty('--fx-y', `${pos.y}px`);
    // เริ่มอนิเมชันแตะใหม่ทุกครั้ง (ถอดแล้วใส่กลับหลังคำนวณ style) · จบแล้วถอดออกเอง
    card.removeAttribute('data-fx');
    void card.offsetWidth;
    card.setAttribute('data-fx', 'tap');
  };
  const onCancel = () => {
    touch = null;
  };

  const onAnimationEnd = (e: AnimationEvent) => {
    const el = e.target;
    if (el instanceof win.HTMLElement && el.getAttribute('data-fx') === 'tap' && e.animationName === 'fx-tap') el.removeAttribute('data-fx');
  };

  const onReduceChange = () => {
    if (reduce.matches) clearCurrent();
  };

  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerdown', onDown, { passive: true });
  doc.addEventListener('pointerup', onUp, { passive: true });
  doc.addEventListener('pointercancel', onCancel, { passive: true });
  doc.addEventListener('animationend', onAnimationEnd);
  doc.documentElement.addEventListener('mouseleave', onLeaveDoc);
  reduce.addEventListener('change', onReduceChange);

  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onCancel);
    doc.removeEventListener('animationend', onAnimationEnd);
    doc.documentElement.removeEventListener('mouseleave', onLeaveDoc);
    reduce.removeEventListener('change', onReduceChange);
    if (frame) win.cancelAnimationFrame(frame);
    clearCurrent();
  };
}
