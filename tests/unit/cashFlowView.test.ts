import { describe, expect, it } from 'vitest';
import { cashFlowViewPatch, parseCashFlowView, shortLabel } from '../../src/app/cashFlowView';
import { planSettingsPatch } from '../../src/domain/bills/settingsPatch';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';

describe('มุมมองการ์ดเงินเข้า-ออก', () => {
  it('parse: ค่าแปลก/ว่าง = แผนภาพ (ค่าเริ่มต้น)', () => {
    expect(parseCashFlowView('list')).toBe('list');
    for (const v of [undefined, null, '', 'diagram', 'LIST', 1]) expect(parseCashFlowView(v)).toBe('diagram');
  });
  it('patch: เลือกแผนภาพ = ลบคีย์ · เลือกรายการ = เก็บ list', () => {
    expect(cashFlowViewPatch('diagram')).toEqual({ cashFlowView: null });
    expect(cashFlowViewPatch('list')).toEqual({ cashFlowView: 'list' });
  });
  it('settings: ตรวจ/ทำความสะอาด/patch', () => {
    expect(settingsProblem({ cashFlowView: 'list' })).toBeNull();
    expect(settingsProblem({ cashFlowView: 'diagram' })).toBeNull();
    expect(settingsProblem({ cashFlowView: 'grid' as never })).toMatch(/มุมมอง/);
    expect(sanitizeSettings({ cashFlowView: 'list' })).toEqual({ cashFlowView: 'list' });
    expect(sanitizeSettings({ cashFlowView: 'grid' })).toEqual({});
    const set = planSettingsPatch({ cashFlowView: 'list' });
    expect(set.ok && set.plan.set).toEqual({ cashFlowView: 'list' });
    const del = planSettingsPatch({ cashFlowView: null });
    expect(del.ok && del.plan.remove).toEqual(['cashFlowView']);
    expect(planSettingsPatch({ cashFlowView: 'grid' as never }).ok).toBe(false);
  });
});

describe('shortLabel (ป้ายสั้นบนแผนภาพมือถือ)', () => {
  it('สั้นพอ = ไม่แตะ · ว่าง = ว่าง', () => {
    expect(shortLabel('อาหาร', 9)).toBe('อาหาร');
    expect(shortLabel('', 9)).toBe('');
    expect(shortLabel('abcdefghi', 9)).toBe('abcdefghi');
  });
  it('ยาวเกิน: ตัดแล้วต่อ … รวมไม่เกิน max', () => {
    expect(shortLabel('abcdefghij', 9)).toBe('abcdefgh…');
    expect(Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(shortLabel('ค่าใช้จ่ายส่วนตัวรายเดือนทั้งหมด', 9))).length).toBeLessThanOrEqual(9);
  });
  it('ไม่ตัดกลางกลุ่มอักษรไทย (สระ/วรรณยุคไม่ขาด)', () => {
    const cut = shortLabel('ค่าเดินทางไปทำงานที่ไกลมาก', 6);
    expect(cut.endsWith('…')).toBe(true);
    // อักขระท้ายก่อน … ต้องไม่เป็นสระ/วรรณยุคที่ลอยโดดๆ ต่อท้ายพยัญชนะที่ถูกตัด: ส่วนที่เหลือต้องขึ้นต้นด้วยพยัญชนะ/สระนำ
    expect(/^[ก-ฮเ-ไ]/.test(cut)).toBe(true);
  });
  it('max เล็กมาก = อย่างน้อย 1 ตัว + …', () => {
    expect(shortLabel('อาหารเช้า', 1)).toBe('อ…');
  });
});
