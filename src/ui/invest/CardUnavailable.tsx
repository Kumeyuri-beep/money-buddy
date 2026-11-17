import type { ReactNode } from 'react';

/**
 * การ์ดสำหรับข้อมูลที่ยังไม่มี (เช่น ราคาอัตโนมัติ เฟส B): ห้ามใส่ตัวเลขปลอม · บอกเหตุผลสั้นๆ ว่า "ใช้ได้เมื่อเปิดราคาอัตโนมัติ"
 * ใช้ร่วมกันทุกแท็บของโหมดพอร์ต (พื้นทึบ ไม่ใช้ blur)
 */
export function CardUnavailable({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <section className="solid card invest-unavailable" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <p className="muted">Available after automatic data is enabled</p>
      {children ? <p className="muted small">{children}</p> : null}
    </section>
  );
}
