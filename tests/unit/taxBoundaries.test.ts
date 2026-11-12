import { describe, expect, it } from 'vitest';
import { computeSalaryTax, type SalaryTaxInput } from '../../src/domain/tax/salaryTax';

/**
 * เทสต์รอยต่อขั้นบันไดทุกขั้น (R14/R19): พอดี ±1 บาท และเงินได้ 0
 * เงินได้สุทธิ = เงินเดือน − เหมา 100,000 − ลดหย่อนส่วนตัว 60,000 เมื่อเงินเดือน ≥ 200,000 ดังนั้นเงินเดือน = สุทธิ + 160,000
 * ค่าคาดหวังคำนวณมือจากตารางอัตรา (ภาษีสะสม ณ ขอบ + 1 บาทที่อัตราของขั้นถัดไป/ก่อนหน้า) ไม่เรียกโค้ดภาษีมาคำนวณเอง
 */
const B = (baht: number): number => baht * 100;
const base: SalaryTaxInput = { annualSalary: 0, withheldTax: 0, socialSecurityPaid: 0, rmfPaid: 0, pensionInsurancePaid: 0, thaiEsgPaid: 0 };
const tax = (annualSalary: number): number => computeSalaryTax({ ...base, annualSalary }).tax;

// [ขอบ (บาท), ภาษีสะสมที่ขอบ (บาท), อัตราขั้นก่อนหน้า (%), อัตราขั้นถัดไป (%)]
const EDGES: [number, number, number, number][] = [
  [150_000, 0, 0, 5],
  [300_000, 7_500, 5, 10],
  [500_000, 27_500, 10, 15],
  [750_000, 65_000, 15, 20],
  [1_000_000, 115_000, 20, 25],
  [2_000_000, 365_000, 25, 30],
  [5_000_000, 1_265_000, 30, 35],
];

describe('รอยต่อขั้นบันได: พอดี และ ±1 บาท (สุทธิ = เงินเดือน − 160,000)', () => {
  for (const [edge, cum, below, above] of EDGES) {
    const salaryAt = (net: number): number => B(net + 160_000);
    it(`ขอบ ${edge.toLocaleString('en-US')}: พอดี = ภาษีสะสม`, () => {
      expect(tax(salaryAt(edge))).toBe(B(cum));
    });
    it(`ขอบ ${edge.toLocaleString('en-US')}: −1 บาท = ภาษีสะสม − 1 บาท × ${below}%`, () => {
      expect(tax(salaryAt(edge - 1))).toBe(B(cum) - below);
    });
    it(`ขอบ ${edge.toLocaleString('en-US')}: +1 บาท = ภาษีสะสม + 1 บาท × ${above}%`, () => {
      expect(tax(salaryAt(edge + 1))).toBe(B(cum) + above);
    });
  }

  it('1 บาทเหนือแต่ละขอบ ภาษีเพิ่มเท่ากับอัตราขั้นถัดไปเป็นสตางค์ (5/10/15/20/25/30/35 สตางค์) ไม่ใช่อัตราขั้นก่อนหน้า', () => {
    expect(EDGES.map(([edge, cum]) => tax(B(edge + 1 + 160_000)) - B(cum))).toEqual([5, 10, 15, 20, 25, 30, 35]);
  });

  it('ภาษีไม่ลดเมื่อเงินได้เพิ่มทีละ 1 บาท รอบขอบทุกขั้น', () => {
    for (const [edge] of EDGES) {
      let prev = -1;
      for (let d = -3; d <= 3; d++) {
        const t = tax(B(edge + d + 160_000));
        expect(t).toBeGreaterThanOrEqual(prev);
        prev = t;
      }
    }
  });
});

describe('เงินได้ 0', () => {
  it('ไม่มีเงินได้: ทุกค่า 0 ภาษี 0 และไม่มี -0', () => {
    const r = computeSalaryTax({ ...base });
    expect(r.income).toBe(0);
    expect(r.expense).toBe(0);
    expect(r.netIncome).toBe(0);
    expect(r.tax).toBe(0);
    expect(Object.is(r.tax, -0)).toBe(false);
    expect(Object.is(r.balance, -0)).toBe(false);
    expect(r.balanceKind).toBe('even');
    expect(r.brackets.every((b) => b.amountInBracket === 0)).toBe(true);
  });
  it('ไม่มีเงินได้ + ขอค่าลดหย่อนทุกช่อง: ค่าลดหย่อนที่ขึ้นกับเงินได้ (30%/15%/10%) เป็น 0 ภาษี 0', () => {
    const r = computeSalaryTax({ ...base, rmfPaid: B(100_000), thaiEsgPaid: B(100_000), pensionInsurancePaid: B(100_000), donationPaid: B(100_000) });
    expect(r.tax).toBe(0);
    for (const k of ['rmf', 'thaiEsg', 'pensionInsurance', 'donation']) expect(r.deductions.find((d) => d.key === k)!.allowed).toBe(0);
  });
  it('เงินได้ 1 สตางค์และ 1 บาท: ภาษี 0 สุทธิ 0', () => {
    expect(tax(1)).toBe(0);
    expect(tax(B(1))).toBe(0);
  });
  it('เงินได้พอดีที่สุทธิเริ่มเป็นบวก: เงินเดือน 160,000 → สุทธิ 0 · 160,001 บาท ยังเหมา 50% (เพราะต่ำกว่า 200,000)', () => {
    // เงินเดือน 160,001: เหมา 80,000.5 → ปัดครึ่งขึ้น 80,001 (ตามสตางค์) ลดหย่อน 60,000 → สุทธิ ต่ำกว่า 150,000 ภาษี 0
    expect(tax(B(160_001))).toBe(0);
  });
});
