import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { AssetRowView } from '../../src/app/portfolio';
import { formatBaht, satang } from '../../src/domain/money/satang';
import { AssetFigures } from '../../src/ui/AssetFigures';

/** แถวสินทรัพย์ในหน้าพอร์ตบนมือถือ 360px (เจ้าของสั่ง 13 พ.ย. 2569) · ข้อมูลสมมติทั้งหมด */
const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const view = Object.values(import.meta.glob('/src/ui/PortfolioView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

const LONG = 'กองทุนเปิดตัวอย่างระยะยาวมากที่ใช้ชื่อยาวเพื่อทดสอบการตัดบรรทัดบนจอมือถือแคบๆ ชนิดผสมหลายประเทศ';
const row = (over: Partial<AssetRowView> = {}): AssetRowView => ({
  asset: { id: 'a1', name: LONG, kind: 'fund', accountId: 'inv1' } as AssetRowView['asset'],
  position: { units: 1_500_000_000n, cost: 2_500_000 } as AssetRowView['position'],
  avgCostMicro: 16_666_666,
  latestPrice: { priceMicro: 18_000_000, date: '2026-11-10' },
  priceStale: false,
  market: { value: 2_700_000, unrealized: 200_000 } as AssetRowView['market'],
  realizedGain: -30_000,
  dividendsNet: 12_300,
  ...over,
});
const html = (r: AssetRowView, today = '2026-11-13') => renderToString(createElement(AssetFigures, { row: r, today })).replace(/<!-- -->/g, '');

describe('AssetFigures (แถวสินทรัพย์)', () => {
  it('ชื่อยาวอยู่ในองค์ประกอบของตัวเอง ตัวเลขแต่ละอย่างเป็นแถวป้าย/ค่าแยกกัน (ไม่ปนในบรรทัดเดียวกับชื่อ)', () => {
    const h = html(row());
    expect(h).toContain(`<span class="asset-name">${LONG}</span>`);
    for (const label of ['ถือ', 'ต้นทุน', 'ต้นทุนเฉลี่ย', 'มูลค่า', 'กำไร/ขาดทุน', 'ขายแล้ว', 'ปันผล']) {
      expect(h, label).toContain(`<dt>${label}</dt>`);
    }
    expect(h).toContain('<dt>ราคา ณ ');
    // ตัวเลขทุกค่าอยู่ใน dd.num และไม่มีค่าไหนอยู่ในบรรทัดเดียวกับชื่อ
    expect(h.match(/<dd class="num">/g)?.length).toBe(8);
    expect(h.indexOf(LONG)).toBeLessThan(h.indexOf('<dl'));
  });
  it('ค่าตรงกับข้อมูลเดิม (จัดรูปแบบอย่างเดียว ไม่คำนวณใหม่)', () => {
    const h = html(row());
    const baht = (n: number) => formatBaht(satang(n));
    expect(h).toContain(`<dt>ต้นทุน</dt><dd class="num">${baht(2_500_000)}</dd>`);
    expect(h).toContain(`<dt>มูลค่า</dt><dd class="num">${baht(2_700_000)}</dd>`);
    expect(h).toContain(`<dt>กำไร/ขาดทุน</dt><dd class="num">+${baht(200_000)}</dd>`);
    expect(h).toContain(`<dt>ขายแล้ว</dt><dd class="num">${baht(-30_000)}</dd>`);
    expect(h).toContain(`<dt>ปันผล</dt><dd class="num">${baht(12_300)}</dd>`);
  });
  it('เครื่องหมายกำไร/ขาดทุน: บวกมี + · ลบแสดงตามรูปแบบเงินเดิม · ศูนย์ไม่มีเครื่องหมาย', () => {
    const baht = (n: number) => formatBaht(satang(n));
    const neg = html(row({ market: { value: 2_000_000, unrealized: -500_000 } as AssetRowView['market'], realizedGain: 40_000 }));
    expect(neg).toContain(`<dt>กำไร/ขาดทุน</dt><dd class="num">${baht(-500_000)}</dd>`);
    expect(neg).toContain(`<dt>ขายแล้ว</dt><dd class="num">+${baht(40_000)}</dd>`);
    const zero = html(row({ market: { value: 2_500_000, unrealized: 0 } as AssetRowView['market'] }));
    expect(zero).toContain(`<dt>กำไร/ขาดทุน</dt><dd class="num">${baht(0)}</dd>`);
  });
  it('ราคาเก่า: บอกจำนวนวันเป็นบรรทัดคำเตือนเต็มความกว้าง · ไม่มีราคา: บอกสาเหตุ', () => {
    expect(html(row({ priceStale: true }), '2026-11-20')).toContain('ราคาเก่า 10 วัน อัปเดตราคาก่อนดูมูลค่า');
    expect(html(row({ latestPrice: null, market: null }))).toContain('ยังไม่ได้กรอกราคา (ไม่แสดงมูลค่า)');
    expect(html(row({ latestPrice: null, market: null, position: { units: 0n, cost: 0 } as AssetRowView['position'] }))).toContain('ไม่มีหน่วยที่ถืออยู่');
  });
  it('ไม่มีกำไรที่ขายแล้ว/ปันผล/ต้นทุนเฉลี่ย = ไม่แสดงแถวนั้น', () => {
    const h = html(row({ realizedGain: 0, dividendsNet: 0, avgCostMicro: null }));
    for (const label of ['ขายแล้ว', 'ปันผล', 'ต้นทุนเฉลี่ย']) expect(h, label).not.toContain(`<dt>${label}</dt>`);
  });
  it('ข้อมูลผิดพลาด: แสดงข้อความ role=alert แทนตัวเลข', () => {
    const h = html(row({ error: 'ขายเกินที่ถือ' }));
    expect(h).toContain('role="alert"');
    expect(h).toContain('ขายเกินที่ถือ');
    expect(h).not.toContain('<dl');
  });
  it('หน้าพอร์ตใช้ AssetFigures แทนข้อความต่อกันยาว', () => {
    expect(view).toContain('<AssetFigures row={row} today={today} />');
    expect(view).not.toContain('(เฉลี่ย ${formatMicro');
  });
});

describe('CSS แถวสินทรัพย์', () => {
  it('ชื่อขึ้นบรรทัดใหม่ได้ (overflow-wrap) · ค่าไม่ตัดกลางตัวเลข (nowrap) · ป้ายยืดหดได้ (min-width: 0) · ช่องกริดไม่ล้นจอ 360px (min(100%, …))', () => {
    expect(css).toMatch(/\.asset-title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.asset-fig dd\s*\{[^}]*white-space:\s*nowrap/);
    expect(css).toMatch(/\.asset-fig dt\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.asset-figures\s*\{[^}]*minmax\(min\(100%,\s*\d+px\),\s*1fr\)/);
  });
  it('จอแคบ ≤480px: ค่าสั้นจัด 2 คอลัมน์ (ป้ายบนค่าล่าง) · ค่ายาวเต็มแถว', () => {
    expect(css).toMatch(/@media \(max-width: 480px\)\s*\{\s*\.asset-figures\s*\{[^}]*grid-template-columns:\s*1fr 1fr/);
    expect(css).toMatch(/\.asset-fig-wide\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(html(row())).toContain('asset-fig asset-fig-wide');
  });
  it('ชื่อสินทรัพย์เป็นหัวข้อระดับ 3 (โปรแกรมอ่านจอข้ามตามหัวข้อได้) · ปุ่มลบอ่านวันที่แบบไทย', () => {
    expect(html(row())).toContain('role="heading" aria-level="3"');
    expect(view).toContain('<TradeItem'); // ปุ่มลบอ่านวันที่แบบไทยตรวจใน tradeItem.test.ts
  });
  it('คำเตือน/ข้อความยาวเต็มความกว้างและตัดบรรทัดได้', () => {
    expect(css).toMatch(/\.asset-fig-note\s*\{[^}]*grid-column:\s*1 \/ -1/);
    expect(css).toMatch(/\.asset-fig-note dd\s*\{[^}]*white-space:\s*normal/);
  });
});
