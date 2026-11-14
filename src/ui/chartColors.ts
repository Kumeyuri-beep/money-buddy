/**
 * สีของกราฟ (Sankey/กราฟแท่ง) อ่านจากตัวแปร CSS `--chart-*` ที่รันจริง เพื่อให้โหมดสว่างทับค่าได้ (โหมดสว่าง เฟส 1 · 14 พ.ย. 2569)
 * ค่ามาตรฐานด้านล่างคือโหมดมืด (ตรงกับค่าใน src/ui/styles.css ทุกตัว มีเทสต์ล็อกให้ตรงกัน) ใช้เป็นค่าสำรองตอนไม่มีเบราว์เซอร์ (เรนเดอร์ฝั่งเซิร์ฟเวอร์/เทสต์)
 * ไม่มีสูตรเงิน: เป็นแค่ชื่อสี
 */
export const CHART_DARK = {
  catBill: '#A99BFF',
  catFood: '#FF8F82',
  catTravel: '#FFB86B',
  catShopping: '#FF7EB6',
  catOther: '#9AA0B4',
  catSaved: '#6FD9A8',
  fb1: '#8FB8FF',
  fb2: '#C9A7FF',
  fb3: '#7FE0E0',
  fb4: '#E5D27A',
  income: '#6FD9A8',
  shortfall: '#FFB86B',
  mid: '#F2D06B',
} as const;

export type ChartColorKey = keyof typeof CHART_DARK;

/** ชื่อตัวแปร CSS ของสีนั้น เช่น catBill → --chart-cat-bill · fb1 → --chart-fb1 */
export function chartVarName(key: ChartColorKey): string {
  return '--chart-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** สีตามธีมที่ใช้อยู่ตอนนี้ (อ่านจาก :root) · ไม่มีค่า/ไม่มีเบราว์เซอร์ = ค่าโหมดมืด */
export function chartColor(key: ChartColorKey): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return CHART_DARK[key];
  const value = getComputedStyle(document.documentElement).getPropertyValue(chartVarName(key)).trim();
  return value !== '' ? value : CHART_DARK[key];
}
