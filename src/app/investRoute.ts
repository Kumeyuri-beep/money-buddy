/**
 * โครงเมนูและเส้นทางของโหมด /invest (ฟังก์ชันล้วน ไม่แตะ DOM): แต่ละหน้าย่อยมี URL ของตัวเอง เช่น /invest/analytics/common
 * harness (.html) ใช้ hash (#/invest/...) เหมือน src/app/route.ts · ข้อความเมนูเป็นภาษาอังกฤษตามกติกาของโหมดนี้
 * หน้าที่ยังไม่ทำ (status 'soon') บอกว่าจะมีอะไร (about) รออะไร (needs) และใช้ข้อมูลอะไร:
 * 'own' = ทำจากรายการที่ผู้ใช้บันทึกเองได้ · 'market' = ต้องรอข้อมูลตลาดอัตโนมัติ
 */

interface LocLike {
  pathname: string;
  hash: string;
  search?: string;
}
// (ไม่ import จาก route.ts เพื่อกันวนอ้างกัน: route.ts เป็นคนเรียกไฟล์นี้)
const usesHash = (loc: LocLike): boolean => loc.pathname.endsWith('.html');

export type InvestPageId =
  | 'dashboard'
  | 'analytics/common'
  | 'analytics/diversification'
  | 'analytics/dividends'
  | 'analytics/growth'
  | 'analytics/metrics'
  | 'analytics/report'
  | 'portfolio/holdings'
  | 'portfolio/transactions'
  | 'portfolio/dividend-calendar'
  | 'portfolio/goal'
  | 'portfolio/cash'
  | 'portfolio/categories'
  | 'portfolio/corporate-actions'
  | 'tools/rebalancing'
  | 'tools/top-dividend-stocks'
  | 'tools/find-the-dip';

export interface InvestPage {
  id: InvestPageId;
  title: string;
  status: 'live' | 'soon';
  /** (เฉพาะ soon) หน้านี้จะมีอะไร */
  about: string;
  /** (เฉพาะ soon) รออะไร */
  needs: string;
  /** (เฉพาะ soon) own = ทำได้จากข้อมูลที่ผู้ใช้บันทึกเอง · market = ต้องรอข้อมูลตลาดอัตโนมัติ */
  source: 'own' | 'market';
}

const live = (id: InvestPageId, title: string): InvestPage => ({ id, title, status: 'live', about: '', needs: '', source: 'own' });
const soon = (id: InvestPageId, title: string, about: string, needs: string, source: 'own' | 'market'): InvestPage => ({ id, title, status: 'soon', about, needs, source });

export const INVEST_PAGES: readonly InvestPage[] = [
  live('dashboard', 'Dashboard'),
  live('analytics/common', 'Analytics'),
  soon('analytics/diversification', 'Diversification', 'How your portfolio is spread across asset types, currencies and sectors.', 'Sector and country need automatic market data; asset type and currency can come from your own records.', 'own'),
  soon('analytics/dividends', 'Dividends', 'Dividend income by month and year, and how it grows over time.', 'Built from the dividends you have recorded — not built yet.', 'own'),
  live('analytics/growth', 'Growth'),
  soon('analytics/metrics', 'Metrics', 'Return measures such as money-weighted return and yield on cost.', 'Needs current prices to be meaningful — available after automatic market data is enabled.', 'market'),
  live('analytics/report', 'Report'),
  live('portfolio/holdings', 'Holdings'),
  live('portfolio/transactions', 'Transactions'),
  soon('portfolio/dividend-calendar', 'Dividend calendar', 'Upcoming dividend dates for the stocks you hold.', 'Needs automatic market data (dividend schedules).', 'market'),
  live('portfolio/goal', 'My goal'),
  live('portfolio/cash', 'Cash'),
  live('portfolio/categories', 'Categories'),
  soon('portfolio/corporate-actions', 'Corporate actions', 'Stock splits and similar events applied to your holdings.', 'Entering them by hand is not built yet; automatic detection needs market data.', 'own'),
  soon('tools/rebalancing', 'Portfolio rebalancing', 'Compare your mix with a target mix and see what to buy or sell.', 'Needs current prices to suggest amounts.', 'market'),
  soon('tools/top-dividend-stocks', 'Top dividend stocks', 'Browse stocks ranked by dividend yield.', 'Needs automatic market data.', 'market'),
  soon('tools/find-the-dip', 'Find the Dip', 'Spot stocks that have fallen well below their recent highs.', 'Needs automatic market data.', 'market'),
];

export const INVEST_HOME: InvestPageId = 'dashboard';
const PAGE_BY_ID = new Map<string, InvestPage>(INVEST_PAGES.map((p) => [p.id, p]));
export const investPage = (id: InvestPageId): InvestPage => PAGE_BY_ID.get(id)!;

export interface InvestMenuItem {
  /** page = ไปหน้าในโหมดนี้ · external = เปิดเว็บภายนอกในแท็บใหม่ (rel="noopener" · แสดงไอคอน ↗) */
  kind: 'page' | 'external';
  label: string;
  page?: InvestPageId;
  href?: string;
}
export interface InvestMenuGroup {
  id: 'dashboard' | 'analytics' | 'portfolio' | 'tools';
  label: string;
  /** เมนูที่ไม่มีกลุ่มย่อย (Dashboard) ไปหน้านี้เลย */
  page?: InvestPageId;
  /** แต่ละ section คั่นด้วยเส้นในเมนูที่เลื่อนลงมา */
  sections: { items: InvestMenuItem[] }[];
}

const pg = (label: string, page: InvestPageId): InvestMenuItem => ({ kind: 'page', label, page });

/** ปฏิทินปันผลภายนอก (เปิดแท็บใหม่ · ไม่ใช่หน้าของโหมดนี้ จึงไม่มี route และไม่ส่งข้อมูลของผู้ใช้ไปด้วย) */
export const DIVIDEND_PAYOUT_CALENDAR_URL = 'https://snowball-analytics.com/calendars/dividend-calendar';
const ext = (label: string, href: string): InvestMenuItem => ({ kind: 'external', label, href });

export const INVEST_GROUPS: readonly InvestMenuGroup[] = [
  { id: 'dashboard', label: 'Dashboard', page: 'dashboard', sections: [] },
  {
    id: 'analytics',
    label: 'Analytics',
    sections: [
      { items: [pg('Common', 'analytics/common'), pg('Diversification', 'analytics/diversification'), pg('Dividends', 'analytics/dividends'), pg('Growth', 'analytics/growth')] },
      { items: [pg('Metrics', 'analytics/metrics'), pg('Report', 'analytics/report')] },
    ],
  },
  {
    id: 'portfolio',
    label: 'Portfolio',
    sections: [
      { items: [pg('Holdings', 'portfolio/holdings'), pg('Transactions', 'portfolio/transactions'), pg('Dividend calendar', 'portfolio/dividend-calendar'), pg('My goal', 'portfolio/goal')] },
      { items: [pg('Cash', 'portfolio/cash'), pg('Categories', 'portfolio/categories'), pg('Corporate actions', 'portfolio/corporate-actions')] },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    sections: [
      {
        items: [
          pg('Portfolio rebalancing', 'tools/rebalancing'),
          pg('Top dividend stocks', 'tools/top-dividend-stocks'),
          ext('Dividend payout calendar', DIVIDEND_PAYOUT_CALENDAR_URL),
          pg('Find the Dip', 'tools/find-the-dip'),
        ],
      },
    ],
  },
];

/** กลุ่มเมนูที่หน้านั้นอยู่ (ใช้ไฮไลต์ปุ่มบนสุด) */
export function groupOfPage(id: InvestPageId): InvestMenuGroup['id'] {
  return id === 'dashboard' ? 'dashboard' : (id.split('/')[0] as InvestMenuGroup['id']);
}

export const investPath = (id: InvestPageId): string => (id === 'dashboard' ? '/invest' : `/invest/${id}`);

const normalize = (p: string): string => p.replace(/\/+$/, '') || '/';

/** หน้าที่ path บอก (null = ไม่ใช่ /invest หรือไม่รู้จัก) */
export function investPageFromPath(path: string): InvestPageId | null {
  const p = normalize(path);
  if (p === '/invest') return 'dashboard';
  const id = p.startsWith('/invest/') ? p.slice('/invest/'.length) : '';
  return id !== 'dashboard' && PAGE_BY_ID.has(id) ? (id as InvestPageId) : null;
}

/** หน้าย่อยที่ location ปัจจุบันบอก (null = ไม่ได้อยู่ใน /invest หรือไม่รู้จัก) */
export function investPageFromLocation(loc: LocLike): InvestPageId | null {
  return investPageFromPath(usesHash(loc) ? loc.hash.replace(/^#/, '') : loc.pathname);
}

export function investUrl(id: InvestPageId, loc: LocLike): string {
  const search = loc.search ?? '';
  return usesHash(loc) ? `${loc.pathname}${search}#${investPath(id)}` : `${investPath(id)}${search}`;
}
