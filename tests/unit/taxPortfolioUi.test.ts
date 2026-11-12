import { createElement, type FunctionComponent } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TaxView, type TaxViewProps } from '../../src/ui/TaxView';

const TaxViewComponent = TaxView as FunctionComponent<TaxViewProps>;

const raw = (path: string): string => Object.values(import.meta.glob('/src/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).find((_, i) => Object.keys(import.meta.glob('/src/ui/*.tsx'))[i] === path) ?? '';

describe('ดึงยอดซื้อจากพอร์ต: ขอบเขตโค้ด (R16, R17, R19)', () => {
  const link = raw('/src/ui/TaxPortfolioLink.tsx');
  const view = raw('/src/ui/TaxView.tsx');
  const app = raw('/src/ui/App.tsx');
  it('พบไฟล์', () => {
    expect(link.length).toBeGreaterThan(500);
    expect(view.length).toBeGreaterThan(500);
  });
  it('เขียนได้เฉพาะ patchSettings (ป้ายเป็นรหัสสินทรัพย์) ไม่เขียนสมุดบัญชี/พอร์ต/แทนทั้งชุด', () => {
    expect(link).toContain('repo.patchSettings(');
    expect(link).not.toMatch(/\brepo\.(save|record|add|delete|import)\w*/);
    expect(link).toContain('repo.loadInvestments()');
  });
  it('ไม่มีสูตรเงินในคอมโพเนนต์: เรียกโดเมนสรุปยอดซื้อ ไม่ใช้ float/ปัดเอง', () => {
    expect(link).toContain('summarizeTaxPurchases(');
    expect(link).not.toMatch(/parseFloat|toFixed|Math\.|Number\(/);
  });
  it('ปุ่มทุกปุ่มเป็น type="button" (อยู่ในฟอร์มภาษี ไม่ให้กดแล้วส่งฟอร์ม) และ select มี label ผูก', () => {
    const buttons = link.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b).toContain('type="button"');
    expect(link).toContain('htmlFor={`tx-tag-${a.id}`}');
    expect(link).toContain('id={`tx-tag-${a.id}`}');
  });
  it('บอกที่มา/ข้อจำกัดของตัวเลข: ไม่รวมค่าธรรมเนียม ไม่นับปันผลลงทุนต่อ ไม่นับแผนที่ยังไม่ซื้อจริง ไม่ตรวจเงื่อนไขถือครอง แก้ยอดเองได้ + ป้ายวงเงินยังไม่ยืนยัน', () => {
    for (const t of ['ไม่รวมค่าธรรมเนียม', 'ปันผลที่นำไปซื้อต่อ', 'แผนซื้อที่ยังไม่ได้ซื้อจริง', 'เงื่อนไขการถือครอง', 'แอปไม่ได้ตรวจให้', 'ยอดแก้เองได้', 'วงเงินยังไม่ยืนยันครบ', 'TAX_PARTIAL_NOTE']) expect(link).toContain(t);
  });
  it('App ส่ง TaxPortfolioLink เข้า TaxView เป็น slot', () => {
    expect(app).toContain('<TaxView portfolio={(fill, current) => <TaxPortfolioLink onFill={fill} current={current} />} />');
  });
});

describe('TaxView: slot ดึงยอดซื้อจากพอร์ต', () => {
  it('ไม่ส่ง portfolio = ไม่มีส่วนนี้ (เครื่องคิดใช้ได้ตามเดิมโดยไม่ต้องมี repository)', () => {
    expect(renderToString(createElement(TaxViewComponent))).not.toContain('slot-marker');
  });
  it('ส่ง portfolio = เรนเดอร์ในกลุ่มช่อง RMF/Thai ESG หลังหัวกลุ่ม ก่อนช่องกรอก และรับฟังก์ชันเติมช่อง', () => {
    let received: unknown;
    const html = renderToString(
      createElement(TaxViewComponent, {
        portfolio: (fill, current) => {
          expect(current).toEqual({ rmfPaid: '', thaiEsgPaid: '' });
          received = fill;
          return createElement('p', { id: 'slot-marker' }, 'ช่องเสียบ');
        },
      }),
    );
    expect(typeof received).toBe('function');
    const legend = html.indexOf('กองทุนเพื่อการเกษียณและ Thai ESG');
    const slot = html.indexOf('id="slot-marker"');
    const rmf = html.indexOf('id="tx-rmf"');
    expect(legend).toBeGreaterThan(-1);
    expect(slot).toBeGreaterThan(legend);
    expect(rmf).toBeGreaterThan(slot);
  });
});

describe('ดึงยอดซื้อจากพอร์ต: การเติมยอดและการกรองค่า (money-auditor/security-auditor)', () => {
  const link = raw('/src/ui/TaxPortfolioLink.tsx');
  it('ปุ่มเติมปิดเมื่อยอดเป็น 0 และบอกค่าเดิมเมื่อเติมทับ (ไม่ทับเงียบ)', () => {
    expect(link).toContain('disabled={s.rmfSatang === 0}');
    expect(link).toContain('disabled={s.thaiEsgSatang === 0}');
    expect(link).toContain('แทนค่าที่กรอกไว้เดิม');
  });
  it('ค่าจาก select ถูกกรองให้เป็นป้ายที่รู้จักเท่านั้นก่อนส่ง', () => {
    expect(link).toContain("value === 'rmf' || value === 'thaiEsg' ? value : null");
    expect(link).not.toContain('e.target.value as TaxTag');
  });
  it('มีคลาส .tax-link และสไตล์ select ใน styles.css (พื้นเข้ม โฟกัสทอง สูง 44px)', () => {
    const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
    expect(css).toContain('.tax-link select');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('.tax-link select:focus-visible');
  });
});
