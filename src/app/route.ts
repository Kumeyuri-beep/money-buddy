/**
 * เส้นทางของโหมดใหญ่ (ขั้น 1 ปรับโครงเว็บ): พอร์ตการลงทุน = /invest · ภาษี = /tax · หน้าอื่นอยู่ที่ / (สลับด้วย state ไม่เปลี่ยน URL)
 * ฟังก์ชันล้วน (รับค่าจาก location ที่ส่งเข้ามา ไม่แตะ DOM) เพื่อเทสต์ได้ · การผูกกับ history อยู่ที่ src/ui/useViewHistory.ts
 * harness (หน้าทดสอบ /harness.html) เป็นไฟล์ .html จึงใช้ hash (#/invest) แทน path
 */

import { investPageFromPath } from './investRoute';

export type RouteView = 'today' | 'ledger' | 'bills' | 'account' | 'averaging' | 'portfolio' | 'retirement' | 'tax';

const PATH_OF: Partial<Record<RouteView, string>> = { portfolio: '/invest', tax: '/tax' };
const VIEW_OF: Record<string, RouteView> = { '/invest': 'portfolio', '/tax': 'tax' };

export interface LocationLike {
  pathname: string;
  hash: string;
}

/** หน้าทดสอบที่เป็นไฟล์ .html ใช้ hash เพราะแก้ path ไม่ได้ */
export const usesHash = (loc: LocationLike): boolean => loc.pathname.endsWith('.html');

const normalize = (p: string): string => {
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
};

/** หน้าที่ URL ปัจจุบันบอก (null = URL ไม่ได้ระบุหน้าเฉพาะ ให้ใช้หน้าเริ่มต้น/หน้าที่เก็บใน history.state) */
export function viewFromLocation(loc: LocationLike): RouteView | null {
  const raw = usesHash(loc) ? loc.hash.replace(/^#/, '') : loc.pathname;
  const path = normalize(raw === '' ? '/' : raw);
  if (investPageFromPath(path) !== null) return 'portfolio'; // /invest/analytics/common ฯลฯ = หน้าย่อยของโหมดพอร์ต
  return VIEW_OF[path] ?? null;
}

/** URL ปลายทางของหน้า: หน้าที่มีเส้นทางของตัวเองได้ /invest หรือ /tax · หน้าอื่นได้ "/" (หรือ hash ว่างใน harness) */
export function urlForView(view: RouteView, loc: LocationLike & { search?: string }): string {
  const target = PATH_OF[view];
  const search = loc.search ?? '';
  if (usesHash(loc)) return `${loc.pathname}${search}${target ? `#${target}` : ''}`;
  return `${target ?? '/'}${search}`;
}
