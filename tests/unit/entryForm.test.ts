import { describe, expect, it } from 'vitest';
import { describeEntry } from '../../src/app/describe';
import { buildEntry, counterOptions, EntryFormError, walletOptions, type EntryForm } from '../../src/app/entryForm';
import { newId } from '../../src/app/ids';
import { buildInitialLedger } from '../../src/app/setup';
import { balanceOf, periodTotals } from '../../src/domain/ledger/balance';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Entry } from '../../src/domain/ledger/types';

const { accounts, entries: opening } = buildInitialLedger(
  [
    { name: 'CashFlow', opening: '5408.41' },
    { name: 'Mainframe', opening: '10200' },
    { name: 'Vault Zero', opening: '5000' },
  ],
  '2026-11-01',
);
const NOV = { from: '2026-11-01', to: '2026-11-31' };

const form = (patch: Partial<EntryForm>): EntryForm => ({
  kind: 'expense',
  date: '2026-11-02',
  amount: '65',
  walletId: 'wallet-1',
  counterId: 'expense-food',
  memo: '',
  ...patch,
});

/** สร้างผ่าน buildEntry แล้วผ่าน createEntry อีกชั้น เหมือนตอนบันทึกจริง */
const save = (f: EntryForm, id = 'x'): Entry => createEntry(accounts, buildEntry(accounts, f, id));

describe('buildEntry: รายจ่าย', () => {
  it('ลดเงินในกระเป๋าและนับเป็นรายจ่าย ใช้ชื่อหมวดเป็นบันทึกเมื่อไม่ได้พิมพ์', () => {
    const e = save(form({ amount: '65.50' }));
    expect(e.memo).toBe('อาหาร');
    expect(e.source).toBe('manual');
    const all = [...opening, e];
    expect(balanceOf('wallet-1', all)).toBe(540_841 - 6550);
    expect(periodTotals(accounts, all, NOV)).toMatchObject({ income: 0, expense: 6550 });
    expect(describeEntry(accounts, e)).toEqual({ kind: 'expense', amountText: '−฿65.50' });
  });

  it('ใช้บันทึกที่ผู้ใช้พิมพ์ (ตัดช่องว่างหัวท้าย)', () => {
    expect(save(form({ memo: '  กาแฟ Amazon  ' })).memo).toBe('กาแฟ Amazon');
  });
});

describe('buildEntry: รายรับ', () => {
  it('เพิ่มเงินในกระเป๋าและนับเป็นรายรับ', () => {
    const e = save(form({ kind: 'income', walletId: 'wallet-2', counterId: 'income-salary', amount: '17,000' }));
    const all = [...opening, e];
    expect(balanceOf('wallet-2', all)).toBe(1_020_000 + 1_700_000);
    expect(periodTotals(accounts, all, NOV)).toMatchObject({ income: 1_700_000, expense: 0 });
    expect(e.memo).toBe('เงินเดือน');
    expect(describeEntry(accounts, e).amountText).toBe('+฿17,000.00');
  });
});

describe('buildEntry: โอนเงิน (R4)', () => {
  it('ย้ายเงินระหว่างกระเป๋า ยอดรวมไม่เปลี่ยน และไม่นับเป็นรายรับหรือรายจ่าย', () => {
    const e = save(form({ kind: 'transfer', walletId: 'wallet-2', counterId: 'wallet-3', amount: '2500' }));
    const all = [...opening, e];
    expect(balanceOf('wallet-2', all)).toBe(1_020_000 - 250_000);
    expect(balanceOf('wallet-3', all)).toBe(500_000 + 250_000);
    const total = ['wallet-1', 'wallet-2', 'wallet-3'].reduce((s, id) => s + balanceOf(id, all), 0);
    expect(total).toBe(540_841 + 1_020_000 + 500_000);
    expect(periodTotals(accounts, all, NOV)).toMatchObject({ income: 0, expense: 0 });
    expect(e.memo).toBe('โอน Mainframe ไป Vault Zero');
    expect(describeEntry(accounts, e)).toEqual({ kind: 'transfer', amountText: '฿2,500.00' });
  });
});

describe('buildEntry: ข้อผิดพลาดที่ผู้ใช้เข้าใจได้', () => {
  it.each<[string, Partial<EntryForm>, RegExp]>([
    ['จำนวนว่าง', { amount: '' }, /อ่านจำนวนเงินไม่ได้/],
    ['จำนวนเป็นตัวอักษร', { amount: 'หกสิบห้า' }, /อ่านจำนวนเงินไม่ได้/],
    ['จำนวนเป็น 0', { amount: '0' }, /มากกว่า 0/],
    ['จำนวนติดลบ', { amount: '-65' }, /มากกว่า 0/],
    ['เศษน้อยกว่าครึ่งสตางค์ปัดเป็น 0', { amount: '0.004' }, /มากกว่า 0/],
    ['จำนวนใหญ่เกิน', { amount: '999999999999999999' }, /ใหญ่เกินไป/],
    ['วันที่ไม่มีจริง', { date: '2026-02-30' }, /วันที่/],
    ['ไม่ได้เลือกกระเป๋า', { walletId: '' }, /เลือกกระเป๋าเงิน/],
    ['เลือกหมวดรายจ่ายเป็นกระเป๋า', { counterId: 'wallet-2' }, /เลือกหมวดรายจ่าย/],
    ['รายรับแต่เลือกหมวดรายจ่าย', { kind: 'income', counterId: 'expense-food' }, /เลือกหมวดรายรับ/],
    ['โอนเข้ากระเป๋าเดิม', { kind: 'transfer', counterId: 'wallet-1' }, /ต้องต่างกัน/],
    ['โอนแต่ไม่ได้เลือกปลายทาง', { kind: 'transfer', counterId: '' }, /เลือกกระเป๋าปลายทาง/],
    ['ใช้บัญชียอดยกมาเป็นกระเป๋า', { walletId: 'opening' }, /เลือกกระเป๋าเงิน/],
  ])('%s', (_name, patch, message) => {
    expect(() => buildEntry(accounts, form(patch), 'x')).toThrow(EntryFormError);
    expect(() => buildEntry(accounts, form(patch), 'x')).toThrow(message);
  });
});

describe('ตัวเลือกในฟอร์ม', () => {
  it('walletOptions มีเฉพาะกระเป๋าบาทที่ยังใช้งาน', () => {
    const withArchived = [...accounts, { id: 'old', type: 'asset' as const, name: 'เก่า', currency: 'THB', archived: true }];
    expect(walletOptions(withArchived).map((a) => a.id)).toEqual(['wallet-1', 'wallet-2', 'wallet-3']);
  });
  it('counterOptions เปลี่ยนตามประเภท และการโอนตัดกระเป๋าต้นทางออก', () => {
    expect(counterOptions(accounts, 'expense', 'wallet-1').every((a) => a.type === 'expense')).toBe(true);
    expect(counterOptions(accounts, 'income', 'wallet-1').every((a) => a.type === 'income')).toBe(true);
    expect(counterOptions(accounts, 'transfer', 'wallet-1').map((a) => a.id)).toEqual(['wallet-2', 'wallet-3']);
  });
});

describe('newId', () => {
  it('ขึ้นต้นด้วย prefix และไม่ซ้ำกัน', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('e')));
    expect(ids.size).toBe(200);
    expect([...ids].every((id) => id.startsWith('e-'))).toBe(true);
  });
});
