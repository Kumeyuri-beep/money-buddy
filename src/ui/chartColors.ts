/**
 * สีของกราฟ (Sankey/แถบสัดส่วนพอร์ต) และการ์ดแชร์ อ่านจากตัวแปร CSS ที่รันจริง เพื่อให้ตามธีมที่ใช้อยู่ (มืด/สว่าง) · โหมดสว่าง เฟส 1-2 · 14 พ.ย. 2569
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
  slice1: '#f2d06b',
  slice2: '#6fd3c4',
  slice3: '#8fb4ff',
  slice4: '#ff9f7a',
  slice5: '#c59bff',
  slice6: '#7be0a1',
  slice7: '#ffcf8a',
  sliceOther: '#8b90a5',
} as const;

/** สีของการ์ดแชร์ (รูปที่ส่งออก) ตามธีมที่ใช้อยู่ตอนกดสร้างรูป */
export const CARD_DARK = {
  bgTop: '#0f1117',
  bgBottom: '#1d2033',
  title: '#ffffff',
  subtitle: '#c9cde0',
  barGap: '#0f1117',
  label: '#ffffff',
  note: '#9fa4bb',
  brand: '#f2d06b',
} as const;

export type ChartColorKey = keyof typeof CHART_DARK;
export type CardColorKey = keyof typeof CARD_DARK;

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** ชื่อตัวแปร CSS ของสีกราฟ เช่น catBill → --chart-cat-bill · fb1 → --chart-fb1 */
export function chartVarName(key: ChartColorKey): string {
  return '--chart-' + kebab(key);
}
/** ชื่อตัวแปร CSS ของสีการ์ดแชร์ เช่น bgTop → --card-bg-top */
export function cardVarName(key: CardColorKey): string {
  return '--card-' + kebab(key);
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value !== '' ? value : fallback;
}

/** สีกราฟตามธีมที่ใช้อยู่ (อ่านจาก :root) · ไม่มีค่า/ไม่มีเบราว์เซอร์ = ค่าโหมดมืด */
export function chartColor(key: ChartColorKey): string {
  return readVar(chartVarName(key), CHART_DARK[key]);
}
/** สีการ์ดแชร์ตามธีมที่ใช้อยู่ */
export function cardColor(key: CardColorKey): string {
  return readVar(cardVarName(key), CARD_DARK[key]);
}
