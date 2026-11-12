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
    for (const id of ['tx-salary', 'tx-withheld', 'tx-ss', 'tx-rmf', 'tx-pension', 'tx-esg', 'tx-other', 'tx-spouse', 'tx-children', 'tx-children-extra', 'tx-parents', 'tx-parents-health', 'tx-life', 'tx-health', 'tx-mortgage', 'tx-donation']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`for="${id}"`);
    }
  });
  it('ยังไม่มีผลลัพธ์ก่อนกดคำนวณ และมีข้อจำกัดบนฟอร์ม', () => {
    expect(html).not.toContain('ผลประมาณการ');
    expect(html).toContain('เฉพาะเงินได้จากเงินเดือน');
  });
});
