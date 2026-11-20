import { describe, expect, it } from 'vitest';
import { buildCashAdjustmentEntry } from '../../src/domain/invest/cashAdjustment';
import { buildCashView, cashAccountBalances, planCashChange, parseCashMinor, recentCashMovements } from '../../src/domain/invest/cashView';
import type { InvestmentData } from '../../src/domain/invest/types';
import type { Account, Entry } from '../../src/domain/ledger/types';

const acc = (id: string, currency: string, kind: 'normal' | 'investment', type: Account['type'] = 'asset', extra: Partial<Account> = {}): Account => ({ id, name: id, type, currency, kind, ...extra });
const accounts: Account[] = [
  acc('wallet', 'THB', 'normal'),
  acc('cash-thb', 'THB', 'investment'),
  acc('cash-usd', 'USD', 'investment'),
  acc('asset-acct', 'USD', 'investment'),
  acc('inv-cash-adjust-usd', 'USD', 'normal', 'equity'),
  acc('inv-cash-adjust-thb', 'THB', 'normal', 'equity'),
  acc('fx-thb', 'THB', 'normal', 'equity'),
  acc('fx-usd', 'USD', 'normal', 'equity'),
];
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [{ id: 'a1', name: 'Demo Alpha', kind: 'stock', accountId: 'asset-acct', currency: 'USD', ticker: 'DEMA' }],
  trades: [],
  prices: [],
  fxRates: [{ accountId: 'cash-usd', date: '2026-11-01', rateMicro: 32_000_000 }],
  ...over,
} as InvestmentData);
const e = (id: string, date: string, lines: [string, number][], extra: Partial<Entry> = {}): Entry => ({ id, date, memo: id, source: 'manual', createdAt: `${date}T03:00:00.000Z`, lines: lines.map(([accountId, amount]) => ({ accountId, amount })), ...extra } as Entry);
const dep = (id: string, date: string, acct: string, cur: 'THB' | 'USD', minor: number, direction: 'deposit' | 'withdraw' = 'deposit') =>
  buildCashAdjustmentEntry({ id, date, createdAt: `${date}T03:00:00.000Z`, cashAccountId: acct, currency: cur, direction, amountMinor: minor, memo: '' }).entry;

describe('cashAccountBalances', () => {
  it('ว่าง: ไม่มีบัญชีเงินสด = ว่าง · บัญชีผูกสินทรัพย์/ใช้จ่ายไม่นับ', () => {
    expect(cashAccountBalances([acc('wallet', 'THB', 'normal'), acc('asset-acct', 'USD', 'investment')], [], data())).toEqual([]);
  });
  it('ยอด = ผลรวมบรรทัด: ฝาก ถอน ถอนพอดีเหลือ 0 (ไม่มี -0)', () => {
    const es = [dep('e1', '2026-11-02', 'cash-usd', 'USD', 12_037), dep('e2', '2026-11-03', 'cash-usd', 'USD', 2_037, 'withdraw'), dep('e3', '2026-11-04', 'cash-usd', 'USD', 10_000, 'withdraw')];
    const r = cashAccountBalances(accounts, es, data());
    expect(r.find((x) => x.accountId === 'cash-usd')!.minor).toBe(0);
    expect(Object.is(r.find((x) => x.accountId === 'cash-usd')!.minor, -0)).toBe(false);
    expect(r.map((x) => x.accountId).sort()).toEqual(['cash-thb', 'cash-usd']);
  });
  it('บัญชีเก็บถาวร: ยอด 0 ซ่อน · ยอดไม่ศูนย์ยังแสดง', () => {
    const arch = [...accounts, acc('old-usd', 'USD', 'investment', 'asset', { archived: true })];
    expect(cashAccountBalances(arch, [], data()).some((x) => x.accountId === 'old-usd')).toBe(false);
    expect(cashAccountBalances(arch, [e('x', '2026-11-02', [['old-usd', 500], ['inv-cash-adjust-usd', -500]])], data()).some((x) => x.accountId === 'old-usd')).toBe(true);
  });
});

describe('buildCashView (R26 สกุลที่แสดง)', () => {
  const es = [dep('e1', '2026-11-02', 'cash-usd', 'USD', 10_000), dep('e2', '2026-11-02', 'cash-thb', 'THB', 324_000)];
  it('มุมมอง USD: บาท 3,240.00 = $101.25 ที่เรต 32.00 · รวมและสัดส่วนจากค่าที่แปลงแล้ว', () => {
    const v = buildCashView(accounts, es, data(), 'USD', '2026-11-19');
    expect(v.rows.map((r) => [r.currency, r.minor, r.displayMinor])).toEqual([['THB', 324_000, 10_125], ['USD', 10_000, 10_000]]);
    expect(v.totalDisplayMinor).toBe(20_125);
    expect(v.rows[0]!.shareBps! + v.rows[1]!.shareBps!).toBe(10_000);
    expect(v.rows[0]!.shareBps).toBe(5031);
    expect(v.warnings).toEqual([]);
  });
  it('มุมมอง THB: USD $100.00 = ฿3,200.00', () => {
    const v = buildCashView(accounts, es, data(), 'THB', '2026-11-19');
    expect(v.rows.map((r) => r.displayMinor)).toEqual([324_000, 320_000]);
    expect(v.totalDisplayMinor).toBe(644_000);
  });
  it('ไม่มีเรต: ต่างสกุล = null ทั้งแถวและยอดรวม · สกุลเดียวกับที่แสดงยังมีค่า', () => {
    const v = buildCashView(accounts, es, data({ fxRates: [] }), 'USD', '2026-11-19');
    expect(v.rate).toBeNull();
    expect(v.rows[0]!.displayMinor).toBeNull();
    expect(v.rows[1]!.displayMinor).toBe(10_000);
    expect(v.totalDisplayMinor).toBeNull();
    expect(v.rows.every((r) => r.shareBps === null)).toBe(true);
  });
  it('เรตที่ลงวันหลังวันนี้ไม่นับ', () => {
    const v = buildCashView(accounts, es, data({ fxRates: [{ accountId: 'cash-usd', date: '2026-12-01', rateMicro: 32_000_000 }] }), 'USD', '2026-11-19');
    expect(v.rate).toBeNull();
  });
  it('ว่าง/ยอด 0: noAccounts · allZero · ไม่มีสัดส่วน (ไม่หารศูนย์)', () => {
    expect(buildCashView([acc('wallet', 'THB', 'normal')], [], data(), 'USD', '2026-11-19').noAccounts).toBe(true);
    const z = buildCashView(accounts, [], data(), 'USD', '2026-11-19');
    expect(z.noAccounts).toBe(false);
    expect(z.allZero).toBe(true);
    expect(z.totalDisplayMinor).toBe(0);
    expect(z.rows.every((r) => r.shareBps === null)).toBe(true);
  });
  it('น้อยมาก: 1 สตางค์ ที่เรต 32 = 0 เซนต์ (ปัดครั้งเดียว) ไม่พัง', () => {
    const v = buildCashView(accounts, [dep('e', '2026-11-02', 'cash-thb', 'THB', 1)], data(), 'USD', '2026-11-19');
    expect(v.rows.find((r) => r.currency === 'THB')!.displayMinor).toBe(0);
  });
  it('ติดลบ: มีคำเตือนต่อบัญชี · ไม่มีสัดส่วน', () => {
    const neg = [e('n', '2026-11-02', [['cash-usd', -2_500], ['fx-usd', 2_500]])];
    const v = buildCashView(accounts, neg, data(), 'USD', '2026-11-19');
    expect(v.warnings).toEqual([{ accountId: 'cash-usd', name: 'cash-usd', currency: 'USD', minor: -2_500 }]);
    expect(v.rows.every((r) => r.shareBps === null)).toBe(true);
    const thbNeg = buildCashView(accounts, [e('n', '2026-11-02', [['cash-thb', -100], ['fx-thb', 100]])], data(), 'USD', '2026-11-19');
    expect(thbNeg.warnings.map((w) => w.currency)).toEqual(['THB']);
  });
  it('ยอดเกินช่วงปลอดภัยโยน RangeError (ไม่ปัดเงียบ)', () => {
    const big = [e('b1', '2026-11-02', [['cash-usd', Number.MAX_SAFE_INTEGER], ['fx-usd', -Number.MAX_SAFE_INTEGER]]), e('b2', '2026-11-03', [['cash-usd', 5], ['fx-usd', -5]])];
    expect(() => buildCashView(accounts, big, data(), 'USD', '2026-11-19')).toThrow(RangeError);
  });
});

describe('planCashChange (Change balance)', () => {
  const ok = (mode: 'deposit' | 'withdraw' | 'set', text: string, currentMinor: number) => planCashChange({ mode, text, currentMinor });
  it('ฝาก/ถอน: ข้อความเป็นหน่วยย่อยจำนวนเต็ม', () => {
    expect(ok('deposit', '120.37', 0)).toEqual({ ok: true, plan: { kind: 'change', direction: 'deposit', amountMinor: 12_037 } });
    expect(ok('withdraw', '1,000', 0)).toEqual({ ok: true, plan: { kind: 'change', direction: 'withdraw', amountMinor: 100_000 } });
    expect(ok('deposit', '0.01', 0)).toMatchObject({ ok: true, plan: { amountMinor: 1 } });
  });
  it('ฝาก/ถอน 0, ติดลบ, ว่าง, ตัวหนังสือ, 0.004 (ปัดเป็น 0) ปฏิเสธด้วยรหัส link.cashAmountInvalid', () => {
    for (const t of ['0', '0.00', '0.004', '-5', '+5', '', ' ', 'abc', '1.2.3']) {
      const r = ok('deposit', t, 0);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.problem.code).toBe('link.cashAmountInvalid');
    }
  });
  it('Set balance: ส่วนต่างบวก = ฝาก · ลบ = ถอน · 0 = ไม่บันทึก', () => {
    expect(ok('set', '150.00', 12_037)).toEqual({ ok: true, plan: { kind: 'change', direction: 'deposit', amountMinor: 2_963 } });
    expect(ok('set', '100', 12_037)).toEqual({ ok: true, plan: { kind: 'change', direction: 'withdraw', amountMinor: 2_037 } });
    expect(ok('set', '120.37', 12_037)).toEqual({ ok: true, plan: { kind: 'none' } });
  });
  it('Set balance: ตั้งเป็น 0 = ถอนทั้งหมด · ยอดปัจจุบันติดลบแล้วตั้ง 0 = ฝากเท่าที่ติดลบ · ทศนิยมเกินปัดเป็นหน่วยย่อย', () => {
    expect(ok('set', '0', 500)).toEqual({ ok: true, plan: { kind: 'change', direction: 'withdraw', amountMinor: 500 } });
    expect(ok('set', '0', -2_500)).toEqual({ ok: true, plan: { kind: 'change', direction: 'deposit', amountMinor: 2_500 } });
    expect(ok('set', '1.005', 0)).toEqual({ ok: true, plan: { kind: 'change', direction: 'deposit', amountMinor: 101 } });
  });
  it('Set balance: เป้าติดลบ/ว่าง/อ่านไม่ได้ปฏิเสธ · ส่วนต่างเกิน 2^53-1 ปฏิเสธ · ค่าสูงสุดปลอดภัยผ่าน', () => {
    expect(ok('set', '-1', 0).ok).toBe(false);
    expect(ok('set', '', 0).ok).toBe(false);
    const max = '90071992547409.91'; // = 2^53-1 หน่วยย่อย
    expect(ok('set', max, 0)).toEqual({ ok: true, plan: { kind: 'change', direction: 'deposit', amountMinor: Number.MAX_SAFE_INTEGER } });
    expect(ok('set', max, -1).ok).toBe(false); // ส่วนต่าง 2^53
    expect(ok('set', '90071992547409.92', 0).ok).toBe(false); // ใหญ่เกินช่วงปลอดภัย
    expect(ok('deposit', '9999999999999999', 0).ok).toBe(false);
    expect(planCashChange({ mode: 'set', text: '1', currentMinor: 1.5 }).ok).toBe(false);
  });
  it('parseCashMinor', () => {
    expect(parseCashMinor('฿5,000.50')).toBe(500_050);
    expect(parseCashMinor('x')).toBeNull();
  });
});

describe('recentCashMovements', () => {
  const fx = e('fx1', '2026-11-05', [['wallet', -324_000], ['fx-thb', 324_000], ['fx-usd', -10_000], ['cash-usd', 10_000]]);
  const transferIn = e('t1', '2026-11-04', [['cash-thb', 100_000], ['wallet', -100_000]]);
  const transferOut = e('t2', '2026-11-06', [['wallet', 50_000], ['cash-thb', -50_000]]);
  const adjUsd = dep('a1', '2026-11-03', 'cash-usd', 'USD', 12_037);
  const adjOut = dep('a2', '2026-11-07', 'cash-thb', 'THB', 1_000, 'withdraw');
  const tradeEntry = e('buy1', '2026-11-08', [['asset-acct', 5_000], ['cash-usd', -5_000]]);
  const d = data({
    fxExchanges: [{ id: 'x1', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', direction: 'thb-to-usd', thbSatang: 324_000, usdCents: 10_000, rateMicro: 32_400_000, memo: '', entryId: 'fx1' } as never],
    trades: [{ id: 'tr1', assetId: 'a1', kind: 'buy', date: '2026-11-08', createdAt: '2026-11-08T03:00:00.000Z', amount: 5_000, fee: 0, withholding: 0, memo: '', entryId: 'buy1' } as never],
  });
  const all = [fx, transferIn, transferOut, adjUsd, adjOut, tradeEntry, e('plain', '2026-11-09', [['wallet', 100], ['inv-cash-adjust-usd', -100]])];
  it('จัดชนิดถูก เรียงวันที่ใหม่ก่อน · ซื้อขายหุ้นและรายการที่ไม่แตะเงินสดไม่นับ', () => {
    const r = recentCashMovements(accounts, all, d);
    expect(r.map((m) => [m.entryId, m.kind])).toEqual([
      ['a2', 'withdrawal'],
      ['t2', 'transfer-out'],
      ['fx1', 'exchange'],
      ['t1', 'transfer-in'],
      ['a1', 'deposit'],
    ]);
    expect(r[0]!.legs).toEqual([{ currency: 'THB', minor: -1_000 }]);
    expect(r[2]!.legs).toEqual([{ currency: 'USD', minor: 10_000 }]);
  });
  it('หมายเหตุ: ปรับยอดตัดหัวข้อของระบบ เหลือที่ผู้ใช้พิมพ์', () => {
    const withNote = buildCashAdjustmentEntry({ id: 'n1', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', cashAccountId: 'cash-usd', currency: 'USD', direction: 'deposit', amountMinor: 5, memo: 'statement fix' }).entry;
    expect(recentCashMovements(accounts, [withNote, adjUsd], d).map((m) => m.note)).toEqual(['statement fix', '']);
  });
  it('limit และ ว่าง', () => {
    expect(recentCashMovements(accounts, all, d, 2)).toHaveLength(2);
    expect(recentCashMovements(accounts, all, d, 0)).toEqual([]);
    expect(recentCashMovements(accounts, [], d)).toEqual([]);
  });
  it('วันเดียวกัน: เวลาบันทึกใหม่ก่อน', () => {
    const a = { ...dep('p', '2026-11-03', 'cash-usd', 'USD', 1), createdAt: '2026-11-03T01:00:00.000Z' };
    const b = { ...dep('q', '2026-11-03', 'cash-usd', 'USD', 2), createdAt: '2026-11-03T05:00:00.000Z' };
    expect(recentCashMovements(accounts, [a, b], d).map((m) => m.entryId)).toEqual(['q', 'p']);
  });
});
