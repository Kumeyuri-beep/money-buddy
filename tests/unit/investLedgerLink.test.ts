import { describe, expect, it } from 'vitest';
import { applySell, applyBuy, emptyPosition } from '../../src/domain/invest/costBasis';
import { buildTradeEntry, INVEST_ACCOUNT_IDS, isInvestResultAccount, tradeNeedsWallet, TradeLinkError } from '../../src/domain/invest/ledgerLink';
import type { TradeRecord } from '../../src/domain/invest/types';
import { periodTotals, classifyEntry } from '../../src/domain/ledger/balance';
import { createEntry } from '../../src/domain/ledger/entry';
import { buildCashFlow } from '../../src/domain/ledger/sankey';
import type { Account } from '../../src/domain/ledger/types';
import { counterOptions } from '../../src/app/entryForm';

const accounts: Account[] = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' },
  { id: 'inv-a1', type: 'asset', name: 'กองทุน ก', currency: 'THB', kind: 'investment' },
  { id: 'open', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'inv-gain', type: 'income', name: 'กำไรจากการลงทุน', currency: 'THB' },
  { id: 'inv-loss', type: 'expense', name: 'ขาดทุนจากการลงทุน', currency: 'THB' },
  { id: 'inv-dividend', type: 'income', name: 'ปันผล', currency: 'THB' },
  { id: 'inv-wht', type: 'expense', name: 'ภาษีหัก ณ ที่จ่าย', currency: 'THB' },
];

const base = { assetId: 'a1', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', memo: '', withholding: 0 };
const common = { assetName: 'กองทุน ก', assetAccountId: 'inv-a1', walletId: 'w1', entryId: 'e1' };
const sum = (lines: { amount: number }[]): number => lines.reduce((s, l) => s + l.amount, 0);
const amountOf = (lines: { accountId: string; amount: number }[], id: string): number => lines.find((l) => l.accountId === id)?.amount ?? 0;

describe('buildTradeEntry: รูปแบบรายการในสมุดของแต่ละชนิดรายการลงทุน', () => {
  it('ซื้อ: บัญชีลงทุน +(เงินซื้อ+ค่าธรรมเนียม) · กระเป๋า −เท่ากัน · สมดุล', () => {
    const trade: TradeRecord = { ...base, id: 't1', kind: 'buy', units: '500000000', amount: 50_000, fee: 5 };
    const { entry, resultAccountIds } = buildTradeEntry({ ...common, trade });
    expect(amountOf(entry.lines, 'inv-a1')).toBe(50_005);
    expect(amountOf(entry.lines, 'w1')).toBe(-50_005);
    expect(sum(entry.lines)).toBe(0);
    expect(resultAccountIds).toEqual([]);
    expect(entry).toMatchObject({ id: 'e1', date: '2026-11-05', source: 'manual', createdAt: base.createdAt });
    expect(entry.memo).toBe('ซื้อ กองทุน ก');
    expect(() => createEntry(accounts, entry)).not.toThrow();
  });

  it('ซื้อ ไม่มีค่าธรรมเนียม: ยอดเท่ากับเงินซื้อ · ไม่มีกระเป๋า = ปฏิเสธ', () => {
    const trade: TradeRecord = { ...base, id: 't1', kind: 'buy', units: '1', amount: 1, fee: 0 };
    expect(buildTradeEntry({ ...common, trade }).entry.lines).toEqual([
      { accountId: 'inv-a1', amount: 1 },
      { accountId: 'w1', amount: -1 },
    ]);
    expect(() => buildTradeEntry({ ...common, walletId: undefined, trade })).toThrow(TradeLinkError);
  });

  it('ขายขาดทุน: กระเป๋า +net · บัญชีลงทุน −costOut · inv-loss +ขาดทุน · สมดุล (ตัวเลขจากการเล่นซ้ำต้นทุนเฉลี่ย)', () => {
    const pos = applyBuy(emptyPosition(), { units: 1_000_000_000n, amount: 50_000, fee: 100 });
    const sell = applySell(pos, { units: 400_000_000n, priceMicro: 6_000_000, fee: 10 });
    const trade: TradeRecord = { ...base, id: 't2', kind: 'sell', date: '2026-11-10', units: '400000000', priceMicro: 6_000_000, fee: 10 };
    const { entry, resultAccountIds } = buildTradeEntry({ ...common, trade, sell });
    expect(amountOf(entry.lines, 'w1')).toBe(2_390);
    expect(amountOf(entry.lines, 'inv-a1')).toBe(-20_040);
    expect(amountOf(entry.lines, INVEST_ACCOUNT_IDS.loss)).toBe(17_650);
    expect(sum(entry.lines)).toBe(0);
    expect(resultAccountIds).toEqual(['inv-loss']);
    expect(() => createEntry(accounts, entry)).not.toThrow();
  });

  it('ขายกำไร: inv-gain เครดิต · สมดุล', () => {
    const pos = applyBuy(emptyPosition(), { units: 1_000_000_000n, amount: 1_000, fee: 0 });
    const sell = applySell(pos, { units: 500_000_000n, priceMicro: 5_000_000, fee: 0 });
    const trade: TradeRecord = { ...base, id: 't2', kind: 'sell', date: '2026-11-10', units: '500000000', priceMicro: 5_000_000, fee: 0 };
    const { entry, resultAccountIds } = buildTradeEntry({ ...common, trade, sell });
    expect(sell.gain).toBe(2_500 - 500);
    expect(amountOf(entry.lines, INVEST_ACCOUNT_IDS.gain)).toBe(-2_000);
    expect(sum(entry.lines)).toBe(0);
    expect(resultAccountIds).toEqual(['inv-gain']);
  });

  it('ขายเท่าทุน (กำไร 0): ไม่มีบรรทัดกำไร/ขาดทุน (ห้ามบรรทัดยอด 0)', () => {
    const sell = { position: { units: 0n, cost: 0 }, gross: 100, net: 100, costOut: 100, gain: 0 };
    const trade: TradeRecord = { ...base, id: 't2', kind: 'sell', units: '1', priceMicro: 1, fee: 0 };
    const { entry } = buildTradeEntry({ ...common, trade, sell });
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines.every((l) => l.amount !== 0)).toBe(true);
  });

  it('ขายแล้วเงินสุทธิ 0 (ค่าธรรมเนียมเท่าเงินขาย): ไม่มีบรรทัดกระเป๋า แต่ยังสมดุลกับขาดทุน', () => {
    const sell = { position: { units: 1n, cost: 1 }, gross: 10, net: 0, costOut: 5, gain: -5 };
    const trade: TradeRecord = { ...base, id: 't2', kind: 'sell', units: '1', priceMicro: 1, fee: 10 };
    const { entry } = buildTradeEntry({ ...common, trade, sell });
    expect(entry.lines).toEqual([
      { accountId: 'inv-a1', amount: -5 },
      { accountId: 'inv-loss', amount: 5 },
    ]);
  });

  it('ขายโดยไม่มีผลคำนวณต้นทุน = ปฏิเสธ', () => {
    const trade: TradeRecord = { ...base, id: 't2', kind: 'sell', units: '1', priceMicro: 1, fee: 0 };
    expect(() => buildTradeEntry({ ...common, trade })).toThrow(TradeLinkError);
  });

  it('ปันผลเงินสด: กระเป๋า +(D−W) · ภาษี +W · ปันผล −D · สมดุล', () => {
    const trade: TradeRecord = { ...base, id: 't3', kind: 'dividend', amount: 1_000, fee: 0, withholding: 100 };
    const { entry, resultAccountIds } = buildTradeEntry({ ...common, trade });
    expect(amountOf(entry.lines, 'w1')).toBe(900);
    expect(amountOf(entry.lines, 'inv-wht')).toBe(100);
    expect(amountOf(entry.lines, 'inv-dividend')).toBe(-1_000);
    expect(sum(entry.lines)).toBe(0);
    expect(resultAccountIds).toEqual(['inv-dividend', 'inv-wht']);
  });

  it('ปันผลเงินสดไม่มีภาษี: ไม่มีบรรทัดภาษี', () => {
    const trade: TradeRecord = { ...base, id: 't3', kind: 'dividend', amount: 1_000, fee: 0, withholding: 0 };
    const { entry, resultAccountIds } = buildTradeEntry({ ...common, trade });
    expect(entry.lines).toEqual([
      { accountId: 'w1', amount: 1_000 },
      { accountId: 'inv-dividend', amount: -1_000 },
    ]);
    expect(resultAccountIds).toEqual(['inv-dividend']);
  });

  it('ปันผลลงทุนต่อ: บัญชีลงทุน +A · ปันผล −A · ไม่ใช้กระเป๋า (ไม่ต้องส่ง walletId)', () => {
    const trade: TradeRecord = { ...base, id: 't4', kind: 'reinvest', units: '1000000', amount: 900, fee: 0 };
    const { entry } = buildTradeEntry({ ...common, walletId: undefined, trade });
    expect(entry.lines).toEqual([
      { accountId: 'inv-a1', amount: 900 },
      { accountId: 'inv-dividend', amount: -900 },
    ]);
    expect(tradeNeedsWallet('reinvest')).toBe(false);
    expect(tradeNeedsWallet('buy') && tradeNeedsWallet('sell') && tradeNeedsWallet('dividend')).toBe(true);
  });

  it('หมายเหตุของผู้ใช้ต่อท้ายชื่อรายการ', () => {
    const trade: TradeRecord = { ...base, id: 't1', kind: 'buy', units: '1', amount: 1, fee: 0, memo: 'DCA เดือนนี้' };
    expect(buildTradeEntry({ ...common, trade }).entry.memo).toBe('ซื้อ กองทุน ก · DCA เดือนนี้');
  });
});

describe('บัญชีผลการลงทุนไม่ปนกับรายรับรายจ่ายปกติ (R17)', () => {
  const range = { from: '2026-11-01', to: '2026-11-30' };
  const mk = (id: string, lines: { accountId: string; amount: number }[]) => createEntry(accounts, { id, date: '2026-11-10', memo: '', lines });
  const entries = [
    mk('pay', [{ accountId: 'w1', amount: 30_000 }, { accountId: 'salary', amount: -30_000 }]),
    mk('lunch', [{ accountId: 'food', amount: 100 }, { accountId: 'w1', amount: -100 }]),
    mk('sell', [{ accountId: 'w1', amount: 2_390 }, { accountId: 'inv-a1', amount: -20_040 }, { accountId: 'inv-loss', amount: 17_650 }]),
    mk('div', [{ accountId: 'w1', amount: 900 }, { accountId: 'inv-wht', amount: 100 }, { accountId: 'inv-dividend', amount: -1_000 }]),
    mk('gain', [{ accountId: 'w1', amount: 3_000 }, { accountId: 'inv-a1', amount: -1_000 }, { accountId: 'inv-gain', amount: -2_000 }]),
  ];

  it('periodTotals นับเฉพาะเงินเดือนและอาหาร ไม่นับกำไร/ขาดทุน/ปันผล/ภาษี', () => {
    const t = periodTotals(accounts, entries, range);
    expect(t.income).toBe(30_000);
    expect(t.expense).toBe(100);
  });

  it('รายการขายขาดทุน/ปันผล/ขายกำไร แสดงเป็นการโอน (ไม่ใช่รายรับหรือรายจ่าย)', () => {
    expect(classifyEntry(accounts, entries[2]!)).toBe('transfer');
    expect(classifyEntry(accounts, entries[3]!)).toBe('transfer');
    expect(classifyEntry(accounts, entries[4]!)).toBe('transfer');
    expect(classifyEntry(accounts, entries[1]!)).toBe('expense');
  });

  it('แผนภาพกระแสเงิน (Sankey) ไม่นับบัญชีผลลงทุน', () => {
    const flow = buildCashFlow(accounts, entries, '2026-11');
    expect(flow.total).toBe(30_000);
  });

  it('ตัวเลือกหมวดในฟอร์มรายรับ/รายจ่ายไม่มีบัญชีผลลงทุน', () => {
    expect(counterOptions(accounts, 'income', 'w1').map((a) => a.id)).toEqual(['salary']);
    expect(counterOptions(accounts, 'expense', 'w1').map((a) => a.id)).toEqual(['food']);
    expect(isInvestResultAccount({ id: 'inv-gain' })).toBe(true);
    expect(isInvestResultAccount({ id: 'salary' })).toBe(false);
  });
});
