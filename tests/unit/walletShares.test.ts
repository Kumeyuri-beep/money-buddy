import { describe, expect, it } from 'vitest';
import { createEntry } from '../../src/domain/ledger/entry';
import { walletShares } from '../../src/domain/ledger/walletShares';
import type { Account, Entry } from '../../src/domain/ledger/types';

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'CashFlow', currency: 'THB' },
  { id: 'w2', type: 'asset', name: 'Mainframe', currency: 'THB' },
  { id: 'w3', type: 'asset', name: 'Vault Zero', currency: 'THB' },
  { id: 'old', type: 'asset', name: 'กระเป๋าเก่า', currency: 'THB', archived: true },
  { id: 'usd', type: 'asset', name: 'Webull', currency: 'USD' },
  { id: 'card', type: 'liability', name: 'บัตร', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'opening-usd', type: 'equity', name: 'ยอดยกมา USD', currency: 'USD' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
];

let seq = 0;
function e(lines: [string, number][]): Entry {
  seq += 1;
  return createEntry(accounts, {
    id: `w${seq}`,
    date: '2026-11-01',
    memo: '',
    source: 'manual',
    lines: lines.map(([accountId, amount]) => ({ accountId, amount })),
  });
}
/** ใส่ยอดยกมาให้กระเป๋า */
const fund = (wallet: string, amount: number) =>
  e([[wallet, amount], [wallet === 'usd' ? 'opening-usd' : 'opening', -amount]]);

const sumPercent = (r: ReturnType<typeof walletShares>) => r.reduce((s, w) => s + w.percent, 0);

describe('walletShares: กรณีขอบ', () => {
  it('ไม่มีรายการ: ทุกกระเป๋ายอด 0 และ 0% (ไม่หารด้วยศูนย์)', () => {
    const r = walletShares(accounts, []);
    expect(r.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(r.every((w) => w.balance === 0 && w.percent === 0)).toBe(true);
  });

  it('ไม่มีกระเป๋า: คืนอาร์เรย์ว่าง', () => {
    expect(walletShares([], [])).toEqual([]);
  });

  it('กระเป๋าเดียวที่มีเงิน = 100%', () => {
    const r = walletShares(accounts, [fund('w1', 12345)]);
    expect(r.find((w) => w.id === 'w1')?.percent).toBe(100);
    expect(r.find((w) => w.id === 'w2')?.percent).toBe(0);
  });

  it('ไม่รวมกระเป๋าที่เก็บถาวร สกุลเงินอื่น และบัญชีที่ไม่ใช่ทรัพย์สิน', () => {
    const r = walletShares(accounts, [fund('old', 5000), fund('usd', 5000), fund('w1', 100)]);
    expect(r.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(r.find((w) => w.id === 'w1')?.percent).toBe(100);
  });

  it('แบ่งครึ่งพอดี 50/50', () => {
    const r = walletShares(accounts, [fund('w1', 1000), fund('w2', 1000)]);
    expect(r.map((w) => w.percent)).toEqual([50, 50, 0]);
  });
});

describe('walletShares: กระเป๋าสกุลเงินอื่น', () => {
  it('กระเป๋า USD ไม่ถูกนับในสัดส่วนและไม่ทำให้ยอดรวมเพี้ยน', () => {
    const r = walletShares(accounts, [fund('w1', 1000), fund('w2', 1000), fund('usd', 9_000_000)]);
    expect(r.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(r.map((w) => w.percent)).toEqual([50, 50, 0]);
  });

  it('มีแต่ยอด USD: กระเป๋าบาททุกใบ 0%', () => {
    const r = walletShares(accounts, [fund('usd', 5000)]);
    expect(r.every((w) => w.percent === 0 && w.balance === 0)).toBe(true);
  });
});

describe('walletShares: ปัดเศษแล้วรวมต้องได้ 100% พอดี', () => {
  it('สามกระเป๋ายอดเท่ากัน (33.33…) รวมได้ 100 โดยกระเป๋าแรกได้เศษ', () => {
    const r = walletShares(accounts, [fund('w1', 100), fund('w2', 100), fund('w3', 100)]);
    expect(r.map((w) => w.percent)).toEqual([34, 33, 33]);
    expect(sumPercent(r)).toBe(100);
  });

  it('เศษไปที่กระเป๋าที่เศษทศนิยมมากสุด (largest remainder)', () => {
    // 1 : 2 : 4 สตางค์ -> 14.28, 28.57, 57.14 -> floor 14+28+57=99 เศษไปที่ 28.57 (0.57) -> 14/29/57
    const r = walletShares(accounts, [fund('w1', 1), fund('w2', 2), fund('w3', 4)]);
    expect(r.map((w) => w.percent)).toEqual([14, 29, 57]);
    expect(sumPercent(r)).toBe(100);
  });

  it('ยอดน้อยมาก 1 สตางค์ในกระเป๋าเดียว = 100%; กระเป๋าใหญ่กับ 1 สตางค์ ไม่เกิน 100 รวม', () => {
    const r = walletShares(accounts, [fund('w1', 1_000_000_000), fund('w2', 1)]);
    expect(sumPercent(r)).toBe(100);
    expect(r.find((w) => w.id === 'w2')?.percent).toBe(0);
  });

  it('รวมได้ 100 เสมอสำหรับชุดตัวเลขหลายแบบ (กำหนดค่าตายตัว)', () => {
    const sets: [number, number, number][] = [
      [7, 11, 13],
      [1, 1, 1],
      [999, 1, 1],
      [333, 333, 334],
      [1234567, 7654321, 1],
      [5, 5, 90],
    ];
    for (const [a, b, c] of sets) {
      const r = walletShares(accounts, [fund('w1', a), fund('w2', b), fund('w3', c)]);
      expect(sumPercent(r)).toBe(100);
      for (const w of r) expect(Number.isInteger(w.percent)).toBe(true);
    }
  });

  it('ยอดใกล้ MAX_SAFE_INTEGER ไม่ล้นและไม่ throw', () => {
    const big = Math.floor(Number.MAX_SAFE_INTEGER / 4);
    const r = walletShares(accounts, [fund('w1', big), fund('w2', big), fund('w3', big)]);
    expect(sumPercent(r)).toBe(100);
  });
});

describe('walletShares: กระเป๋าติดลบ', () => {
  it('กระเป๋าติดลบแสดงยอดจริงแต่ 0% และไม่ดึงสัดส่วนของกระเป๋าอื่น', () => {
    const r = walletShares(accounts, [fund('w1', 3000), fund('w2', 1000), e([['food', 500], ['w3', -500]])]);
    const w3 = r.find((w) => w.id === 'w3');
    expect(w3?.balance).toBe(-500);
    expect(w3?.percent).toBe(0);
    expect(w3?.negative).toBe(true);
    expect(r.find((w) => w.id === 'w1')?.percent).toBe(75);
    expect(r.find((w) => w.id === 'w2')?.percent).toBe(25);
  });

  it('ทุกกระเป๋าติดลบหรือศูนย์: ทุกอันเป็น 0% (รวม 0)', () => {
    const r = walletShares(accounts, [e([['food', 500], ['w1', -500]])]);
    expect(r.every((w) => w.percent === 0)).toBe(true);
    expect(r.find((w) => w.id === 'w1')?.negative).toBe(true);
  });

  it('กระเป๋ายอด 0 ไม่ใช่ติดลบ', () => {
    const r = walletShares(accounts, [fund('w1', 100)]);
    expect(r.find((w) => w.id === 'w2')?.negative).toBe(false);
  });
});

describe('walletShares: ยอดคงเหลือมาจากสมุดบัญชี (R16)', () => {
  it('ยอดเท่ากับผลรวมบรรทัดของกระเป๋านั้น รวมการโอน', () => {
    const r = walletShares(accounts, [fund('w1', 10_000), e([['w2', 4_000], ['w1', -4_000]])]);
    expect(r.find((w) => w.id === 'w1')?.balance).toBe(6_000);
    expect(r.find((w) => w.id === 'w2')?.balance).toBe(4_000);
  });
});
