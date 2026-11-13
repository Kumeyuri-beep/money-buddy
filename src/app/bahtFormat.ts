/**
 * ตัวจัดรูปแบบยอดเงินที่หน้าจอใช้ร่วมกัน (รวมจากที่เคยประกาศซ้ำในหน้าพอร์ต แถวสินทรัพย์ รายการลงทุน และหน้าเกษียณ)
 * รับสตางค์จำนวนเต็ม (R1) แสดงเป็นบาทด้วย formatBaht ตัวเดิม · ไม่มีสูตรเงิน ไม่เปลี่ยนค่าใดๆ
 */
import { formatBaht, satang } from '../domain/money/satang';

/** สตางค์ → ข้อความบาท เช่น 123456 → "฿1,234.56" (ตามรูปแบบของ formatBaht) */
export const baht = (n: number): string => formatBaht(satang(n));

/** เหมือน baht แต่ค่าบวกมี "+" นำหน้า (ศูนย์และค่าลบไม่เติมเครื่องหมาย: ค่าลบแสดงตามรูปแบบของ formatBaht) */
export const signed = (n: number): string => (n > 0 ? `+${baht(n)}` : baht(n));
