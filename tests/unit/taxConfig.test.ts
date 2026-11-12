import { describe, expect, it } from 'vitest';
import { MAX_TAX_INPUT_SATANG, TAX_CONFIG_2569, type Confidence } from '../../src/domain/tax/config';

const LEVELS: Confidence[] = ['verified', 'partial', 'unverified'];
const cfg = TAX_CONFIG_2569;

describe('TAX_CONFIG_2569 (R13/R19)', () => {
  it('ปีภาษี 2569', () => {
    expect(cfg.year).toBe(2569);
  });

  it('ขั้นบันไดเรียงจากน้อยไปมาก ขั้นสุดท้ายไม่มีขอบบน อัตราเพิ่มขึ้นทุกขั้น', () => {
    const b = cfg.brackets;
    expect(b.length).toBe(8);
    expect(b[b.length - 1]!.upToSatang).toBeNull();
    for (let i = 0; i < b.length - 1; i++) {
      const cur = b[i]!.upToSatang;
      expect(cur).not.toBeNull();
      if (i > 0) expect(cur!).toBeGreaterThan(b[i - 1]!.upToSatang!);
    }
    for (let i = 1; i < b.length; i++) expect(b[i]!.rateBps).toBeGreaterThan(b[i - 1]!.rateBps);
  });

  it('อัตราและขอบตรงกับบัญชีอัตรากรมสรรพากร (บาท)', () => {
    expect(cfg.brackets.map((x) => (x.upToSatang === null ? null : x.upToSatang / 100))).toEqual([
      150_000, 300_000, 500_000, 750_000, 1_000_000, 2_000_000, 5_000_000, null,
    ]);
    expect(cfg.brackets.map((x) => x.rateBps)).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000, 3500]);
  });

  it('ค่าเงินทุกตัวเป็นจำนวนเต็มสตางค์ปลอดภัย ไม่ติดลบ ไม่มีทศนิยม', () => {
    const nums: number[] = [
      ...cfg.brackets.flatMap((x) => (x.upToSatang === null ? [x.rateBps] : [x.upToSatang, x.rateBps])),
      cfg.employmentExpense.rateBps,
      cfg.employmentExpense.capSatang!,
      cfg.personalAllowance.satang,
      cfg.socialSecurity.capSatang,
      cfg.rmf.rateBps,
      cfg.pensionInsurance.rateBps,
      cfg.pensionInsurance.capSatang!,
      cfg.thaiEsg.rateBps,
      cfg.thaiEsg.capSatang!,
      cfg.retirementGroup.capSatang,
      MAX_TAX_INPUT_SATANG,
    ];
    for (const n of nums) {
      expect(Number.isSafeInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('ค่าที่เป็นที่มาตามแผน: ลดหย่อนส่วนตัว 60,000 · ประกันสังคม 10,500 (ยังไม่ยืนยัน) · กลุ่มเกษียณ 500,000 · Thai ESG 300,000', () => {
    expect(cfg.personalAllowance.satang).toBe(6_000_000);
    expect(cfg.socialSecurity.capSatang).toBe(1_050_000);
    expect(cfg.retirementGroup.capSatang).toBe(50_000_000);
    expect(cfg.thaiEsg.capSatang).toBe(30_000_000);
    expect(cfg.thaiEsg.rateBps).toBe(3000);
    expect(cfg.rmf.rateBps).toBe(3000);
    expect(cfg.pensionInsurance.rateBps).toBe(1500);
    expect(cfg.pensionInsurance.capSatang).toBe(20_000_000);
    expect(cfg.employmentExpense.rateBps).toBe(5000);
    expect(cfg.employmentExpense.capSatang).toBe(10_000_000);
  });

  it('เพดานกลุ่มเกษียณไม่ต่ำกว่าเพดานรายตัวของสมาชิกที่มีเพดานเงินบาท', () => {
    expect(cfg.retirementGroup.capSatang).toBeGreaterThanOrEqual(cfg.pensionInsurance.capSatang!);
  });

  it('ทุกค่ามีที่มาและระดับความมั่นใจที่รู้จัก (กฎ R19)', () => {
    const items = [
      ...cfg.brackets,
      cfg.employmentExpense,
      cfg.personalAllowance,
      cfg.socialSecurity,
      cfg.rmf,
      cfg.pensionInsurance,
      cfg.thaiEsg,
      cfg.retirementGroup,
    ];
    for (const it of items) {
      expect(LEVELS).toContain(it.confidence);
      expect(it.source.length).toBeGreaterThan(5);
    }
  });

  it('ค่าที่ยังไม่ยืนยันต้องมีหมายเหตุอธิบายเพื่อแสดงบนจอ', () => {
    const items = [cfg.socialSecurity, cfg.rmf, cfg.pensionInsurance, cfg.thaiEsg, cfg.retirementGroup, cfg.employmentExpense, cfg.personalAllowance, ...cfg.brackets];
    for (const it of items) {
      if (it.confidence === 'unverified') expect(it.note && it.note.length > 10).toBe(true);
    }
    expect(cfg.socialSecurity.confidence).toBe('unverified');
  });

  it('ล็อกระดับความมั่นใจ: เปลี่ยนต้องแก้เทสต์พร้อมเหตุผล และ Thai ESG ไม่อยู่ในกลุ่มเกษียณ', () => {
    expect(cfg.socialSecurity.confidence).toBe('unverified');
    for (const it of [cfg.rmf, cfg.pensionInsurance, cfg.thaiEsg, cfg.retirementGroup, cfg.employmentExpense, cfg.personalAllowance]) expect(it.confidence).toBe('partial');
    for (const b of cfg.brackets.slice(1)) expect(b.confidence).toBe('verified');
    expect(cfg.brackets[0]!.confidence).toBe('partial');
    expect(cfg.thaiEsg.note).toContain('ไม่รวมในกลุ่ม');
    expect(cfg.retirementGroup.note).toContain('Thai ESG อยู่นอกกลุ่ม');
  });

  it('ข้อความเตือนฐานข้อมูลมีอยู่ และข้อมูลเข้าสูงสุดคือ 100 ล้านบาท', () => {
    expect(cfg.basisNotice.length).toBeGreaterThan(20);
    expect(MAX_TAX_INPUT_SATANG).toBe(10_000_000_000);
  });
});
