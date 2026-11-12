import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TAX_DISCLAIMER } from '../../src/app/taxForm';
import { TaxView } from '../../src/ui/TaxView';

describe('TaxView (เรนเดอร์เริ่มต้น)', () => {
  // React เติม <!-- --> คั่นข้อความกับค่าตัวแปร จึงตัดทิ้งก่อนเทียบข้อความ
  const html = renderToString(createElement(TaxView)).replace(/<!-- -->/g, '');
  it('แสดงปีภาษี คำเตือนบังคับ และไม่บันทึกข้อมูล', () => {
    expect(html).toContain('ปีภาษี 2569');
    // renderToString escape อักขระพิเศษ ข้อความเตือนไม่มี < > & " จึงต้องตรงตัว
    expect(html).toContain(TAX_DISCLAIMER);
    expect(html).toContain('ไม่ถูกบันทึกลงสมุดบัญชี');
  });
  it('มีช่องเงินเดือน ภาษีที่ถูกหัก และช่องค่าลดหย่อนทั้งหมด พร้อม label เชื่อมกับ input', () => {
    for (const id of ['tx-salary', 'tx-withheld', 'tx-ss', 'tx-rmf', 'tx-pension', 'tx-esg', 'tx-other', 'tx-spouse', 'tx-children', 'tx-children-extra', 'tx-parents', 'tx-parents-health', 'tx-life', 'tx-health', 'tx-mortgage', 'tx-donation', 'tx-adopted', 'tx-disabled-rel', 'tx-disabled-other', 'tx-prenatal-1', 'tx-prenatal-2', 'tx-spouse-life']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });
  it('ยังไม่มีผลลัพธ์ก่อนกดคำนวณ และมีข้อจำกัดบนฟอร์ม', () => {
    expect(html).not.toContain('ผลประมาณการ');
    expect(html).toContain('เฉพาะเงินได้จากเงินเดือน');
  });
});

describe('ตารางค่าลดหย่อนบนมือถือ (เรียงซ้อน)', () => {
  const css = Object.values(import.meta.glob('/src/ui/styles.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  const view = Object.values(import.meta.glob('/src/ui/TaxView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  it('ทั้งสองตารางใช้คลาส tax-stack มี role ตรงๆ และทุกเซลล์ตัวเลขมี data-label', () => {
    expect(view.match(/migrate-table tax-stack/g)).toHaveLength(2);
    expect(view.match(/role="table"/g)).toHaveLength(2);
    for (const role of ['rowgroup', 'row', 'columnheader', 'rowheader', 'cell']) expect(view).toContain(`role="${role}"`);
    expect(view).not.toContain('เลื่อนซ้ายขวาได้');
    for (const label of ['ที่คุณกรอก', 'ใช้ได้ (ประมาณการ)', 'สิทธิที่ยังใช้ได้ (ข้อมูลประกอบ)', 'อัตรา', 'ส่วนของคุณในขั้นนี้']) expect(view).toContain(`data-label="${label}"`);
  });
  it('CSS มือถือ (≤720px): หัวตารางซ่อนแบบที่โปรแกรมอ่านจอยังอ่านได้ ไม่ใช้ display:none กับ thead และใช้ attr(data-label)', () => {
    const block = css.slice(css.indexOf('.tax-stack thead'));
    expect(block).toContain('clip: rect(0 0 0 0)');
    expect(block).toContain('content: attr(data-label)');
    expect(block).toContain('white-space: nowrap');
    expect(block).not.toMatch(/\.tax-stack thead\s*\{[^}]*display:\s*none/);
    expect(css.slice(css.lastIndexOf('@media', css.indexOf('.tax-stack thead')))).toContain('max-width: 720px');
  });
  it('เรนเดอร์ตารางผลได้โดยไม่ error และหัวตารางยังอยู่ใน DOM (เข้าถึงได้)', () => {
    expect(view).toContain('<thead role="rowgroup">');
  });
});
