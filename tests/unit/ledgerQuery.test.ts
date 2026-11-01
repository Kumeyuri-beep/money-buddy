import { describe, expect, it } from 'vitest';
import { thaiDayLabel, thaiMonthKeyLabel } from '../../src/app/dates';
import { buildEntry, entryToForm, type EntryForm } from '../../src/app/entryForm';
import {
  ALL_FILTER,
  entryDetail,
  groupByDate,
  monthsWithEntries,
  queryLedger,
  type LedgerFilter,
} from '../../src/app/ledgerQuery';
import { buildInitialLedger } from '../../src/app/setup';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Entry } from '../../src/domain/ledger/types';

const { accounts, entries: opening } = buildInitialLedger(
  [
    { name: 'CashFlow', opening: '5408.41' },
    { name: 'Mainframe', opening: '10200' },
    { name: 'Vault Zero', opening: '5000' },
  ],
  '2026-10-31',
);

const make = (id: string, f: Partial<EntryForm>): Entry =>
  createEntry(
    accounts,
    buildEntry(
      accounts,
      { kind: 'expense', date: '2026-11-02', amount: '65', walletId: 'wallet-1', counterId: 'expense-food', memo: '', ...f },
      id,
    ),
  );

const coffee = make('coffee', { memo: 'กาแฟ Amazon', date: '2026-11-02' });
const salary = make('salary', { kind: 'income', walletId: 'wallet-2', counterId: 'income-salary', amount: '17000', date: '2026-11-01' });
const toVault = make('vault', { kind: 'transfer', walletId: 'wallet-2', counterId: 'wallet-3', amount: '2500', date: '2026-11-01' });
const rent = make('rent', { counterId: 'expense-housing', walletId: 'wallet-2', amount: '4300', date: '2026-10-31', memo: 'ค่าห้อง ต.ค.' });
const lunch = make('lunch', { memo: 'ข้าวมันไก่', date: '2026-11-02', amount: '50' });

// เรียงตามวันที่เหมือน loadLedger (ภายในวันเดียวกันตามลำดับที่เพิ่ม)
const all: Entry[] = [...opening, rent, salary, toVault, coffee, lunch];

const q = (patch: Partial<LedgerFilter>) => queryLedger(accounts, all, { ...ALL_FILTER, ...patch });
const ids = (patch: Partial<LedgerFilter>) => q(patch).map((r) => r.entry.id);

describe('queryLedger: เรียงและกรอง', () => {
  it('ใหม่สุดก่อน และวันเดียวกันรายการที่เพิ่มทีหลังอยู่บน', () => {
    expect(ids({})).toEqual([
      'lunch',
      'coffee',
      'vault',
      'salary',
      'rent',
      'opening-wallet-3',
      'opening-wallet-2',
      'opening-wallet-1',
    ]);
  });

  it('กรองตามเดือน', () => {
    expect(ids({ month: '2026-11' })).toEqual(['lunch', 'coffee', 'vault', 'salary']);
    expect(ids({ month: '2026-12' })).toEqual([]);
  });

  it('กรองตามประเภท', () => {
    expect(ids({ kind: 'expense' })).toEqual(['lunch', 'coffee', 'rent']);
    expect(ids({ kind: 'income' })).toEqual(['salary']);
    expect(ids({ kind: 'transfer', month: '2026-11' })).toEqual(['vault']);
  });

  it('กรอง "โอนเงิน" ไม่รวมยอดยกมา (ยอดยกมาไม่ใช่การโอน)', () => {
    expect(ids({ kind: 'transfer' })).toEqual(['vault']);
    expect(ids({ accountId: 'wallet-3' })).toEqual(['vault', 'opening-wallet-3']); // ไม่กรองประเภท ยังเห็นยอดยกมา
  });

  it('กรองตามกระเป๋าหรือหมวด (นับทั้งต้นทางและปลายทางของการโอน)', () => {
    expect(ids({ accountId: 'wallet-3', month: '2026-11' })).toEqual(['vault']);
    expect(ids({ accountId: 'expense-food' })).toEqual(['lunch', 'coffee']);
    expect(ids({ accountId: 'wallet-2', month: '2026-11' })).toEqual(['vault', 'salary']);
  });

  it('ค้นหาในบันทึกและชื่อบัญชี ไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างหัวท้าย', () => {
    expect(ids({ text: '  amazon ' })).toEqual(['coffee']);
    expect(ids({ text: 'อาหาร' })).toEqual(['lunch', 'coffee']);
    expect(ids({ text: 'vault zero', month: '2026-11' })).toEqual(['vault']);
    expect(ids({ text: 'ไม่มีคำนี้' })).toEqual([]);
  });

  it('รวมหลายตัวกรองพร้อมกัน', () => {
    expect(ids({ month: '2026-11', kind: 'expense', accountId: 'wallet-1', text: 'ข้าว' })).toEqual(['lunch']);
  });
});

describe('queryLedger: ข้อมูลที่แสดง', () => {
  it('จำนวนเงิน คำอธิบายรอง และสิทธิ์แก้ไข', () => {
    const rows = new Map(q({}).map((r) => [r.entry.id, r]));
    expect(rows.get('coffee')).toMatchObject({ kind: 'expense', amountText: '−฿65.00', detail: 'อาหาร, จาก CashFlow', editable: true });
    expect(rows.get('salary')).toMatchObject({ kind: 'income', amountText: '+฿17,000.00', detail: 'เงินเดือน, เข้า Mainframe' });
    expect(rows.get('vault')).toMatchObject({ kind: 'transfer', amountText: '฿2,500.00', detail: 'Mainframe ไป Vault Zero' });
    expect(rows.get('opening-wallet-1')).toMatchObject({ detail: 'ยอดยกมา', editable: false });
  });

  it('รายการหลายบรรทัด (เช่น งวดหนี้) แสดงชื่อทุกบัญชี', () => {
    const multi = createEntry(accounts, {
      id: 'multi',
      date: '2026-11-03',
      memo: 'งวดพิเศษ',
      lines: [
        { accountId: 'expense-interest', amount: 680 },
        { accountId: 'expense-other', amount: 320 },
        { accountId: 'wallet-2', amount: -1000 },
      ],
    });
    expect(entryDetail(accounts, multi)).toBe('ดอกเบี้ย, อื่นๆ, Mainframe');
  });
});

describe('entryToForm: แปลงกลับเพื่อแก้ไข', () => {
  it.each([
    ['รายจ่าย', coffee],
    ['รายรับ', salary],
    ['โอนเงิน', toVault],
  ])('%s: แปลงกลับแล้วสร้างใหม่ได้รายการเดิมทุกบรรทัด', (_name, entry) => {
    const form = entryToForm(accounts, entry);
    expect(form).not.toBeNull();
    const rebuilt = createEntry(accounts, buildEntry(accounts, form!, entry.id));
    expect(rebuilt.lines).toEqual(entry.lines);
    expect(rebuilt.memo).toBe(entry.memo);
    expect(rebuilt.date).toBe(entry.date);
  });

  it('จำนวนเงินแสดงเป็นบาท', () => {
    expect(entryToForm(accounts, salary)?.amount).toBe('17,000.00');
    expect(entryToForm(accounts, coffee)?.amount).toBe('65.00');
  });

  it('ยอดยกมาและรายการหลายบรรทัดแก้ผ่านฟอร์มไม่ได้', () => {
    expect(entryToForm(accounts, opening[0]!)).toBeNull();
    const multi = createEntry(accounts, {
      id: 'm',
      date: '2026-11-03',
      memo: '',
      lines: [
        { accountId: 'expense-interest', amount: 680 },
        { accountId: 'expense-other', amount: 320 },
        { accountId: 'wallet-2', amount: -1000 },
      ],
    });
    expect(entryToForm(accounts, multi)).toBeNull();
  });
});

describe('ตัวช่วยหน้ารายการ', () => {
  it('monthsWithEntries ใหม่สุดก่อน ไม่ซ้ำ', () => {
    expect(monthsWithEntries(all)).toEqual(['2026-11', '2026-10']);
    expect(monthsWithEntries([])).toEqual([]);
  });
  it('groupByDate รวมแถววันเดียวกันโดยคงลำดับ', () => {
    const groups = groupByDate(q({ month: '2026-11' }));
    expect(groups.map((g) => [g.date, g.rows.map((r) => r.entry.id)])).toEqual([
      ['2026-11-02', ['lunch', 'coffee']],
      ['2026-11-01', ['vault', 'salary']],
    ]);
  });
  it('ป้ายวันที่และเดือนภาษาไทย (พ.ศ.)', () => {
    expect(thaiMonthKeyLabel('2026-11')).toBe('พฤศจิกายน 2569');
    expect(thaiDayLabel('2026-11-01')).toContain('1');
    expect(thaiDayLabel('2026-11-01')).toContain('พ.ย.');
  });
});
