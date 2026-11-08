import { describe, expect, it } from 'vitest';
import { buildInitialLedger, SetupError } from '../../src/app/setup';
import { billProblem } from '../../src/domain/bills/schedule';
import type { Bill } from '../../src/domain/bills/types';
import { createEntry, LedgerError } from '../../src/domain/ledger/entry';
import { accountProblem, hasDbInvalidChars, isSupportedEntryDate, MAX_LINES_PER_ENTRY, textLength } from '../../src/domain/ledger/limits';
import type { Account } from '../../src/domain/ledger/types';

/** ข้อจำกัดเหล่านี้ต้องตรงกับฐานข้อมูล supabase/migrations/20261108000000_m2a_schema.sql (decisions 2026-11-08-m2-a ข้อ B1-B3) */
const MAX = Number.MAX_SAFE_INTEGER;

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'w1', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'food', currency: 'THB' },
];
const lines = (n: number) => [
  { accountId: 'food', amount: n },
  { accountId: 'w1', amount: -n },
];
const base = { id: 'e1', date: '2026-11-01', memo: '', lines: lines(100) };

describe('textLength นับเป็นจุดรหัส (เหมือน char_length ของ Postgres)', () => {
  it('อีโมจิคู่ surrogate นับเป็น 1', () => {
    expect(textLength('😀')).toBe(1);
    expect(textLength('ข้าว')).toBe(4);
    expect(textLength('')).toBe(0);
  });
});

describe('createEntry: ข้อความและวันที่ตรงกับฐานข้อมูล', () => {
  it('memo ยาว 2000 ผ่าน 2001 ปฏิเสธ', () => {
    expect(() => createEntry(accounts, { ...base, memo: 'x'.repeat(2000) })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, memo: 'x'.repeat(2001) })).toThrow(LedgerError);
  });
  it('memo นับเป็นจุดรหัส: 2000 อีโมจิผ่าน', () => {
    expect(() => createEntry(accounts, { ...base, memo: '😀'.repeat(2000) })).not.toThrow();
  });
  it('id ยาว 100 ผ่าน 101 ปฏิเสธ ว่างปฏิเสธ', () => {
    expect(() => createEntry(accounts, { ...base, id: 'a'.repeat(100) })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, id: 'a'.repeat(101) })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, id: '' })).toThrow(LedgerError);
  });
  it('groupId ต้องยาว 1-100 เมื่อมี', () => {
    expect(() => createEntry(accounts, { ...base, groupId: 'g' })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, groupId: 'g'.repeat(100) })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, groupId: '' })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, groupId: 'g'.repeat(101) })).toThrow(LedgerError);
  });
  it('วันที่ต้องอยู่ในช่วง 1900-01-01 ถึง 2999-12-31', () => {
    expect(() => createEntry(accounts, { ...base, date: '1900-01-01' })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, date: '2999-12-31' })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, date: '1899-12-31' })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, date: '3000-01-01' })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, date: '0100-01-01' })).toThrow(LedgerError);
  });
  it('วันที่ปีอธิกสุรทินยังผ่าน และวันที่ไม่มีจริงยังถูกปฏิเสธ', () => {
    expect(() => createEntry(accounts, { ...base, date: '2028-02-29' })).not.toThrow();
    expect(() => createEntry(accounts, { ...base, date: '2027-02-29' })).toThrow(LedgerError);
  });
  it('isSupportedEntryDate', () => {
    expect(isSupportedEntryDate('2026-11-04')).toBe(true);
    expect(isSupportedEntryDate('2026-13-01')).toBe(false);
    expect(isSupportedEntryDate('3000-01-01')).toBe(false);
    expect(isSupportedEntryDate('')).toBe(false);
  });
});

describe('อักขระที่ฐานข้อมูลเก็บไม่ได้ และชนิดข้อมูลผิด', () => {
  it('hasDbInvalidChars: NUL และ surrogate เดี่ยว', () => {
    expect(hasDbInvalidChars('ข้าว\u0000')).toBe(true);
    expect(hasDbInvalidChars('a\ud800b')).toBe(true);
    expect(hasDbInvalidChars('a\udc00b')).toBe(true);
    expect(hasDbInvalidChars('😀')).toBe(false); // คู่ surrogate ปกติ
    expect(hasDbInvalidChars('ข้าวมันไก่ 55')).toBe(false);
  });
  it('memo/id/ชื่อที่มี NUL หรือ surrogate เดี่ยว ถูกปฏิเสธ', () => {
    expect(() => createEntry(accounts, { ...base, memo: 'ข้าว\u0000' })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, memo: 'a\ud800' })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, id: 'e\u00001' })).toThrow(LedgerError);
    expect(accountProblem({ id: 'a', type: 'asset', name: 'x\u0000', currency: 'THB' })).not.toBeNull();
  });
  it('memo ที่ไม่ใช่ข้อความ (จาก JS/นำเข้า) ถูกปฏิเสธด้วย LedgerError ไม่ใช่ TypeError', () => {
    expect(() => createEntry(accounts, { ...base, memo: undefined as unknown as string })).toThrow(LedgerError);
    expect(() => createEntry(accounts, { ...base, memo: 5 as unknown as string })).toThrow(LedgerError);
  });
  it('memo ว่างผ่าน', () => {
    expect(() => createEntry(accounts, { ...base, memo: '' })).not.toThrow();
  });
  it('จำนวนบรรทัดไม่เกิน 32767 (lines.idx เป็น smallint)', () => {
    const pairs = Array.from({ length: (MAX_LINES_PER_ENTRY - 1) / 2 }, () => lines(1)).flat();
    expect(pairs.length).toBe(MAX_LINES_PER_ENTRY - 1);
    expect(() => createEntry(accounts, { ...base, lines: pairs })).not.toThrow();
    const over = Array.from({ length: (MAX_LINES_PER_ENTRY + 1) / 2 }, () => lines(1)).flat();
    expect(over.length).toBe(MAX_LINES_PER_ENTRY + 1);
    expect(() => createEntry(accounts, { ...base, lines: over })).toThrow(LedgerError);
  });
});

describe('createEntry: ผลรวมฝั่งเดบิตต่อสกุลเงิน ≤ 2^53−1 (B1)', () => {
  it('หักกลบทันทีที่ขอบ ผ่าน', () => {
    expect(() => createEntry(accounts, { ...base, lines: lines(MAX) })).not.toThrow();
  });
  it('หักกลบทีละบรรทัดแต่ผลรวมฝั่งเดบิตเกิน ปฏิเสธ (DB ปฏิเสธเช่นกัน)', () => {
    const over = [...lines(MAX), ...lines(1)];
    expect(() => createEntry(accounts, { ...base, lines: over })).toThrow(LedgerError);
  });
  it('สองสกุลเงินที่แต่ละสกุลไม่เกิน ผ่าน (ไม่บวกข้ามสกุล)', () => {
    const two: Account[] = [...accounts, { id: 'u1', type: 'asset', name: 'u1', currency: 'USD' }, { id: 'u2', type: 'equity', name: 'u2', currency: 'USD' }];
    const ls = [...lines(MAX), { accountId: 'u1', amount: MAX }, { accountId: 'u2', amount: -MAX }];
    expect(() => createEntry(two, { ...base, lines: ls })).not.toThrow();
  });
  it('หลายบรรทัดเล็กที่รวมกันไม่เกิน ผ่าน', () => {
    const many = [...lines(1), ...lines(2), ...lines(3)];
    expect(() => createEntry(accounts, { ...base, lines: many })).not.toThrow();
  });
});

describe('accountProblem: ตรงกับตาราง accounts', () => {
  const ok: Account = { id: 'a1', type: 'asset', name: 'กระเป๋า', currency: 'THB', sortOrder: 1 };
  it('บัญชีปกติผ่าน', () => {
    expect(accountProblem(ok)).toBeNull();
    expect(accountProblem({ ...ok, currency: 'USD', sortOrder: undefined })).toBeNull();
    expect(accountProblem({ ...ok, currency: 'USDT2' })).toBeNull();
  });
  it('currency ตัวพิมพ์เล็ก/สั้น/ยาว/อักขระแปลก ถูกปฏิเสธ', () => {
    for (const currency of ['thb', 'T', 'A'.repeat(11), 'US-D', '', 'ไทย']) {
      expect(accountProblem({ ...ok, currency })).not.toBeNull();
    }
    expect(accountProblem({ ...ok, currency: 'AB' })).toBeNull();
    expect(accountProblem({ ...ok, currency: 'A'.repeat(10) })).toBeNull();
  });
  it('ชื่อ 1-200 และ id 1-100', () => {
    expect(accountProblem({ ...ok, name: '' })).not.toBeNull();
    expect(accountProblem({ ...ok, name: 'n'.repeat(200) })).toBeNull();
    expect(accountProblem({ ...ok, name: 'n'.repeat(201) })).not.toBeNull();
    expect(accountProblem({ ...ok, id: '' })).not.toBeNull();
    expect(accountProblem({ ...ok, id: 'i'.repeat(100) })).toBeNull();
    expect(accountProblem({ ...ok, id: 'i'.repeat(101) })).not.toBeNull();
  });
  it('ชนิดบัญชีแปลก และ sortOrder ที่ไม่ใช่จำนวนเต็ม ถูกปฏิเสธ', () => {
    expect(accountProblem({ ...ok, type: 'bogus' as Account['type'] })).not.toBeNull();
    expect(accountProblem({ ...ok, sortOrder: 1.5 })).not.toBeNull();
    expect(accountProblem({ ...ok, sortOrder: Number.NaN })).not.toBeNull();
    expect(accountProblem({ ...ok, sortOrder: 2 ** 31 })).not.toBeNull(); // เกิน integer ของ Postgres
    expect(accountProblem({ ...ok, sortOrder: -5 })).toBeNull();
    expect(accountProblem({ ...ok, sortOrder: 2 ** 31 - 1 })).toBeNull();
    expect(accountProblem({ ...ok, sortOrder: -(2 ** 31) })).toBeNull();
    expect(accountProblem({ ...ok, sortOrder: -(2 ** 31) - 1 })).not.toBeNull();
  });
});

describe('buildInitialLedger ตรวจบัญชีก่อนสร้าง', () => {
  it('ชื่อกระเป๋า 200 ผ่าน 201 ปฏิเสธด้วย SetupError', () => {
    expect(() => buildInitialLedger([{ name: 'n'.repeat(200), opening: '' }], '2026-11-04')).not.toThrow();
    expect(() => buildInitialLedger([{ name: 'n'.repeat(201), opening: '' }], '2026-11-04')).toThrow(SetupError);
  });
  it('บัญชีที่สร้างทั้งหมดผ่าน accountProblem', () => {
    const ledger = buildInitialLedger([{ name: 'A', opening: '100' }, { name: 'B', opening: '' }], '2026-11-04');
    for (const a of ledger.accounts) expect(accountProblem(a)).toBeNull();
  });
});

describe('billProblem: ชื่อ/รหัสตรงกับตาราง bills', () => {
  const bill: Bill = { id: 'b1', name: 'ค่าเน็ต', amount: 59900, dueDay: 5 };
  it('ปกติผ่าน', () => {
    expect(billProblem(bill)).toBeNull();
    expect(billProblem({ ...bill, name: 'n'.repeat(200) })).toBeNull();
  });
  it('ชื่อว่าง/ยาวเกิน และ id ว่าง/ยาวเกิน มีปัญหา', () => {
    expect(billProblem({ ...bill, name: '' })).not.toBeNull();
    expect(billProblem({ ...bill, name: 'n'.repeat(201) })).not.toBeNull();
    expect(billProblem({ ...bill, id: '' })).not.toBeNull();
    expect(billProblem({ ...bill, id: 'i'.repeat(101) })).not.toBeNull();
  });
  it('ยอดเท่า 2^53−1 ผ่าน 0 และติดลบมีปัญหา', () => {
    expect(billProblem({ ...bill, amount: MAX })).toBeNull();
    expect(billProblem({ ...bill, amount: 0 })).not.toBeNull();
    expect(billProblem({ ...bill, amount: -1 })).not.toBeNull();
  });
});
