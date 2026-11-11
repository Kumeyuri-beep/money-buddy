import { describe, expect, it } from 'vitest';
import { buildSafeToSpend } from '../../src/app/billsOverview';
import { entryToForm } from '../../src/app/entryForm';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { periodTotals } from '../../src/domain/ledger/balance';
import { createEntry } from '../../src/domain/ledger/entry';
import { cashBalance, incomeChannels, runwayTenths } from '../../src/domain/ledger/overview';
import type { Account, Entry } from '../../src/domain/ledger/types';

const TODAY = '2026-11-10';
const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'inv1', type: 'asset', name: 'กองทุน ก', currency: 'THB', kind: 'investment' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'div', type: 'income', name: 'ปันผล', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
];

const mk = (id: string, date: string, source: Entry['source'], lines: [string, number][]): Entry =>
  createEntry(accounts, { id, date, memo: id, source, lines: lines.map(([accountId, amount]) => ({ accountId, amount })) });

const entries: Entry[] = [
  mk('sys', '2026-11-01', 'system', [['w1', 100_000], ['open', -100_000]]),
  mk('buy', '2026-11-05', 'manual', [['inv1', 50_000], ['w1', -50_000]]), // ซื้อกองทุน = โอน ไม่ใช่รายจ่าย
];

const backup = (overrides: Record<string, unknown> = {}, accs: unknown = accounts): string =>
  JSON.stringify({ schemaVersion: 2, exportedAt: '2026-11-08T10:00:00.000Z', accounts: accs, entries, bills: [], settings: {}, ...overrides });

describe('ไฟล์สำรองคงป้ายบัญชีลงทุน (ไม่ให้กลายเป็นเงินสดตอนนำเข้า)', () => {
  it('round-trip: ส่งออก → ตรวจ → ได้ kind เดิม และเงินสดเท่าเดิม', () => {
    const r = parseBackup(JSON.stringify(JSON.parse(backup())), TODAY);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.accounts.find((a) => a.id === 'inv1')?.kind).toBe('investment');
    expect('kind' in r.data.accounts.find((a) => a.id === 'w1')!).toBe(false);
    expect(cashBalance(r.data.accounts, r.data.entries, TODAY)).toBe(50_000);
  });
  it('kind แปลกถูกปฏิเสธ · บัญชีลงทุนที่ไม่ใช่สินทรัพย์ถูกปฏิเสธ', () => {
    for (const bad of [
      accounts.map((a) => (a.id === 'inv1' ? { ...a, kind: 'weird' } : a)),
      accounts.map((a) => (a.id === 'food' ? { ...a, kind: 'investment' } : a)),
    ]) {
      const r = parseBackup(backup({ entries: [] }, bad), TODAY);
      expect(r.ok).toBe(false);
    }
  });
  it('บิลที่ตั้งบัญชีลงทุนเป็นกระเป๋าจ่ายถูกปฏิเสธ', () => {
    const bills = [{ id: 'b1', name: 'บิล', amount: 100, dueDay: 5, walletId: 'inv1', categoryId: 'food' }];
    const r = parseBackup(backup({ bills }), TODAY);
    expect(r.ok).toBe(false);
    const ok = parseBackup(backup({ bills: [{ ...bills[0]!, walletId: 'w1' }] }), TODAY);
    expect(ok.ok).toBe(true);
  });
});

describe('บัญชีลงทุนในรายงาน (R4/R6/R17)', () => {
  it('SAFE-TO-SPEND: เพิ่มบัญชีลงทุนที่มียอดแล้วผลต้องเท่ากับก่อนเพิ่ม (มีบิลและเงินสำรองด้วย)', () => {
    const noInvAccounts = accounts.filter((a) => a.id !== 'inv1');
    const noInvEntries: Entry[] = [
      createEntry(noInvAccounts, { id: 'sys', date: '2026-11-01', memo: 'o', source: 'system', lines: [{ accountId: 'w1', amount: 50_000 }, { accountId: 'open', amount: -50_000 }] }),
    ];
    const finance = { bills: [{ id: 'b1', name: 'บิล', amount: 10_000, dueDay: 20 }], settings: { payDay: 25, monthlySavingsGoal: 5_000 } };
    const before = buildSafeToSpend(noInvAccounts, noInvEntries, finance, TODAY);
    const after = buildSafeToSpend(accounts, entries, finance, TODAY);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ kind: 'value', available: 35_000 });
  });

  it('RUNWAY: ใช้เงินสดที่ไม่รวมบัญชีลงทุน (50,000 ÷ 10,000/เดือน = 5.0 เดือน)', () => {
    expect(runwayTenths(cashBalance(accounts, entries, TODAY), [10_000, 10_000])).toBe(50);
  });

  it('ซื้อกองทุน (กระเป๋า → บัญชีลงทุน) ไม่เป็นรายรับหรือรายจ่าย', () => {
    const t = periodTotals(accounts, entries, { from: '2026-11-01', to: '2026-11-30' });
    expect(t).toMatchObject({ income: 0, expense: 0, net: 0 });
  });

  it('ปันผลเข้าบัญชีลงทุนไม่ถูกนับเป็น "กระเป๋ารับรายรับสูงสุด"', () => {
    const more = [
      ...entries,
      mk('d1', '2026-11-08', 'manual', [['inv1', 9_000], ['div', -9_000]]),
      mk('s1', '2026-11-09', 'manual', [['w1', 3_000], ['salary', -3_000]]),
    ];
    const c = incomeChannels(accounts, more, '2026-11');
    expect(c.topWalletId).toBe('w1');
    expect(c.topWalletAmount).toBe(3_000);
  });

  it('แก้รายการโอนไปบัญชีลงทุนผ่านฟอร์มไม่ได้ (คืน null แทนฟอร์มที่บันทึกไม่ได้)', () => {
    expect(entryToForm(accounts, entries[1]!)).toBeNull();
  });
});
