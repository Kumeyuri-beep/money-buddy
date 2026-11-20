import { describe, expect, it } from 'vitest';
import { bpsToDecimal, buildReportCsv, csvText, minorToDecimal, REPORT_ROWS } from '../../src/domain/invest/reportRows';
import type { ReportColumn, ReportTable } from '../../src/domain/invest/reportSeries';

const col = (key: string, o: Partial<ReportColumn> = {}): ReportColumn => ({
  key, begin: 100_000, end: 112_345, change: 12_345, profit: 12_345, profitBps: 1_069, price: 10_000, realized: 0, dividends: 2_345, fx: null, fees: -5, taxes: 0,
  purchases: 50_000, sales: 0, buys: 2, sells: 0, missing: null, needsRate: false, ...o,
});

describe('minorToDecimal / bpsToDecimal', () => {
  it('จำนวนเต็มล้วน: 0, เศษเล็ก, ติดลบ, ใหญ่', () => {
    expect(minorToDecimal(0)).toBe('0.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-5)).toBe('-0.05');
    expect(minorToDecimal(123_456)).toBe('1234.56');
    expect(bpsToDecimal(-38)).toBe('-0.38');
    expect(() => minorToDecimal(1.5)).toThrow(RangeError);
  });
});

describe('csvText (กัน formula injection)', () => {
  it("ขึ้นต้น = + - @ tab CR ถูก escape ด้วย '", () => {
    for (const s of ['=1+1', '+SUM(A1)', '-2', '@cmd', '\tx', '\rx']) expect(csvText(s).replace(/^"/, '').startsWith("'")).toBe(true);
    expect(csvText('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
  it("มีช่องว่าง/tab/ขึ้นบรรทัดนำหน้าแล้วตามด้วย = + - @ ก็ถูก escape ด้วย ' (Excel ตัดช่องว่างนำหน้าก่อนตีความสูตร)", () => {
    for (const s of [' =1+1', '  +SUM(A1)', ' \t-2', '\t @cmd', '   @x', ' =1', '\n=1', ' \r+1']) {
      const out = csvText(s).replace(/^"/, '');
      expect(out.startsWith("'"), JSON.stringify(s)).toBe(true);
    }
    expect(csvText(' =1+1')).toBe("' =1+1"); // ช่องว่างเดิมคงอยู่ แค่นำหน้าด้วย '
    expect(csvText('  =A,B')).toBe(`"'  =A,B"`); // มีคอมมา: ครอบเครื่องหมายคำพูดหลังใส่ '
  });
  it('ช่องว่างนำหน้าแต่ไม่ตามด้วยอักขระสูตร = ไม่เปลี่ยน · = ที่ไม่ได้อยู่ต้นข้อความ ไม่เปลี่ยน', () => {
    expect(csvText('  hello')).toBe('  hello');
    expect(csvText('a=b')).toBe('a=b');
    expect(csvText(' 5 - 3')).toBe(' 5 - 3');
    expect(csvText('')).toBe('');
    expect(csvText('   ')).toBe('   ');
  });
  it('ข้อความปกติไม่เปลี่ยน · มีคอมมา/ขึ้นบรรทัดถูกครอบ', () => {
    expect(csvText('Dividends')).toBe('Dividends');
    expect(csvText('a,b')).toBe('"a,b"');
    expect(csvText('a\nb')).toBe('"a\nb"');
  });
});

describe('buildReportCsv', () => {
  const table: ReportTable = {
    currency: 'USD',
    columns: [col('2026-01'), col('2026-02', { profit: null, fx: null, profitBps: null })],
    total: col('total', { profit: -50 }),
    incomplete: true,
    missing: ['price'],
  };
  const csv = buildReportCsv(table);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  it('BOM UTF-8 · สกุลตามที่เลือก · หัวคอลัมน์ครบ', () => {
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('Currency,USD');
    expect(lines[1]).toBe('Metric,2026-01,2026-02,Total');
  });
  it('ทุกแถวมีจำนวนช่องเท่ากัน · null เป็นช่องว่าง ไม่ใช่ 0 · ติดลบเป็นเลข', () => {
    expect(lines).toHaveLength(2 + REPORT_ROWS.length);
    expect(lines.find((l) => l.startsWith('Total profit (USD)'))).toBe('Total profit (USD),123.45,,-0.50');
    expect(lines.find((l) => l.startsWith('Total profit (%)'))).toBe('Total profit (%),10.69,,10.69');
    expect(lines.find((l) => l.startsWith('S&P 500 Market Performance (USD)'))).toBe('S&P 500 Market Performance (USD),,,');
  });
  it('ไม่มีเซลล์ข้อความขึ้นต้นด้วยเครื่องหมายสูตร', () => {
    for (const l of lines) expect(/^[=+\-@]/.test(l)).toBe(false);
  });
  it('มุมมอง THB ระบุสกุลในป้ายแถว', () => {
    expect(buildReportCsv({ ...table, currency: 'THB' })).toContain('Total profit (THB)');
  });
  it('Turnover = ซื้อ + ขาย', () => {
    const t = REPORT_ROWS.find((r) => r.id === 'turnover')!;
    expect(t.pick(col('x', { purchases: 700, sales: 300 }))).toBe(1_000);
  });
});

describe('ขอบเขตเพิ่ม', () => {
  it('minorToDecimal(-0) = "0.00" (ไม่มีเครื่องหมายลบ)', () => {
    expect(minorToDecimal(-0)).toBe('0.00');
  });
  it('Turnover เกินช่วงปลอดภัย → RangeError (ไม่เงียบ)', () => {
    const t = REPORT_ROWS.find((r) => r.id === 'turnover')!;
    expect(() => t.pick(col('x', { purchases: Number.MAX_SAFE_INTEGER, sales: 1 }))).toThrow(RangeError);
  });
});
