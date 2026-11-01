import { describe, expect, it } from 'vitest';
import { localIsoDate, monthRange } from '../../src/app/dates';
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

describe('วันที่ตามเวลาเครื่อง', () => {
  it('localIsoDate ใช้เวลาท้องถิ่น ไม่ใช่ UTC', () => {
    expect(localIsoDate(new Date(2026, 10, 1, 0, 30))).toBe('2026-11-01'); // เที่ยงคืนครึ่ง
    expect(localIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(localIsoDate(new Date(2028, 1, 29))).toBe('2028-02-29');
  });
  it('monthRange ครอบคลุมสิ้นเดือน', () => {
    expect(monthRange(new Date(2026, 10, 15))).toEqual({ from: '2026-11-01', to: '2026-11-31' });
    // ใช้ 31 เป็นขอบบนได้ เพราะวันที่จริงของเดือนที่สั้นกว่าไม่มีทางเกิน
    expect('2026-11-30' <= '2026-11-31').toBe(true);
    expect('2026-12-01' <= '2026-11-31').toBe(false);
  });
});
