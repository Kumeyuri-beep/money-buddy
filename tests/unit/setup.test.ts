import { describe, expect, it } from 'vitest';
import { monthRange, thaiIsoDate } from '../../src/app/dates';
import { buildInitialLedger, DEFAULT_WALLETS, SetupError } from '../../src/app/setup';
import { balanceOf, periodTotals } from '../../src/domain/ledger/balance';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';

const DAY = '2026-11-01';

describe('buildInitialLedger: เริ่มใหม่จากยอดคงเหลือวันนี้', () => {
  it('สร้างบัญชีและยอดยกมาที่สมดุล ผ่าน Integrity Check', () => {
    const ledger = buildInitialLedger(
      [
        { name: 'CashFlow', opening: '5,408.41' },
        { name: 'Mainframe', opening: '10200' },
        { name: 'Vault Zero', opening: '' },
      ],
      DAY,
    );
    expect(runIntegrityCheck(ledger.accounts, ledger.entries).ok).toBe(true);
    expect(ledger.entries).toHaveLength(2); // Vault ว่าง ไม่สร้างรายการ
    expect(balanceOf('wallet-1', ledger.entries)).toBe(540_841);
    expect(balanceOf('wallet-2', ledger.entries)).toBe(1_020_000);
    expect(balanceOf('wallet-3', ledger.entries)).toBe(0);
  });

  it('ยอดยกมาไม่ถูกนับเป็นรายรับหรือรายจ่าย', () => {
    const ledger = buildInitialLedger([{ name: 'A', opening: '1000' }], DAY);
    expect(periodTotals(ledger.accounts, ledger.entries, monthRange(new Date(2026, 10, 15)))).toMatchObject({
      income: 0,
      expense: 0,
    });
  });

  it('มีบัญชีหมวดรายรับรายจ่ายและยอดยกมาพร้อมใช้', () => {
    const { accounts } = buildInitialLedger([{ name: 'A', opening: '' }], DAY);
    const ids = accounts.map((a) => a.id);
    expect(ids).toContain('opening');
    expect(ids).toContain('income-salary');
    expect(ids).toContain('expense-interest');
    expect(new Set(ids).size).toBe(ids.length); // ไม่มี id ซ้ำ
  });

  it('ตัดช่องว่างหัวท้ายของชื่อ และค่าเริ่มต้น 3 กระเป๋าสร้างได้ (ยอดว่างหมด)', () => {
    const ledger = buildInitialLedger([{ name: '  กระเป๋าเงินสด  ', opening: ' 100 ' }], DAY);
    expect(ledger.accounts[0]?.name).toBe('กระเป๋าเงินสด');
    expect(balanceOf('wallet-1', ledger.entries)).toBe(10_000);

    const defaults = buildInitialLedger(DEFAULT_WALLETS, DAY);
    expect(defaults.entries).toHaveLength(0);
    expect(defaults.accounts.filter((a) => a.type === 'asset')).toHaveLength(3);
  });

  it.each([
    ['ไม่มีกระเป๋า', [], /อย่างน้อย 1/],
    ['ชื่อว่าง', [{ name: '  ', opening: '1' }], /ต้องมีชื่อ/],
    ['ชื่อซ้ำ (ไม่สนตัวพิมพ์เล็กใหญ่)', [{ name: 'Cash', opening: '' }, { name: 'cash', opening: '' }], /ซ้ำ/],
    ['ยอดอ่านไม่ได้', [{ name: 'A', opening: 'abc' }], /อ่านยอด/],
    ['ยอดติดลบ', [{ name: 'A', opening: '-5' }], /ติดลบ/],
  ])('ปฏิเสธ: %s', (_name, wallets, message) => {
    expect(() => buildInitialLedger(wallets, DAY)).toThrow(SetupError);
    expect(() => buildInitialLedger(wallets, DAY)).toThrow(message);
  });

  it('ปฏิเสธวันที่ที่ไม่มีอยู่จริง', () => {
    expect(() => buildInitialLedger([{ name: 'A', opening: '100' }], '2026-02-30')).toThrow(/วันที่/);
  });
});

describe('วันที่ตามเวลาประเทศไทย (R15: Asia/Bangkok ไม่ขึ้นกับเขตเวลาของเครื่อง)', () => {
  it('thaiIsoDate: ขอบเที่ยงคืนตามเวลาไทย (UTC+7)', () => {
    expect(thaiIsoDate(new Date('2026-11-30T16:59:59Z'))).toBe('2026-11-30');
    expect(thaiIsoDate(new Date('2026-11-30T17:00:00Z'))).toBe('2026-12-01'); // 00:00 ไทย
    expect(thaiIsoDate(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01'); // ข้ามปี
    expect(thaiIsoDate(new Date('2026-10-31T17:00:00Z'))).toBe('2026-11-01');
  });
  it('thaiIsoDate: วันที่ 29 ก.พ. ปีอธิกสุรทิน และ 1 มี.ค.', () => {
    expect(thaiIsoDate(new Date('2028-02-29T16:59:59Z'))).toBe('2028-02-29');
    expect(thaiIsoDate(new Date('2028-02-29T17:00:00Z'))).toBe('2028-03-01');
    expect(thaiIsoDate(new Date('2027-02-28T17:00:00Z'))).toBe('2027-03-01'); // ปีไม่อธิกสุรทิน
  });
  it('thaiIsoDate: เช้าตรู่ไทยที่ UTC ยังเป็นวันก่อน', () => {
    expect(thaiIsoDate(new Date('2026-11-01T00:30:00+07:00'))).toBe('2026-11-01');
    expect(thaiIsoDate(new Date('2026-11-01T00:00:00+07:00'))).toBe('2026-11-01');
    expect(thaiIsoDate(new Date('2026-10-31T23:59:59+07:00'))).toBe('2026-10-31');
  });
  it('thaiIsoDate: ปีต่ำกว่า 1000 ยังเป็นรูป YYYY-MM-DD (เติม 0 หน้าปี)', () => {
    expect(thaiIsoDate(new Date(Date.UTC(999, 0, 1, 12)))).toBe('0999-01-01');
  });
  it('monthRange ใช้เดือนตามเวลาไทย และครอบคลุมสิ้นเดือน', () => {
    expect(monthRange(new Date('2026-11-15T05:00:00Z'))).toEqual({ from: '2026-11-01', to: '2026-11-31' });
    expect(monthRange(new Date('2026-11-30T17:00:00Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    // ใช้ 31 เป็นขอบบนได้ เพราะวันที่จริงของเดือนที่สั้นกว่าไม่มีทางเกิน
    expect('2026-11-30' <= '2026-11-31').toBe(true);
    expect('2026-12-01' <= '2026-11-31').toBe(false);
  });
});
