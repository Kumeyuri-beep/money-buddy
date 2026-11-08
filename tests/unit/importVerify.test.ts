import { describe, expect, it } from 'vitest';
import { verifyImport, type VerifyInput } from '../../src/app/importVerify';
import { buildInitialLedger } from '../../src/app/setup';

const base = (): VerifyInput => {
  const ledger = buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }], '2026-11-01');
  const wallet = ledger.accounts.find((a) => a.type === 'asset')!;
  const category = ledger.accounts.find((a) => a.type === 'expense')!;
  return {
    accounts: ledger.accounts,
    entries: [
      ...ledger.entries,
      { id: 'e1', date: '2026-11-02', memo: 'ข้าว', source: 'manual', lines: [{ accountId: category.id, amount: 5000 }, { accountId: wallet.id, amount: -5000 }] },
    ],
    bills: [{ id: 'b1', name: 'เน็ต', amount: 59_900, dueDay: 5, lastPaidMonth: '2026-11' }],
  };
};
type Mutable = { -readonly [K in keyof VerifyInput]: VerifyInput[K] extends readonly (infer U)[] ? U[] : VerifyInput[K] };
const clone = (v: VerifyInput): Mutable => structuredClone(v) as Mutable;

describe('ตรวจยอดหลังนำเข้า', () => {
  it('ตรงทุกข้อ = ok และมียอดต่อบัญชีให้ผู้ใช้ดู', () => {
    const src = base();
    const r = verifyImport(src, clone(src));
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.counts).toEqual({ accounts: [src.accounts.length, src.accounts.length], entries: [2, 2], bills: [1, 1] });
    const wallet = r.balances.find((b) => b.name === 'CashFlow')!;
    expect(wallet).toMatchObject({ source: 540_841 - 5000, imported: 540_841 - 5000, match: true });
  });

  it('รายการหาย/เกิน, ยอดเพี้ยน 1 สตางค์, บัญชีหาย, บิลสถานะต่าง ถูกจับได้', () => {
    const src = base();
    const lost = clone(src);
    lost.entries = lost.entries.filter((e) => e.id !== 'e1');
    const r1 = verifyImport(src, lost);
    expect(r1.ok).toBe(false);
    expect(r1.problems.join('|')).toMatch(/จำนวนรายการ/);
    expect(r1.problems.join('|')).toMatch(/ไม่พบรายการ e1/);

    const off = clone(src);
    off.entries.find((e) => e.id === 'e1')!.lines[0]!.amount = 5001;
    off.entries.find((e) => e.id === 'e1')!.lines[1]!.amount = -5001;
    const r2 = verifyImport(src, off);
    expect(r2.ok).toBe(false);
    expect(r2.problems.join('|')).toMatch(/ยอดบัญชี/);
    expect(r2.problems.join('|')).toMatch(/เนื้อหาไม่ตรง/);

    const noAcc = clone(src);
    noAcc.accounts = noAcc.accounts.slice(1);
    expect(verifyImport(src, noAcc).problems.join('|')).toMatch(/ไม่พบบัญชี/);

    const bill = clone(src);
    delete bill.bills[0]!.lastPaidMonth;
    expect(verifyImport(src, bill).problems.join('|')).toMatch(/บิล เน็ต/);
  });

  it('วันที่หรือชนิดรายการต่างกัน (ยอดเท่ากัน) ก็ถูกจับ', () => {
    const src = base();
    const other = clone(src);
    other.entries.find((e) => e.id === 'e1')!.date = '2026-11-03';
    expect(verifyImport(src, other).ok).toBe(false);
    const other2 = clone(src);
    other2.entries.find((e) => e.id === 'e1')!.source = 'quick';
    expect(verifyImport(src, other2).ok).toBe(false);
  });

  it('ข้อมูลว่างทั้งคู่ = ตรง', () => {
    expect(verifyImport({ accounts: [], entries: [], bills: [] }, { accounts: [], entries: [], bills: [] }).ok).toBe(true);
  });
});

describe('ตรวจยอดหลังนำเข้า: ครบขึ้น', () => {
  const withExtras = (): VerifyInput => {
    const v = base();
    v.entries = v.entries.map((e) => (e.id === 'e1' ? { ...e, createdAt: '2026-11-02T03:00:00.000Z', groupId: 'g1', source: 'recurring' as const, bill: { id: 'b1', cycle: '2026-11' } } : e));
    v.bills = [{ id: 'b1', name: 'เน็ต', amount: 59_900, dueDay: 5, lastPaidMonth: '2026-11', startMonth: '2026-10', walletId: v.accounts[0]!.id }];
    v.settings = { payDay: 25 };
    return v;
  };

  it('ฟิลด์ที่เพี้ยนเงียบๆ ถูกจับ: ลิงก์บิล เวลาบันทึก กลุ่ม ลำดับบัญชี กระเป๋าของบิล ค่าตั้งค่า', () => {
    const src = withExtras();
    expect(verifyImport(src, clone(src)).ok).toBe(true);
    const a = clone(src);
    a.entries.find((e) => e.id === 'e1')!.bill = { id: 'b1', cycle: '2026-10' };
    expect(verifyImport(src, a).ok).toBe(false);
    const b = clone(src);
    b.entries.find((e) => e.id === 'e1')!.createdAt = '2026-11-02T04:00:00.000Z';
    expect(verifyImport(src, b).ok).toBe(false);
    const c = clone(src);
    delete c.entries.find((e) => e.id === 'e1')!.groupId;
    expect(verifyImport(src, c).ok).toBe(false);
    const d = clone(src);
    d.accounts[0] = { ...d.accounts[0]!, sortOrder: 99 };
    expect(verifyImport(src, d).ok).toBe(false);
    const e = clone(src);
    e.bills[0]!.walletId = 'อื่น';
    expect(verifyImport(src, e).ok).toBe(false);
    const f = clone(src);
    f.settings = { payDay: 26 };
    expect(verifyImport(src, f).problems.join('|')).toMatch(/ค่าตั้งค่า/);
  });

  it('เวลาบันทึกที่ต้นทางไม่มี (ฐานข้อมูลใส่ให้ตอนนำเข้า) ไม่ถือว่าต่าง · รูปแบบเวลาต่างแต่เป็นเวลาเดียวกันตรง', () => {
    const src = withExtras();
    delete src.entries.find((e) => e.id === 'e1')!.createdAt;
    const imp = clone(src);
    imp.entries.find((e) => e.id === 'e1')!.createdAt = '2026-11-09T01:00:00.000Z';
    expect(verifyImport(src, imp).ok).toBe(true);
    const s2 = withExtras();
    s2.entries.find((e) => e.id === 'e1')!.createdAt = '2026-11-02T03:00:00Z';
    expect(verifyImport(s2, clone(withExtras())).ok).toBe(true);
  });

  it('ของที่เกินมาฝั่งออนไลน์ถูกจับ (บัญชี/รายการ/บิล)', () => {
    const src = base();
    const more = clone(src);
    more.entries.push({ id: 'extra', date: '2026-11-03', memo: '', source: 'manual', lines: [{ accountId: src.accounts[0]!.id, amount: 1 }, { accountId: src.accounts[1]!.id, amount: -1 }] });
    more.bills.push({ id: 'bx', name: 'x', amount: 1, dueDay: 1 });
    more.accounts.push({ id: 'ax', type: 'asset', name: 'x', currency: 'THB' });
    const msg = verifyImport(src, more).problems.join('|');
    expect(msg).toMatch(/ฝั่งออนไลน์ที่ไม่มีในต้นทาง/);
    expect(verifyImport(src, more).ok).toBe(false);
  });

  it('ยอดสะสมใหญ่เกินช่วงปลอดภัย = รายงานเป็นปัญหา ไม่โยน error ทำให้หน้าตรวจพัง', () => {
    const src = base();
    const cat = src.accounts.find((a) => a.type === 'expense')!.id;
    const wal = src.accounts.find((a) => a.type === 'asset')!.id;
    const big = 6_000_000_000_000_000;
    const huge: VerifyInput = {
      ...src,
      entries: [
        ...src.entries,
        { id: 'b1x', date: '2026-11-03', memo: '', source: 'manual', lines: [{ accountId: cat, amount: big }, { accountId: wal, amount: -big }] },
        { id: 'b2x', date: '2026-11-03', memo: '', source: 'manual', lines: [{ accountId: cat, amount: big }, { accountId: wal, amount: -big }] },
      ],
    };
    const r = verifyImport(huge, clone(huge));
    expect(r.ok).toBe(false);
    expect(r.problems.join('|')).toMatch(/ใหญ่เกินช่วง/);
  });
});
