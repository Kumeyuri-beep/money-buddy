import { describe, expect, it } from 'vitest';
import { walletOptions } from '../../src/app/entryForm';
import { buildSafeToSpend } from '../../src/app/billsOverview';
import { createEntry } from '../../src/domain/ledger/entry';
import { isCashWallet } from '../../src/domain/ledger/accountKind';
import { cashBalance, netWorthAt } from '../../src/domain/ledger/overview';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { walletShares } from '../../src/domain/ledger/walletShares';
import { accountToJson, rowToAccount } from '../../src/storage/supabaseRepository';

const base: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
];
const withInvest: Account[] = [...base, { id: 'inv1', type: 'asset', name: 'กองทุน ก', currency: 'THB', kind: 'investment' }];

const entries = (accounts: Account[]): Entry[] => [
  createEntry(accounts, { id: 'sys', date: '2026-11-01', memo: 'o', source: 'system', lines: [{ accountId: 'w1', amount: 100_000 }, { accountId: 'open', amount: -100_000 }] }),
  // ซื้อกองทุน: โอนเงิน 50,000 สตางค์จากกระเป๋าไปบัญชีลงทุน (ไม่ใช่รายจ่าย)
  createEntry(accounts, { id: 'buy', date: '2026-11-05', memo: 'ซื้อ', source: 'manual', lines: [{ accountId: 'inv1', amount: 50_000 }, { accountId: 'w1', amount: -50_000 }] }),
];

describe('บัญชีลงทุน (kind = investment) ไม่นับเป็นเงินสด (R17)', () => {
  it('isCashWallet: เฉพาะ asset THB ที่ใช้งานอยู่และไม่ใช่บัญชีลงทุน', () => {
    expect(isCashWallet(base[0]!)).toBe(true);
    expect(isCashWallet({ ...base[0]!, kind: 'normal' })).toBe(true);
    expect(isCashWallet(withInvest[2]!)).toBe(false);
    expect(isCashWallet({ ...base[0]!, archived: true })).toBe(false);
    expect(isCashWallet({ ...base[0]!, currency: 'USD' })).toBe(false);
    expect(isCashWallet(base[1]!)).toBe(false);
  });

  it('cashBalance: เงินที่ย้ายไปบัญชีลงทุนไม่อยู่ในเงินสด (เหลือ 50,000) และบัญชีลงทุนที่มียอดไม่ถูกนับ', () => {
    expect(cashBalance(withInvest, entries(withInvest), '2026-11-10')).toBe(50_000);
  });

  it('ถ้าบัญชีลงทุนไม่มีป้าย (ข้อมูลเดิม) จะถูกนับเป็นเงินสด — ป้ายคือสิ่งที่กันไว้', () => {
    const noLabel: Account[] = [...base, { id: 'inv1', type: 'asset', name: 'กองทุน ก', currency: 'THB' }];
    expect(cashBalance(noLabel, entries(noLabel), '2026-11-10')).toBe(100_000);
  });

  it('มูลค่าสุทธิยังรวมบัญชีลงทุน (ที่ราคาทุน)', () => {
    expect(netWorthAt(withInvest, entries(withInvest), '2026-11-10')).toBe(100_000);
  });

  it('SAFE-TO-SPEND: ยอดที่ใช้จ่ายได้ไม่รวมบัญชีลงทุนตั้งแต่วันแรก', () => {
    const s = buildSafeToSpend(withInvest, entries(withInvest), { bills: [], settings: { payDay: 25 } }, '2026-11-10');
    expect(s).toMatchObject({ kind: 'value', available: 50_000 });
    // เพิ่มบัญชีลงทุนที่มียอดเข้าไป ผลต้องเท่ากับไม่มีบัญชีลงทุนเลย (กระเป๋าเดิมยอดเท่ากัน)
    const plain: Account[] = [...base, { id: 'other', type: 'expense', name: 'อื่น', currency: 'THB' }];
    const plainEntries = [
      createEntry(plain, { id: 'sys', date: '2026-11-01', memo: 'o', source: 'system', lines: [{ accountId: 'w1', amount: 50_000 }, { accountId: 'open', amount: -50_000 }] }),
    ];
    const s2 = buildSafeToSpend(plain, plainEntries, { bills: [], settings: { payDay: 25 } }, '2026-11-10');
    expect(s2).toMatchObject({ kind: 'value', available: 50_000 });
  });

  it('ตัวเลือกกระเป๋าในฟอร์มและสัดส่วนกระเป๋าไม่มีบัญชีลงทุน', () => {
    expect(walletOptions(withInvest).map((a) => a.id)).toEqual(['w1']);
    expect(walletShares(withInvest, entries(withInvest)).map((w) => w.id)).toEqual(['w1']);
  });
});

describe('แปลงแถวฐานข้อมูล: kind', () => {
  const row = { id: 'inv1', type: 'asset', name: 'กองทุน ก', currency: 'THB', archived: false, sort_order: null };
  it('อ่าน kind = investment · ไม่มี/normal = ไม่ใส่ฟิลด์ (บัญชีเดิมไม่เปลี่ยนรูป)', () => {
    expect(rowToAccount({ ...row, kind: 'investment' }).kind).toBe('investment');
    expect('kind' in rowToAccount({ ...row, kind: 'normal' })).toBe(false);
    expect('kind' in rowToAccount(row)).toBe(false);
  });
  it('ค่า kind แปลกจากเซิร์ฟเวอร์ถูกปฏิเสธ (ไม่เดาเป็นเงินสดเงียบๆ)', () => {
    expect(() => rowToAccount({ ...row, kind: 'weird' })).toThrow();
  });
  it('accountToJson ส่ง kind เฉพาะบัญชีลงทุน', () => {
    expect(accountToJson(withInvest[2]!).kind).toBe('investment');
    expect('kind' in accountToJson(base[0]!)).toBe(false);
  });
});
