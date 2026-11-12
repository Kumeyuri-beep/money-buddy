import { describe, expect, it } from 'vitest';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { applySettingsPlan, planSettingsPatch, planSettingsReplace, SETTINGS_KEYS } from '../../src/domain/bills/settingsPatch';
import { MAX_TAX_TAGGED_ASSETS, sanitizeTaxTagIds, taxTagsProblem } from '../../src/domain/invest/taxTags';
import type { Asset, InvestmentData, TradeKind, TradeRecord } from '../../src/domain/invest/types';
import { summarizeTaxPurchases, taxYearDateRange } from '../../src/domain/tax/portfolioLink';
import { MAX_TAX_INPUT_SATANG } from '../../src/domain/tax/config';
import { fillAmountText, tagsToPatch, taxTagOf, withAssetTag } from '../../src/app/taxPortfolio';
import { parseBackup } from '../../src/domain/backup/parseBackup';

const B = (baht: number): number => baht * 100;
const asset = (id: string, name: string): Asset => ({ id, name, kind: 'fund', accountId: `acc-${id}` });
let seq = 0;
const trade = (assetId: string, kind: TradeKind, date: string, amount: number, fee = 0): TradeRecord => ({
  id: `t${++seq}`,
  assetId,
  kind,
  date,
  createdAt: `${date}T00:00:00.000Z`,
  amount,
  fee,
  withholding: 0,
  memo: '',
});
const data = (assets: Asset[], trades: TradeRecord[]): InvestmentData => ({ assets, trades, prices: [] });

describe('taxTags: ตรวจ/ทำความสะอาดรายชื่อสินทรัพย์ที่ติดป้าย', () => {
  it('ถูกต้อง: ว่าง, รหัสไม่ซ้ำ, ไม่ซ้อนกันระหว่าง RMF กับ Thai ESG', () => {
    expect(taxTagsProblem([], [])).toBeNull();
    expect(taxTagsProblem(['a'], ['b'])).toBeNull();
  });
  it('ผิด: ไม่ใช่อาร์เรย์, รหัสซ้ำ, รหัสไม่ถูกต้อง, เกินเพดาน, ซ้อนกันสองประเภท', () => {
    expect(taxTagsProblem('a', [])).toContain('RMF');
    expect(taxTagsProblem([], 'b')).toContain('Thai ESG');
    expect(taxTagsProblem(['a', 'a'], [])).toContain('ซ้ำ');
    expect(taxTagsProblem([''], [])).toContain('ไม่ถูกต้อง');
    expect(taxTagsProblem(Array.from({ length: MAX_TAX_TAGGED_ASSETS + 1 }, (_, i) => `x${i}`), [])).toContain(String(MAX_TAX_TAGGED_ASSETS));
    expect(taxTagsProblem(['a'], ['a'])).toContain('ทั้ง RMF และ Thai ESG');
  });
  it('sanitize: ตัดซ้ำ/ไม่ถูกต้อง/เกินเพดาน ไม่เชื่อข้อมูลภายนอก', () => {
    expect(sanitizeTaxTagIds(['a', 'a', 5, '', 'b'])).toEqual(['a', 'b']);
    expect(sanitizeTaxTagIds('x')).toEqual([]);
    expect(sanitizeTaxTagIds(Array.from({ length: 50 }, (_, i) => `x${i}`))).toHaveLength(MAX_TAX_TAGGED_ASSETS);
  });
});

describe('ตั้งค่า: taxRmfAssetIds / taxThaiEsgAssetIds', () => {
  it('อยู่ใน SETTINGS_KEYS และ sanitizeSettings เก็บเฉพาะที่ถูกต้อง ไม่ให้ซ้อนกัน (RMF ชนะ)', () => {
    expect(SETTINGS_KEYS).toContain('taxRmfAssetIds');
    expect(SETTINGS_KEYS).toContain('taxThaiEsgAssetIds');
    expect(sanitizeSettings({ taxRmfAssetIds: ['a', 'b'], taxThaiEsgAssetIds: ['b', 'c'] })).toEqual({ taxRmfAssetIds: ['a', 'b'], taxThaiEsgAssetIds: ['c'] });
    expect(sanitizeSettings({ taxRmfAssetIds: [], taxThaiEsgAssetIds: 'x' })).toEqual({});
  });
  it('settingsProblem ปฏิเสธรายการซ้อนกัน/ผิดรูป', () => {
    expect(settingsProblem({ taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: ['a'] })).toContain('ทั้ง RMF และ Thai ESG');
    expect(settingsProblem({ taxRmfAssetIds: ['a', 'a'] })).toContain('ซ้ำ');
    expect(settingsProblem({ taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: ['b'] })).toBeNull();
  });
  it('patchSettings: เปลี่ยนเฉพาะป้ายภาษี คีย์อื่นคงเดิม · saveSettings ที่ไม่ส่งป้าย = คงป้ายเดิม', () => {
    const current = { payDay: 25, taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: ['b'] };
    const p = planSettingsPatch({ taxRmfAssetIds: ['a', 'c'] });
    if (!p.ok) throw new Error(p.problem);
    expect(applySettingsPlan(current, p.plan)).toEqual({ payDay: 25, taxRmfAssetIds: ['a', 'c'], taxThaiEsgAssetIds: ['b'] });
    const r = planSettingsReplace({ payDay: 3 });
    if (!r.ok) throw new Error(r.problem);
    expect(r.plan.remove).not.toContain('taxRmfAssetIds');
    expect(r.plan.remove).not.toContain('taxThaiEsgAssetIds');
    const cleared = planSettingsPatch({ taxRmfAssetIds: null, taxThaiEsgAssetIds: [] });
    if (!cleared.ok) throw new Error(cleared.problem);
    expect([...cleared.plan.remove].sort()).toEqual(['taxRmfAssetIds', 'taxThaiEsgAssetIds']);
  });
  it('ไฟล์สำรองเก็บ/ตรวจป้ายภาษี: ซ้อนกันถูกปฏิเสธ คีย์อยู่ในรายการที่รู้จัก (ไม่ขึ้นคำเตือนว่าไม่รู้จัก)', () => {
    const base = {
      schemaVersion: 1,
      accounts: [
        { id: 'w', type: 'asset', name: 'w', currency: 'THB' },
        { id: 'o', type: 'equity', name: 'o', currency: 'THB' },
      ],
      entries: [{ id: 'e', date: '2026-01-01', memo: '', source: 'system', createdAt: '2026-01-01T00:00:00.000Z', lines: [{ accountId: 'w', amount: 100 }, { accountId: 'o', amount: -100 }] }],
    };
    const ok = parseBackup(JSON.stringify({ ...base, settings: { taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: ['b'] } }), '2026-11-12');
    const joined = JSON.stringify(ok);
    expect(joined).not.toContain('ไม่รู้จัก');
    const bad = parseBackup(JSON.stringify({ ...base, settings: { taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: ['a'] } }), '2026-11-12');
    expect(JSON.stringify(bad)).toContain('ทั้ง RMF และ Thai ESG');
  });
});

describe('taxYearDateRange: ปีภาษี พ.ศ. → ช่วงวันที่ ค.ศ. (1 ม.ค. – 31 ธ.ค.)', () => {
  it('2569 = 2026-01-01 ถึง 2026-12-31', () => {
    expect(taxYearDateRange(2569)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(taxYearDateRange(2568)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
  it('ปีที่ไม่ถูกต้อง = RangeError (ไม่ใช่ ค.ศ. ที่ส่งมาผิด)', () => {
    for (const bad of [2026, 2569.5, Number.NaN, 0, -2569]) expect(() => taxYearDateRange(bad)).toThrow(RangeError);
  });
});

describe('summarizeTaxPurchases: ยอดซื้อของสินทรัพย์ที่ติดป้ายในปีภาษี (ไม่รวมค่าธรรมเนียม ไม่นับปันผลลงทุนต่อ)', () => {
  const assets = [asset('r1', 'RMF หุ้น'), asset('r2', 'RMF ตราสารหนี้'), asset('e1', 'ThaiESG A'), asset('n1', 'กองทุนทั่วไป')];
  const tags = { rmf: ['r1', 'r2'], thaiEsg: ['e1'] };

  it('รวมเฉพาะ "ซื้อ" ในปี 2569 ของสินทรัพย์ที่ติดป้าย แยกตามประเภท', () => {
    const s = summarizeTaxPurchases(
      data(assets, [
        trade('r1', 'buy', '2026-02-10', B(10_000), 25),
        trade('r1', 'buy', '2026-06-10', B(5_000), 10),
        trade('r2', 'buy', '2026-12-31', B(2_000)),
        trade('e1', 'buy', '2026-01-01', B(30_000)),
        trade('n1', 'buy', '2026-03-01', B(99_999)), // ไม่ติดป้าย
      ]),
      tags,
      2569,
    );
    expect(s.rmfSatang).toBe(B(17_000));
    expect(s.thaiEsgSatang).toBe(B(30_000));
    expect(s.lines.map((l) => [l.assetId, l.tag, l.amountSatang, l.buyCount])).toEqual([
      ['r2', 'rmf', B(2_000), 1],
      ['r1', 'rmf', B(15_000), 2],
      ['e1', 'thaiEsg', B(30_000), 1],
    ]);
  });
  it('ไม่รวมค่าธรรมเนียม: ใช้ amount เท่านั้น แม้ fee สูง', () => {
    const s = summarizeTaxPurchases(data(assets, [trade('r1', 'buy', '2026-05-05', B(1_000), B(500))]), tags, 2569);
    expect(s.rmfSatang).toBe(B(1_000));
  });
  it('ไม่นับปันผลลงทุนต่อ (reinvest) ปันผลเงินสด และการขาย · นับจำนวนการขายไว้แจ้งเตือน', () => {
    const s = summarizeTaxPurchases(
      data(assets, [trade('r1', 'buy', '2026-01-05', B(1_000)), trade('r1', 'reinvest', '2026-03-05', B(300)), trade('r1', 'dividend', '2026-04-05', B(200)), trade('r1', 'sell', '2026-05-05', B(400)), trade('e1', 'sell', '2026-06-05', B(100))]),
      tags,
      2569,
    );
    expect(s.rmfSatang).toBe(B(1_000));
    expect(s.thaiEsgSatang).toBe(0);
    expect(s.sellCount).toBe(2);
  });
  it('ขอบปี: 31 ธ.ค. 2025 และ 1 ม.ค. 2027 ไม่นับ · 1 ม.ค. 2026 และ 31 ธ.ค. 2026 นับ', () => {
    const s = summarizeTaxPurchases(
      data(assets, [trade('r1', 'buy', '2025-12-31', B(1)), trade('r1', 'buy', '2026-01-01', B(10)), trade('r1', 'buy', '2026-12-31', B(100)), trade('r1', 'buy', '2027-01-01', B(1_000))]),
      tags,
      2569,
    );
    expect(s.rmfSatang).toBe(B(110));
  });
  it('ไม่ติดป้ายอะไรเลย / ไม่มีรายการ = 0', () => {
    expect(summarizeTaxPurchases(data(assets, []), tags, 2569)).toMatchObject({ rmfSatang: 0, thaiEsgSatang: 0, lines: [], sellCount: 0 });
    expect(summarizeTaxPurchases(data(assets, [trade('r1', 'buy', '2026-02-02', B(5))]), { rmf: [], thaiEsg: [] }, 2569).rmfSatang).toBe(0);
  });
  it('สินทรัพย์ที่ติดป้ายแต่ถูกลบไปแล้ว ไม่ error: นับเป็น missing', () => {
    const s = summarizeTaxPurchases(data([asset('r1', 'RMF')], [trade('r1', 'buy', '2026-02-02', B(5))]), { rmf: ['r1', 'gone'], thaiEsg: [] }, 2569);
    expect(s.rmfSatang).toBe(B(5));
    expect(s.missingAssetCount).toBe(1);
  });
  it('รายการที่ amount ผิดปกติ (ไม่มี/ติดลบ/ทศนิยม) หรือวันที่ผิดรูป ถูกข้ามและนับ ไม่ทำให้ล้ม', () => {
    const bad1 = { ...trade('r1', 'buy', '2026-02-02', 0), amount: undefined };
    const bad2 = trade('r1', 'buy', '2026-02-03', -5);
    const bad3 = trade('r1', 'buy', '2026-02-04', 1.5);
    const bad4 = trade('r1', 'buy', '2026/02/05', B(1));
    const s = summarizeTaxPurchases(data(assets, [bad1, bad2, bad3, bad4, trade('r1', 'buy', '2026-02-06', B(7))]), tags, 2569);
    expect(s.rmfSatang).toBe(B(7));
    expect(s.skippedCount).toBe(4);
  });
  it('ข้อมูลผิดปกติของยอด: 0, -0, NaN, Infinity, เกิน 2^53 ถูกข้ามและนับ (ซื้อยอด 0 ไม่ใช่การซื้อ)', () => {
    const bads = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2].map((v, i) => trade('r1', 'buy', `2026-04-0${i + 1}`, v));
    const s = summarizeTaxPurchases(data(assets, [...bads, trade('r1', 'buy', '2026-04-09', B(3))]), tags, 2569);
    expect(s.rmfSatang).toBe(B(3));
    expect(s.skippedCount).toBe(5);
    expect(s.lines[0]!.buyCount).toBe(1);
  });
  it('วันที่ที่เป็นไปไม่ได้ (2026-02-30, 2026-13-45) ถูกข้ามและนับทั้งซื้อและขาย', () => {
    const s = summarizeTaxPurchases(
      data(assets, [trade('r1', 'buy', '2026-02-30', B(10)), trade('r1', 'buy', '2026-13-45', B(10)), trade('r1', 'sell', '2026-02-31', B(10)), trade('r1', 'buy', '2026-02-28', B(7))]),
      tags,
      2569,
    );
    expect(s.rmfSatang).toBe(B(7));
    expect(s.skippedCount).toBe(3);
    expect(s.sellCount).toBe(0);
  });
  it('ยอดรวมพอดีเท่าเพดานเครื่องคิดภาษีผ่าน · Thai ESG เกินเพดาน = RangeError', () => {
    const exact = summarizeTaxPurchases(data(assets, [trade('r1', 'buy', '2026-02-02', MAX_TAX_INPUT_SATANG)]), tags, 2569);
    expect(exact.rmfSatang).toBe(MAX_TAX_INPUT_SATANG);
    const over = [trade('e1', 'buy', '2026-02-02', MAX_TAX_INPUT_SATANG), trade('e1', 'buy', '2026-02-03', 1)];
    expect(() => summarizeTaxPurchases(data(assets, over), tags, 2569)).toThrow(RangeError);
  });
  it('รวมหลายสินทรัพย์ของประเภทเดียวเกินเพดานรวม = RangeError', () => {
    const half = Math.floor(MAX_TAX_INPUT_SATANG / 2) + 1;
    const two = [trade('r1', 'buy', '2026-02-02', half), trade('r2', 'buy', '2026-02-03', half)];
    expect(() => summarizeTaxPurchases(data(assets, two), tags, 2569)).toThrow(RangeError);
  });
  it('ผลรวมเกินช่วงสูงสุดของเครื่องคิดภาษี = RangeError (ไม่เพี้ยนเงียบ)', () => {
    const big = [trade('r1', 'buy', '2026-02-02', MAX_TAX_INPUT_SATANG), trade('r1', 'buy', '2026-02-03', 1)];
    expect(() => summarizeTaxPurchases(data(assets, big), tags, 2569)).toThrow(RangeError);
  });
  it('สินทรัพย์ในทั้งสองรายการ (ข้อมูลผิดปกติ) นับเป็น RMF ครั้งเดียว ไม่นับซ้ำ', () => {
    const s = summarizeTaxPurchases(data(assets, [trade('r1', 'buy', '2026-02-02', B(100))]), { rmf: ['r1'], thaiEsg: ['r1'] }, 2569);
    expect(s.rmfSatang).toBe(B(100));
    expect(s.thaiEsgSatang).toBe(0);
  });
  it('ผลเป็นสตางค์จำนวนเต็มเสมอ (ไม่ float) แม้รวมหลายรายการ', () => {
    const trades = Array.from({ length: 100 }, (_, i) => trade('r1', 'buy', '2026-03-01', 1 + (i % 3)));
    const s = summarizeTaxPurchases(data(assets, trades), tags, 2569);
    expect(Number.isSafeInteger(s.rmfSatang)).toBe(true);
    expect(s.rmfSatang).toBe(trades.reduce((x, t) => x + (t.amount ?? 0), 0));
  });
});

describe('ตัวช่วยฝั่งแอป: ติดป้าย/ล้างป้าย/ข้อความเติมช่อง', () => {
  it('taxTagOf และ withAssetTag: ย้ายระหว่างประเภทได้ ไม่ซ้อน', () => {
    let tags = { rmf: [] as string[], thaiEsg: [] as string[] };
    tags = withAssetTag(tags, 'a', 'rmf');
    expect(taxTagOf(tags, 'a')).toBe('rmf');
    tags = withAssetTag(tags, 'a', 'thaiEsg');
    expect(tags).toEqual({ rmf: [], thaiEsg: ['a'] });
    expect(taxTagOf(tags, 'a')).toBe('thaiEsg');
    tags = withAssetTag(tags, 'a', null);
    expect(tags).toEqual({ rmf: [], thaiEsg: [] });
    expect(taxTagOf(tags, 'zzz')).toBeNull();
  });
  it('withAssetTag: ติดป้ายเกินเพดานต่อประเภทถูกปฏิเสธด้วยข้อความไทย', () => {
    const full = { rmf: Array.from({ length: MAX_TAX_TAGGED_ASSETS }, (_, i) => `x${i}`), thaiEsg: [] as string[] };
    expect(() => withAssetTag(full, 'new', 'rmf')).toThrow(/ไม่เกิน/);
    expect(withAssetTag(full, 'x0', 'rmf')).toEqual(full); // ติดซ้ำที่เดิม = ไม่เปลี่ยน
  });
  it('tagsToPatch: ว่าง = null (ลบคีย์)', () => {
    expect(tagsToPatch({ rmf: ['a'], thaiEsg: [] })).toEqual({ taxRmfAssetIds: ['a'], taxThaiEsgAssetIds: null });
    expect(tagsToPatch({ rmf: [], thaiEsg: [] })).toEqual({ taxRmfAssetIds: null, taxThaiEsgAssetIds: null });
  });
  it('fillAmountText: สตางค์ → ข้อความที่ช่องเครื่องคิดภาษีอ่านกลับได้ตรงกัน', () => {
    expect(fillAmountText(0)).toBe('0.00');
    expect(fillAmountText(1_234_567)).toBe('12,345.67');
    expect(fillAmountText(B(30_000))).toBe('30,000.00');
    expect(() => fillAmountText(-1)).toThrow(RangeError);
    expect(() => fillAmountText(1.5)).toThrow(RangeError);
  });
});
