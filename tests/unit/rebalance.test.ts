import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/r29-examples.json';
import rebalanceSource from '../../src/domain/invest/rebalance.ts?raw';
import { allocateLargestRemainder, rebalance, type RebalanceCategory, type RebalanceHolding, type RebalanceInput, type RebalanceResult, type RebalanceRow } from '../../src/domain/invest/rebalance';

// ตัวอย่างทั้งหมดอ่านจาก tests/fixtures/r29-examples.json ไฟล์เดียว (ห้ามคัดลอกตัวเลข)
const CATS: RebalanceCategory[] = Object.entries(fixture.targetsBps).map(([name, bps], i) => ({ id: name, name, sortOrder: i, targetBps: bps }));
const HOLDINGS: RebalanceHolding[] = fixture.holdings.map((h) => ({
  id: h.id,
  ticker: h.id,
  categoryId: h.category,
  currency: 'USD',
  units: BigInt(h.units),
  priceMicro: Number(h.priceMicro),
}));

const base = (over: Partial<RebalanceInput>): RebalanceInput => ({
  mode: 'deposit',
  amountCents: 0,
  allowSales: false,
  fractional: true,
  minOrderCents: 0,
  categories: CATS,
  holdings: HOLDINGS,
  ...over,
});

function ok(r: RebalanceResult) {
  if (!r.ok) throw new Error(`ไม่คำนวณ: ${r.reason}`);
  return r;
}
const simple = (rows: RebalanceRow[]) => rows.map((r) => ({ id: r.holdingId, units: r.units.toString(), cents: r.cents }));

type Case = {
  deposit?: number;
  withdraw?: number;
  allowSales?: boolean;
  fractional: boolean;
  categoryMoney?: Record<string, number>;
  buys: { id: string; units: string; cents: number }[];
  sells: { id: string; units: string; cents: number }[];
  droppedRows?: { id: string; reason: string }[];
  leftOver?: number;
  shortBy: number;
};

const cases = fixture.cases as unknown as Record<string, Case>;

describe('R29 ตัวอย่างมือจาก fixture', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`ตัวอย่าง ${name} ตรงทุกค่า`, () => {
      const r = ok(
        rebalance(
          base(
            c.withdraw !== undefined
              ? { mode: 'withdraw', amountCents: c.withdraw, fractional: c.fractional }
              : { amountCents: c.deposit ?? 0, allowSales: c.allowSales ?? false, fractional: c.fractional },
          ),
        ),
      );
      expect(simple(r.buys)).toEqual(c.buys);
      expect(simple(r.sells)).toEqual(c.sells);
      expect(r.shortByCents).toBe(c.shortBy);
      if (c.leftOver !== undefined) expect(r.leftOverCents).toBe(c.leftOver);
      if (c.categoryMoney) {
        for (const row of r.categoryRows) expect(row.allocatedCents).toBe(c.categoryMoney[row.categoryId]);
      }
      if (c.droppedRows) {
        const map = { 'units=0': 'unitsZero', belowMin: 'belowMinOrder' } as Record<string, string>;
        expect(r.droppedRows.map((d) => ({ id: d.holdingId, reason: d.reason }))).toEqual(
          c.droppedRows.map((d) => ({ id: d.id, reason: map[d.reason] ?? d.reason })),
        );
      }
    });
  }

  it('มูลค่าหมวดตรง fixture', () => {
    const r = ok(rebalance(base({ amountCents: 1 })));
    for (const row of r.categoryRows) expect(row.nowCents).toBe((fixture.valueCents as Record<string, number>)[row.categoryId]);
    expect(r.totalNowCents).toBe(fixture.valueCents.total);
  });
});

// ---------- invariant ----------

const BPS = 10_000n;
function checkInvariants(input: RebalanceInput) {
  const r = ok(rebalance(input));
  const held = new Map(input.holdings.map((h) => [h.id, h.units]));
  const buyTotal = r.buys.reduce((s, x) => s + x.cents, 0);
  expect(buyTotal).toBeLessThanOrEqual(r.buyFundsCents);
  if (input.mode === 'deposit') expect(buyTotal + r.leftOverCents).toBe(r.buyFundsCents);
  for (const s of r.sells) expect(s.units).toBeLessThanOrEqual(held.get(s.holdingId) as bigint);
  const step = input.fractional ? 100_000n : 100_000_000n;
  for (const x of [...r.buys, ...r.sells]) expect(x.units % step).toBe(0n);
  if (input.mode === 'deposit') {
    expect(r.buyFundsCents).toBe(input.amountCents + r.saleProceedsCents);
    if (!input.allowSales) expect(buyTotal).toBeLessThanOrEqual(input.amountCents);
    const sumAlloc = r.categoryRows.reduce((s, c) => s + c.allocatedCents, 0);
    if (!r.warnings.some((w) => w.code === 'alreadyAtTargets')) expect(sumAlloc).toBe(r.buyFundsCents);
    // F <= sum(sc)/10000 เมื่อเปิด Allow sales  และ ac <= ceil(sc/10000)
    const T = BigInt(r.totalNowCents + input.amountCents);
    let sumSc = 0n;
    for (const c of r.categoryRows) {
      const g = T * BigInt(c.targetBps) - BigInt(c.nowCents) * BPS;
      const sc = g > 0n ? g : 0n;
      sumSc += sc;
      expect(BigInt(c.allocatedCents)).toBeLessThanOrEqual((sc + BPS - 1n) / BPS);
    }
    if (input.allowSales) expect(BigInt(r.buyFundsCents) * BPS).toBeLessThanOrEqual(sumSc);
  } else {
    expect(r.buys).toEqual([]);
    expect(r.saleProceedsCents + r.shortByCents).toBe(input.amountCents);
  }
  return r;
}

describe('R29 invariant', () => {
  const amounts = [0, 1, 2, 3, 7, 99, 1000, 10_001, 35_000, 100_000, 999_999];
  for (const fractional of [true, false]) {
    for (const allowSales of [true, false]) {
      it(`ฝาก (เศษหุ้น=${fractional}, Allow sales=${allowSales}) ทุกยอดตัวอย่าง`, () => {
        for (const a of amounts) {
          if (a === 0 && !allowSales) continue;
          checkInvariants(base({ amountCents: a, allowSales, fractional }));
          checkInvariants(base({ amountCents: a, allowSales, fractional, minOrderCents: 5000 }));
        }
      });
    }
    it(`ถอน (เศษหุ้น=${fractional}) ทุกยอดตัวอย่าง`, () => {
      for (const w of [1, 2, 5, 100, 11_500, 28_250, 60_000, 115_000]) checkInvariants(base({ mode: 'withdraw', amountCents: w, fractional }));
    });
  }

  it('สุ่มพอร์ต/เป้า/ยอด (เมล็ดคงที่) ผ่าน invariant ทั้งชุด', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let t = 0; t < 400; t += 1) {
      const k = 1 + rnd(4);
      const cuts = Array.from({ length: k - 1 }, () => rnd(10_001)).sort((a, b) => a - b);
      const bps = [...cuts, 10_000].map((c, i) => c - (i === 0 ? 0 : (cuts[i - 1] as number)));
      const cats = bps.map((b, i) => ({ id: `c${i}`, name: `c${i}`, sortOrder: i, targetBps: b }));
      const holdings: RebalanceHolding[] = [];
      const n = 1 + rnd(6);
      for (let i = 0; i < n; i += 1) {
        holdings.push({
          id: `h${i}`,
          ticker: `T${i}`,
          categoryId: `c${rnd(k)}`,
          currency: 'USD',
          units: BigInt(rnd(2_000_000_000)) * (rnd(2) === 0 ? 1n : 100_000n) + 1n,
          priceMicro: 1 + rnd(900_000_000),
        });
      }
      const fractional = rnd(2) === 0;
      const allowSales = rnd(2) === 0;
      const mode = rnd(3) === 0 ? 'withdraw' : 'deposit';
      const input = base({
        categories: cats,
        holdings,
        fractional,
        allowSales,
        mode,
        amountCents: mode === 'withdraw' ? 1 + rnd(5000) : rnd(200_000),
        minOrderCents: rnd(3) === 0 ? rnd(2000) : 0,
      });
      const res = rebalance(input);
      if (!res.ok) {
        expect(['nothingToDo', 'withdrawExceedsValue']).toContain(res.reason);
        continue;
      }
      checkInvariants(input);
    }
  });

  it('ผลไม่ขึ้นกับลำดับอินพุต', () => {
    for (const c of [{ amountCents: 35_000 }, { amountCents: 0, allowSales: true }, { amountCents: 10_001 }]) {
      const a = rebalance(base(c));
      const b = rebalance(base({ ...c, categories: [...CATS].reverse(), holdings: [...HOLDINGS].reverse() }));
      expect(b).toEqual(a);
    }
    const w1 = rebalance(base({ mode: 'withdraw', amountCents: 11_500 }));
    const w2 = rebalance(base({ mode: 'withdraw', amountCents: 11_500, categories: [...CATS].reverse(), holdings: [...HOLDINGS].reverse() }));
    expect(w2).toEqual(w1);
  });

  it('ไม่มี Math.floor หรือ float ในไฟล์ rebalance.ts', () => {
    const src = rebalanceSource as string;
    expect(src).not.toMatch(/Math\.floor/);
    expect(src).not.toMatch(/Math\.round|parseFloat/);
  });
});

// ---------- กรณีขอบ ----------

describe('R29 ไม่คำนวณ (เหตุผล)', () => {
  it('ไม่มีหมวด / ไม่มีเป้า', () => {
    expect(rebalance(base({ amountCents: 100, categories: [] }))).toMatchObject({ ok: false, reason: 'noTargets' });
    expect(rebalance(base({ amountCents: 100, categories: CATS.map((c) => ({ ...c, targetBps: null })) }))).toMatchObject({ ok: false, reason: 'noTargets' });
  });
  it('เป้ารวม 99.99% / บางหมวดไม่ตั้ง', () => {
    const c99 = CATS.map((c, i) => (i === 0 ? { ...c, targetBps: (c.targetBps as number) - 1 } : c));
    expect(rebalance(base({ amountCents: 100, categories: c99 }))).toMatchObject({ ok: false, reason: 'targetsNotComplete' });
    const part = CATS.map((c, i) => (i === 0 ? { ...c, targetBps: null } : c));
    expect(rebalance(base({ amountCents: 100, categories: part }))).toMatchObject({ ok: false, reason: 'targetsNotComplete' });
  });
  it('หุ้นไม่มีหมวด', () => {
    const hs = [...HOLDINGS, { id: 'ZZZ', ticker: 'ZZZ', categoryId: null, currency: 'USD' as const, units: 100_000_000n, priceMicro: 1_000_000 }];
    expect(rebalance(base({ amountCents: 100, holdings: hs }))).toMatchObject({ ok: false, reason: 'holdingWithoutCategory', holdingIds: ['ZZZ'] });
    // หุ้นที่ไม่ได้ถือ (หน่วย 0) ไม่ใช่เหตุหยุด
    const zero = [...HOLDINGS, { id: 'ZZZ', ticker: 'ZZZ', categoryId: null, currency: 'USD' as const, units: 0n, priceMicro: null }];
    expect(rebalance(base({ amountCents: 100, holdings: zero })).ok).toBe(true);
  });
  it('สินทรัพย์บาทในหมวด ระบุหมวด', () => {
    const hs = [...HOLDINGS, { id: 'TH', ticker: 'TH', categoryId: 'Funds', currency: 'THB' as const, units: 100_000_000n, priceMicro: 1_000_000 }];
    expect(rebalance(base({ amountCents: 100, holdings: hs }))).toMatchObject({ ok: false, reason: 'bahtAssetInCategory', categoryIds: ['Funds'] });
  });
  it('หุ้นที่ถือไม่มีราคา', () => {
    const hs = HOLDINGS.map((h) => (h.id === 'CCC' ? { ...h, priceMicro: null } : h));
    expect(rebalance(base({ amountCents: 100, holdings: hs }))).toMatchObject({ ok: false, reason: 'needsPrice', holdingIds: ['CCC'] });
  });
  it('ฝาก 0 ไม่เปิด Allow sales', () => {
    expect(rebalance(base({ amountCents: 0 }))).toMatchObject({ ok: false, reason: 'nothingToDo' });
  });
  it('ถอนเกินมูลค่า / ถอน 0 / ติดลบ / ไม่ใช่จำนวนเต็ม', () => {
    expect(rebalance(base({ mode: 'withdraw', amountCents: fixture.valueCents.total + 1 }))).toMatchObject({ ok: false, reason: 'withdrawExceedsValue' });
    expect(rebalance(base({ mode: 'withdraw', amountCents: 0 }))).toMatchObject({ ok: false, reason: 'invalidAmount' });
    expect(rebalance(base({ amountCents: -1 }))).toMatchObject({ ok: false, reason: 'invalidAmount' });
    expect(rebalance(base({ amountCents: 1.5 }))).toMatchObject({ ok: false, reason: 'invalidAmount' });
    expect(rebalance(base({ amountCents: Number.NaN }))).toMatchObject({ ok: false, reason: 'invalidAmount' });
    expect(rebalance(base({ amountCents: 100, minOrderCents: -1 }))).toMatchObject({ ok: false, reason: 'invalidOption' });
  });
  it('หน่วยติดลบ', () => {
    const hs = HOLDINGS.map((h) => (h.id === 'CCC' ? { ...h, units: -1n } : h));
    expect(rebalance(base({ amountCents: 100, holdings: hs }))).toMatchObject({ ok: false, reason: 'invalidHolding' });
  });
});

describe('R29 กรณีขอบของการคำนวณ', () => {
  it('ฝาก 1 เซนต์ (น้อยมาก): ไม่ซื้อเกิน ไม่ล้ม เงินกลับเป็น Left over', () => {
    const r = ok(rebalance(base({ amountCents: 1 })));
    expect(r.buys).toEqual([]);
    expect(r.leftOverCents).toBe(1);
  });
  it('Σsc = 0 (D = 0 + Allow sales และพอร์ตตรงเป้า): ไม่มีรายการ ไม่หารศูนย์', () => {
    const exact: RebalanceHolding[] = [
      { id: 'X', ticker: 'X', categoryId: 'Tech', currency: 'USD', units: 100_000_000n, priceMicro: 50_000_000 },
      { id: 'Y', ticker: 'Y', categoryId: 'Health', currency: 'USD', units: 100_000_000n, priceMicro: 30_000_000 },
      { id: 'Z', ticker: 'Z', categoryId: 'Funds', currency: 'USD', units: 100_000_000n, priceMicro: 20_000_000 },
    ];
    const r = ok(rebalance(base({ holdings: exact, amountCents: 0, allowSales: true })));
    expect(r.buys).toEqual([]);
    expect(r.sells).toEqual([]);
    expect(r.leftOverCents).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain('alreadyAtTargets');
  });
  it('หมวดไม่มีหุ้นที่ถืออยู่: เงินของหมวดเป็น Left over + ข้อความ', () => {
    const hs = HOLDINGS.filter((h) => h.id !== 'DDD');
    const r = ok(rebalance(base({ holdings: hs, amountCents: 35_000 })));
    expect(r.buys.map((b) => b.holdingId)).toEqual(['CCC']);
    expect(r.warnings).toContainEqual({ code: 'noHoldingToBuy', categoryIds: ['Funds'] });
    expect(r.leftOverCents).toBe(35_000 - r.buys.reduce((s, b) => s + b.cents, 0));
  });
  it('หุ้นมูลค่า 0 (หน่วยจิ๋ว) ไม่ได้เงิน', () => {
    const hs = [...HOLDINGS, { id: 'TINY', ticker: 'TINY', categoryId: 'Health', currency: 'USD' as const, units: 1n, priceMicro: 1_000_000 }];
    const r = ok(rebalance(base({ holdings: hs, amountCents: 35_000 })));
    expect(r.buys.find((b) => b.holdingId === 'TINY')).toBeUndefined();
    expect(r.droppedRows.find((d) => d.holdingId === 'TINY')).toBeUndefined();
  });
  it('Min order ตัดแถวซื้อ เงินกลับเป็น Left over (ไม่ย้ายหมวด/แถว) · ไม่ตัดแถวขาย', () => {
    const r = ok(rebalance(base({ amountCents: 0, allowSales: true, minOrderCents: 15_000 })));
    expect(r.sells.length).toBe(2);
    expect(r.buys.every((b) => b.cents >= 15_000)).toBe(true);
    expect(r.droppedRows.some((d) => d.reason === 'belowMinOrder')).toBe(true);
    expect(r.leftOverCents).toBe(r.buyFundsCents - r.buys.reduce((s, b) => s + b.cents, 0));
  });
  it('ปิดเศษหุ้นแล้วราคาสูงกว่าเงินของแถว: หน่วย 0 แถวถูกตัด', () => {
    const r = ok(rebalance(base({ amountCents: 2_000, fractional: false })));
    expect(r.buys).toEqual([]);
    expect(r.droppedRows.every((d) => d.reason === 'unitsZero')).toBe(true);
    expect(r.leftOverCents).toBe(2_000);
  });
  it('ถอนเท่ามูลค่าทั้งพอร์ต: ขายครบ เตือนขายหมดตำแหน่ง ไม่ล้ม', () => {
    const r = ok(rebalance(base({ mode: 'withdraw', amountCents: fixture.valueCents.total })));
    expect(r.saleProceedsCents + r.shortByCents).toBe(fixture.valueCents.total);
    expect(r.warnings.map((w) => w.code)).toContain('sellsWholePosition');
    expect(r.totalAfterCents).toBeLessThanOrEqual(1);
  });
  it('เป้า 0% + Allow sales ขายหมวดนั้นหมด + เตือน', () => {
    const cats = CATS.map((c) => (c.id === 'Tech' ? { ...c, targetBps: 0 } : c.id === 'Health' ? { ...c, targetBps: 8000 } : c));
    const r = ok(rebalance(base({ categories: cats, amountCents: 0, allowSales: true, fractional: false })));
    expect(r.sells.map((s) => s.holdingId).sort()).toEqual(['AAA', 'BBB']);
    expect(r.warnings.map((w) => w.code)).toContain('sellsWholeCategory');
  });
  it('เศษเท่ากัน: ตัดสินด้วยลำดับหมวด (sortOrder แล้ว id)', () => {
    const cats: RebalanceCategory[] = [
      { id: 'b', name: 'b', sortOrder: 1, targetBps: 5000 },
      { id: 'a', name: 'a', sortOrder: 1, targetBps: 5000 },
    ];
    const hs: RebalanceHolding[] = [
      { id: 'A1', ticker: 'A1', categoryId: 'a', currency: 'USD', units: 100_000_000n, priceMicro: 1_000_000 },
      { id: 'B1', ticker: 'B1', categoryId: 'b', currency: 'USD', units: 100_000_000n, priceMicro: 1_000_000 },
    ];
    const r = ok(rebalance(base({ categories: cats, holdings: hs, amountCents: 1 })));
    expect(r.categoryRows.find((c) => c.categoryId === 'a')?.allocatedCents).toBe(1);
    expect(r.categoryRows.find((c) => c.categoryId === 'b')?.allocatedCents).toBe(0);
  });
  it('เศษเท่ากันในหมวด: ตัดสินด้วยชื่อย่อ (ตัวพิมพ์ใหญ่) แล้ว id', () => {
    const cats: RebalanceCategory[] = [{ id: 'k', name: 'k', sortOrder: 0, targetBps: 10_000 }];
    const mk = (id: string, ticker: string): RebalanceHolding => ({ id, ticker, categoryId: 'k', currency: 'USD', units: 100_000_000n, priceMicro: 10_000 });
    // ราคา 0.01 USD ถือ 1 หุ้น = 1 เซนต์ เท่ากันทั้งสามตัว · ฝาก 1 เซนต์ -> ได้ตัวแรกตามชื่อย่อ (aaa)
    const hs = [mk('2', 'bbb'), mk('1', 'ccc'), mk('3', 'aaa')];
    const r = ok(rebalance(base({ categories: cats, holdings: hs, amountCents: 1, fractional: false })));
    expect(r.buys.map((b) => b.holdingId)).toEqual(['3']);
  });
  it('ยอดใหญ่: ผลเกินช่วงเซนต์ปลอดภัยโยน RangeError (ไม่เงียบ)', () => {
    const hs = HOLDINGS.map((h) => (h.id === 'AAA' ? { ...h, units: 10n ** 20n } : h));
    expect(() => rebalance(base({ holdings: hs, amountCents: 100 }))).toThrow(RangeError);
  });
  it('ราคาเก่ากว่า 30 วันขึ้นเตือน', () => {
    const hs = HOLDINGS.map((h) => (h.id === 'CCC' ? { ...h, priceDate: '2026-01-01' } : { ...h, priceDate: '2026-11-20' }));
    const r = ok(rebalance(base({ holdings: hs, amountCents: 35_000, today: '2026-11-23' })));
    expect(r.warnings).toContainEqual({ code: 'stalePrice', holdingIds: ['CCC'] });
  });
  it('ตาราง After คิดจากหน่วยที่ปัดจริง', () => {
    const r = ok(rebalance(base({ amountCents: 35_000, fractional: false })));
    const health = r.categoryRows.find((c) => c.categoryId === 'Health');
    expect(health?.afterCents).toBe(30_000 + 12_000);
    expect(r.totalAfterCents).toBe(r.categoryRows.reduce((s, c) => s + c.afterCents, 0));
  });
});

// ---------- เพิ่มตามผล money-auditor ----------

describe('R29 ช่วงปลอดภัยของเซนต์', () => {
  const big = (id: string, cat: string, cents: bigint): RebalanceHolding => ({
    id,
    ticker: id,
    categoryId: cat,
    currency: 'USD',
    units: (cents * 1_000_000_000_000n) / 1_000_000_000n, // ราคา 1,000 USD ต่อหุ้น
    priceMicro: 1_000_000_000,
  });
  const halves: RebalanceCategory[] = [
    { id: 'A', name: 'A', sortOrder: 0, targetBps: 5000 },
    { id: 'B', name: 'B', sortOrder: 1, targetBps: 5000 },
  ];

  it('สองหุ้นที่แต่ละตัวปลอดภัยแต่ผลรวมเกิน 2^53-1 โยน RangeError', () => {
    const each = 6_000_000_000_000_000n; // < 9.007e15 แต่สองตัวรวมเกิน
    expect(each < BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    const hs = [big('H1', 'A', each), big('H2', 'B', each)];
    expect(() => rebalance(base({ categories: halves, holdings: hs, amountCents: 100 }))).toThrow(RangeError);
  });

  it('ตัวเลขใหญ่ ~10^15 เซนต์ที่ไม่ล้น ผลถูกและ invariant ผ่าน', () => {
    const hs = [big('H1', 'A', 10n ** 15n), big('H2', 'B', 10n ** 15n)];
    const input = base({ categories: halves, holdings: hs, amountCents: 1_000_000 });
    const r = checkInvariants(input);
    expect(r.totalNowCents).toBe(2 * 10 ** 15);
    expect(r.buys.map((b) => b.cents)).toEqual([500_000, 500_000]);
    expect(r.leftOverCents).toBe(0);
  });
});

describe('R29 กรณีเพิ่มเติม', () => {
  it('ถอนเท่ามูลค่าทั้งพอร์ตแบบปิดเศษหุ้น: ขายหมดทุกตำแหน่ง Short by 0', () => {
    const r = ok(rebalance(base({ mode: 'withdraw', amountCents: fixture.valueCents.total, fractional: false })));
    expect(r.shortByCents).toBe(0);
    expect(r.saleProceedsCents).toBe(fixture.valueCents.total);
    expect(r.sells.length).toBe(HOLDINGS.length);
    expect(r.buys).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain('sellsWholePosition');
  });

  it('หมวดที่มีแต่หุ้นมูลค่า 0: เงินเป็น Left over + noHoldingToBuy', () => {
    const hs = [...HOLDINGS.filter((h) => h.id !== 'DDD'), { id: 'TINY', ticker: 'TINY', categoryId: 'Funds', currency: 'USD' as const, units: 1n, priceMicro: 1_000_000 }];
    const r = ok(rebalance(base({ holdings: hs, amountCents: 35_000 })));
    expect(r.warnings).toContainEqual({ code: 'noHoldingToBuy', categoryIds: ['Funds'] });
    expect(r.buys.map((b) => b.holdingId)).toEqual(['CCC']);
  });

  it('หน่วยขาย = min(คำนวณ, ที่ถือ) เมื่อมูลค่าแถวปัดขึ้น', () => {
    const cats: RebalanceCategory[] = [{ id: 'K', name: 'K', sortOrder: 0, targetBps: 10_000 }];
    const hs: RebalanceHolding[] = [{ id: 'U', ticker: 'U', categoryId: 'K', currency: 'USD', units: 499_999n, priceMicro: 1_000_000_000 }];
    const r = ok(rebalance(base({ categories: cats, holdings: hs, mode: 'withdraw', amountCents: 500 })));
    expect(r.sells).toHaveLength(1);
    expect(r.sells[0]?.units).toBe(499_999n); // คำนวณได้ 500,000 แต่ถืออยู่ 499,999
    expect(r.warnings.map((w) => w.code)).toContain('sellsWholePosition');
  });

  it('droppedRows ทั้ง unitsZero และ belowMinOrder ในพอร์ตเดียว', () => {
    const hs = [...HOLDINGS, { id: 'EEE', ticker: 'EEE', categoryId: 'Funds', currency: 'USD' as const, units: 100_000_000n, priceMicro: 1_000_000_000 }];
    const r = ok(rebalance(base({ holdings: hs, amountCents: 35_000, fractional: false, minOrderCents: 12_500 })));
    const reasons = new Set(r.droppedRows.map((d) => d.reason));
    expect(reasons.has('unitsZero')).toBe(true);
    expect(reasons.has('belowMinOrder')).toBe(true);
    const buyTotal = r.buys.reduce((s, b) => s + b.cents, 0);
    expect(buyTotal + r.leftOverCents).toBe(r.buyFundsCents);
  });

  it('sellsWholeCategory ในโหมดถอน', () => {
    const cats = CATS.map((c) => (c.id === 'Tech' ? { ...c, targetBps: 0 } : { ...c, targetBps: 5000 }));
    const r = ok(rebalance(base({ categories: cats, mode: 'withdraw', amountCents: 80_000, fractional: false })));
    expect(r.sells.map((s) => s.holdingId).sort()).toEqual(['AAA', 'BBB']);
    expect(r.warnings).toContainEqual({ code: 'sellsWholeCategory', categoryIds: ['Tech'] });
  });
});

describe('allocateLargestRemainder', () => {
  it('ผลรวมน้ำหนัก 0 โยน RangeError', () => {
    expect(() => allocateLargestRemainder(10n, [0n, 0n])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10n, [])).toThrow(RangeError);
  });
  it('น้ำหนักติดลบโยน RangeError', () => {
    expect(() => allocateLargestRemainder(10n, [-1n, 5n])).toThrow(RangeError);
  });
  it('total = 0 ได้ศูนย์ทั้งหมด', () => {
    expect(allocateLargestRemainder(0n, [3n, 5n])).toEqual([0n, 0n]);
  });
  it('ผลรวม = total เสมอ และเศษเท่ากันให้ตัวก่อน', () => {
    expect(allocateLargestRemainder(1n, [1n, 1n, 1n])).toEqual([1n, 0n, 0n]);
    expect(allocateLargestRemainder(2n, [1n, 1n, 1n])).toEqual([1n, 1n, 0n]);
    for (let t = 0n; t < 40n; t += 1n) {
      const out = allocateLargestRemainder(t, [3n, 0n, 7n, 11n]);
      expect(out.reduce((s, x) => s + x, 0n)).toBe(t);
      expect(out[1]).toBe(0n);
    }
  });
});
