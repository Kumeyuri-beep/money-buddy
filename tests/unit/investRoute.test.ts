import { describe, expect, it } from 'vitest';
import { DIVIDEND_PAYOUT_CALENDAR_URL, INVEST_GROUPS, INVEST_PAGES, investPageFromPath, investPath, investUrl, type InvestPageId } from '../../src/app/investRoute';
import { urlForView, viewFromLocation } from '../../src/app/route';

describe('investRoute (เมนูย่อยของโหมด /invest)', () => {
  it('dashboard = /invest · หน้าย่อยมี path ของตัวเอง', () => {
    expect(investPath('dashboard')).toBe('/invest');
    expect(investPath('analytics/common')).toBe('/invest/analytics/common');
    expect(investPath('portfolio/dividend-calendar')).toBe('/invest/portfolio/dividend-calendar');
    expect(investPath('tools/find-the-dip')).toBe('/invest/tools/find-the-dip');
  });
  it('path ↔ หน้า ไปกลับได้ทุกหน้า และไม่มี path ซ้ำ', () => {
    const seen = new Set<string>();
    for (const p of INVEST_PAGES) {
      const path = investPath(p.id);
      expect(seen.has(path)).toBe(false);
      seen.add(path);
      expect(investPageFromPath(path)).toBe(p.id);
      expect(investPageFromPath(`${path}/`)).toBe(p.id);
    }
  });
  it('path ที่ไม่รู้จัก = null (ไม่เดา)', () => {
    expect(investPageFromPath('/invest/nope')).toBeNull();
    expect(investPageFromPath('/invest/analytics')).toBeNull();
    expect(investPageFromPath('/invest/analytics/common/x')).toBeNull();
    expect(investPageFromPath('/tax')).toBeNull();
    expect(investPageFromPath('/')).toBeNull();
  });
  it('โครงเมนูตรงที่เจ้าของสั่ง (ชื่ออังกฤษ ลำดับ และเส้นคั่นกลุ่ม)', () => {
    const labels = (g: string) => INVEST_GROUPS.find((x) => x.id === g)!.sections.map((s) => s.items.map((i) => i.label));
    expect(INVEST_GROUPS.map((g) => g.label)).toEqual(['Dashboard', 'Analytics', 'Portfolio', 'Tools']);
    expect(labels('analytics')).toEqual([['Common', 'Diversification', 'Dividends', 'Growth'], ['Metrics', 'Report']]);
    expect(labels('portfolio')).toEqual([['Holdings', 'Transactions', 'Dividend calendar', 'My goal'], ['Cash', 'Categories', 'Corporate actions']]);
    expect(labels('tools')).toEqual([['Portfolio rebalancing', 'Top dividend stocks', 'Dividend payout calendar', 'Find the Dip']]);
    expect(JSON.stringify(INVEST_GROUPS)).not.toContain('Community');
  });
  it('Dividend payout calendar เป็นลิงก์ภายนอก (ไม่มี route) · My goal เป็นหน้าของโหมดนี้ · Portfolio Lab ถูกเอาออก · หน้าที่ยังไม่มีบอกว่ารออะไร', () => {
    const items = INVEST_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items));
    const goal = items.find((i) => i.label === 'My goal')!;
    expect(goal).toMatchObject({ kind: 'page', page: 'portfolio/goal' });
    const cal = items.find((i) => i.label === 'Dividend payout calendar')!;
    expect(cal).toMatchObject({ kind: 'external', href: 'https://snowball-analytics.com/calendars/dividend-calendar' });
    expect(cal.page).toBeUndefined();
    expect(DIVIDEND_PAYOUT_CALENDAR_URL).toBe(cal.href);
    // ไม่มีลิงก์เสีย: ทุกรายการที่เป็นหน้ามี route จริง · ทุกลิงก์ภายนอกเป็น https
    for (const i of items) {
      if (i.kind === 'page') expect(investPageFromPath(investPath(i.page!))).toBe(i.page);
      else expect(i.href).toMatch(/^https:\/\//);
    }
    expect(investPageFromPath('/invest/tools/portfolio-lab')).toBeNull();
    expect(investPageFromPath('/invest/tools/dividend-payout-calendar')).toBeNull();
    expect(JSON.stringify(INVEST_GROUPS)).not.toContain('Portfolio Lab');
    for (const p of INVEST_PAGES) {
      if (p.status === 'soon') {
        expect(p.about.length).toBeGreaterThan(10);
        expect(p.needs.length).toBeGreaterThan(5);
        expect(['own', 'market']).toContain(p.source);
      }
    }
    const live: InvestPageId[] = ['dashboard', 'analytics/common', 'analytics/growth', 'analytics/report', 'portfolio/holdings', 'portfolio/transactions', 'portfolio/goal', 'portfolio/cash', 'portfolio/categories', 'tools/rebalancing'];
    expect(INVEST_PAGES.filter((p) => p.status === 'live').map((p) => p.id).sort()).toEqual([...live].sort());
  });
  it('URL: path ปกติ และ harness (.html) ใช้ hash', () => {
    expect(investUrl('analytics/growth', { pathname: '/invest', hash: '', search: '' })).toBe('/invest/analytics/growth');
    expect(investUrl('dashboard', { pathname: '/harness.html', hash: '#/invest/analytics/growth', search: '?seed=1' })).toBe('/harness.html?seed=1#/invest');
  });
  it('route หลัก: /invest/* ที่รู้จัก = หน้าพอร์ต · ที่ไม่รู้จัก = null · urlForView ไม่เปลี่ยน', () => {
    expect(viewFromLocation({ pathname: '/invest/analytics/common', hash: '' })).toBe('portfolio');
    expect(viewFromLocation({ pathname: '/harness.html', hash: '#/invest/portfolio/cash' })).toBe('portfolio');
    expect(viewFromLocation({ pathname: '/invest/extra', hash: '' })).toBeNull();
    expect(urlForView('portfolio', { pathname: '/', hash: '', search: '' })).toBe('/invest');
  });
});
