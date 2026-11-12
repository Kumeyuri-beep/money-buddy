import { describe, expect, it } from 'vitest';
import { balanceSummary, buildTaxInput, confidenceBadge, DEDUCTION_LABELS, emptyTaxForm, TAX_DISCLAIMER, TAX_LIMITATIONS, TAX_UNSUPPORTED_NOTE, type TaxForm } from '../../src/app/taxForm';
import { formatAbsWholeBaht, formatWholeBaht, wholeBaht } from '../../src/domain/tax/display';

const form = (over: Partial<TaxForm>): TaxForm => ({ ...emptyTaxForm(), ...over });

describe('buildTaxInput (ฟอร์มภาษี เฟส 1)', () => {
  it('ช่องเงินเดือนว่าง → ขึ้นให้กรอก', () => {
    const r = buildTaxInput(form({}));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors).toEqual([{ field: 'annualSalary', message: 'กรอกเงินได้จากเงินเดือนทั้งปี' }]);
  });

  it('กรอกเฉพาะเงินเดือน ช่องอื่นว่าง = 0', () => {
    const r = buildTaxInput(form({ annualSalary: '600000' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({ annualSalary: 60_000_000, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 });
      expect(r.result.tax).toBe(2_150_000);
    }
  });

  it('รับ 1,234.50 และ ฿ และทศนิยม 2 ตำแหน่ง', () => {
    const r = buildTaxInput(form({ annualSalary: '฿1,234,567.89', socialSecurityPaid: '9,000' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input.annualSalary).toBe(123_456_789);
      expect(r.input.socialSecurityPaid).toBe(900_000);
    }
  });

  it('ติ๊กมีเงินได้อื่น → ไม่รองรับ ไม่คำนวณ', () => {
    const r = buildTaxInput(form({ hasOtherIncome: true, annualSalary: '600000' }));
    expect(r).toEqual({ ok: false, unsupported: true });
    expect(TAX_UNSUPPORTED_NOTE).toContain('ไม่รองรับ');
  });

  it('เครื่องหมายบวก/ลบและข้อความที่อ่านไม่ได้ ชี้รายช่อง', () => {
    const r = buildTaxInput(form({ annualSalary: '-5', rmfPaid: 'abc', thaiEsgPaid: '+10' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) {
      expect(r.errors.map((e) => e.field).sort()).toEqual(['annualSalary', 'rmfPaid', 'thaiEsgPaid']);
      expect(r.errors.find((e) => e.field === 'rmfPaid')!.message).toContain('ไม่ถูกต้อง');
    }
  });

  it('เครื่องหมายหลัง ฿ ถูกปฏิเสธรายช่อง: ฿-5, ฿+10, ฿-0', () => {
    for (const text of ['฿-5', '฿+10', '฿-0']) {
      const r = buildTaxInput(form({ annualSalary: '600000', rmfPaid: text }));
      expect(r.ok).toBe(false);
      if (!r.ok && !r.unsupported) expect(r.errors).toEqual([{ field: 'rmfPaid', message: 'เงินที่ซื้อ RMF ในปีไม่ต้องใส่เครื่องหมาย + หรือ - (ต้องไม่ติดลบ)' }]);
    }
  });

  it('"-0" ถูกปฏิเสธ', () => {
    const r = buildTaxInput(form({ annualSalary: '600000', withheldTax: '-0' }));
    expect(r.ok).toBe(false);
  });

  it('เกิน 100 ล้านบาท → ข้อผิดพลาดทั่วไปภาษาไทยจากโดเมน ไม่เงียบ', () => {
    const r = buildTaxInput(form({ annualSalary: '100000000.01' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) {
      expect(r.errors[0]!.field).toBe('general');
      expect(r.errors[0]!.message).toContain('100 ล้านบาท');
    }
  });

  it('ตัวเลขใหญ่เกินช่วงปลอดภัย → ใหญ่เกินไป', () => {
    const r = buildTaxInput(form({ annualSalary: '999999999999999999999' }));
    expect(r.ok).toBe(false);
    if (!r.ok && !r.unsupported) expect(r.errors[0]!.message).toContain('ใหญ่เกินไป');
  });
});

describe('ป้ายความมั่นใจและข้อความบังคับ (R19)', () => {
  it('ประกันสังคมที่ยังไม่ยืนยันมีป้าย "ยังไม่ยืนยัน" ส่วน partial มีป้ายเอกสาร ม.ค. 2568 และ verified ไม่มีป้าย', () => {
    expect(confidenceBadge('unverified')).toBe('ยังไม่ยืนยัน');
    expect(confidenceBadge('partial')).toContain('ม.ค. 2568');
    expect(confidenceBadge('verified')).toBeNull();
  });
  it('ข้อความเตือนบังคับครบถ้อยคำตาม R19', () => {
    expect(TAX_DISCLAIMER).toBe('ตัวเลขนี้เป็นการประมาณการเท่านั้น ไม่ใช่คำแนะนำทางภาษี ไม่ใช่การรับประกันผล และอาจต่างจากที่กรมสรรพากรคำนวณ โปรดตรวจกับ e-Filing หรือกรมสรรพากรก่อนยื่นแบบ');
    expect(TAX_LIMITATIONS).toContain('เฉพาะเงินได้จากเงินเดือน');
    expect(TAX_LIMITATIONS).toContain('ไม่ตรวจเงื่อนไขของสิทธิ');
  });
  it('ป้ายชื่อค่าลดหย่อนครบทุกตัว', () => {
    expect(Object.keys(DEDUCTION_LABELS)).toHaveLength(13);
  });
});

describe('ตัวปัดแสดงผลบาทเต็ม', () => {
  it('ปัดครึ่งขึ้น: 12,349.50 → 12,350 · 12,349.49 → 12,349', () => {
    expect(formatWholeBaht(1_234_950)).toBe('฿12,350');
    expect(formatWholeBaht(1_234_949)).toBe('฿12,349');
  });
  it('0 และค่าน้อยมาก', () => {
    expect(formatWholeBaht(0)).toBe('฿0');
    expect(formatWholeBaht(49)).toBe('฿0');
    expect(formatWholeBaht(50)).toBe('฿1');
  });
  it('ค่าสัมบูรณ์ของผลต่าง ไม่มีเครื่องหมายลบ', () => {
    expect(formatAbsWholeBaht(-350_000)).toBe('฿3,500');
    expect(formatAbsWholeBaht(0)).toBe('฿0');
  });
  it('ค่าที่ไม่ถูกต้อง = RangeError', () => {
    expect(() => wholeBaht(-1)).toThrow(RangeError);
    expect(() => wholeBaht(1.5)).toThrow(RangeError);
    expect(() => wholeBaht(-0)).toThrow(RangeError);
    expect(() => formatAbsWholeBaht(Number.NaN)).toThrow(RangeError);
  });
});

describe('ข้อความบนจอไม่มีคำชวนซื้อ/สื่อรับประกัน (R19)', () => {
  const files = {
    ...(import.meta.glob('/src/ui/TaxView.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
    ...(import.meta.glob('/src/app/taxForm.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  };
  const banned = ['ควรซื้อ', 'รีบ', 'คุ้ม', 'ประหยัดภาษี', 'การันตี', 'แน่นอน', 'ต้องจ่าย', 'ได้คืนแน่', 'รับรอง', 'ซื้อเลย', 'โอกาส'];
  it('พบไฟล์', () => {
    expect(Object.keys(files).length).toBe(2);
  });
  for (const [path, text] of Object.entries(files)) {
    // ข้อความเตือนบังคับมีคำ "ไม่ใช่การรับประกันผล" (ปฏิเสธการรับประกัน) จึงตัดทิ้งก่อนตรวจ
    const code = text.replace(/ไม่ใช่การรับประกัน/g, '');
    it(`${path.split('/').pop()}: ไม่มีคำต้องห้าม`, () => {
      for (const w of banned) expect(code).not.toContain(w);
      expect(code).not.toContain('รับประกัน');
    });
  }
});

describe('balanceSummary (ผลต่างกับภาษีที่ถูกหัก ไม่ใช้เครื่องหมาย)', () => {
  it('เท่ากัน', () => {
    expect(balanceSummary('even', 0)).toBe('ภาษีที่ถูกหักไปแล้วเท่ากับภาษีที่ประมาณได้');
  });
  it('ชำระเพิ่ม / ขอคืน ระบุจำนวนบาทเต็มและคำว่าประมาณการ', () => {
    expect(balanceSummary('payMore', 260_000)).toBe('ประมาณว่าต้องชำระเพิ่ม ฿2,600 (ประมาณการ)');
    expect(balanceSummary('refund', -350_000)).toBe('ประมาณว่าอาจขอคืนได้ ฿3,500 (ประมาณการ)');
  });
  it('ผลต่างไม่เป็นศูนย์แต่ปัดเป็น ฿0 → ไม่ขึ้น "ชำระเพิ่ม ฿0"', () => {
    expect(balanceSummary('payMore', 30)).toBe('ภาษีที่ถูกหักไปแล้วใกล้เคียงกับภาษีที่ประมาณได้ (ต่างกันไม่ถึง ฿1)');
    expect(balanceSummary('refund', -49)).toBe('ภาษีที่ถูกหักไปแล้วใกล้เคียงกับภาษีที่ประมาณได้ (ต่างกันไม่ถึง ฿1)');
    expect(balanceSummary('payMore', 50)).toBe('ประมาณว่าต้องชำระเพิ่ม ฿1 (ประมาณการ)');
  });
});
