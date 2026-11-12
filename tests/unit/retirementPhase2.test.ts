import { describe, expect, it } from 'vitest';
import { buildPortfolio } from '../../src/app/portfolio';
import { buildRetirementInput, emptyRetirementForm, type RetirementForm } from '../../src/app/retirementForm';
import { RETIREMENT_STALE_PRICE_DAYS, retirementAssetOptions, summarizeRetirementPortfolio } from '../../src/app/retirementPortfolio';
import type { DcaPlan } from '../../src/domain/invest/dcaPlan';
import type { Asset, AssetPrice, InvestmentData, TradeRecord } from '../../src/domain/invest/types';
import { dcaVersusSaving, progressBarPercent, progressBps } from '../../src/domain/retirement/progress';

const TODAY = '2026-11-20';
const asset = (id: string, name: string, archived = false): Asset => ({ id, name, kind: 'fund', accountId: `inv-${id}`, ...(archived ? { archived } : {}) });
const buy = (assetId: string, units: string, amount: number, id = `t-${assetId}`): TradeRecord => ({
  id, assetId, kind: 'buy', date: '2026-01-10', createdAt: '2026-01-10T03:00:00.000Z', units, amount, fee: 0, withholding: 0, memo: '',
});
const price = (assetId: string, date: string, priceMicro: number): AssetPrice => ({ assetId, date, priceMicro });
const plan = (id: string, assetId: string, amount: number, paused?: boolean): DcaPlan => ({ id, assetId, amount, dayOfMonth: 5, startMonth: '2026-01', ...(paused ? { paused } : {}) });

/** a1: มีราคา (2 หน่วย x 50 บาท = 10,000 สตางค์ x ... ดูค่าใน buildPortfolio) · a2: ไม่มีราคา · a3: ไม่มีหน่วย · a4: ราคาเก่า · a5: เก็บถาวรแต่ยังถือ */
const data: InvestmentData = {
  assets: [asset('a1', 'กองทุน ก'), asset('a2', 'กองทุน ข'), asset('a3', 'กองทุน ค'), asset('a4', 'กองทุน ง'), asset('a5', 'กองทุน จ', true)],
  trades: [
    buy('a1', '200000000', 100_000), // 2 หน่วย
    buy('a2', '100000000', 50_000), // 1 หน่วย ไม่มีราคา
    buy('a4', '100000000', 70_000), // 1 หน่วย
    buy('a5', '300000000', 90_000), // 3 หน่วย
  ],
  prices: [
    price('a1', '2026-11-19', 60_000_000), // 60 บาท/หน่วย → 2 หน่วย = 12,000 สตางค์ x ... = 120 บาท = 12,000 สตางค์
    price('a4', '2026-10-21', 80_000_000), // เก่า 30 วัน (ไม่ถือว่าเก่า)
    price('a5', '2026-10-20', 10_000_000), // เก่า 31 วัน (เก่า)
  ],
};

describe('progressBps: ความคืบหน้าเป็น bps (แสดงผลอย่างเดียว R18 ข้อ 18.8)', () => {
  it('มูลค่า 0 = 0 · มูลค่าเท่ากับเป้าพอดี = 10000 (100%) · เกินเป้าแสดงเกิน 100% ได้', () => {
    expect(progressBps(0, 1_000_000)).toBe(0);
    expect(progressBps(1_000_000, 1_000_000)).toBe(10_000);
    expect(progressBps(2_000_000, 1_000_000)).toBe(20_000);
  });
  it('ยังน้อยกว่าเป้าแต่ปัดแล้วได้ 10000 → แสดง 9999 (ห้ามโชว์ 100% ทั้งที่ยังไม่ถึง)', () => {
    expect(progressBps(999_999_999_999, 1_000_000_000_000)).toBe(9_999);
    expect(progressBps(99_996, 100_000)).toBe(9_999); // 99.996% ปัดเป็น 100.00%
  });
  it('ปัดครึ่งขึ้น: 1/20000 = 0.5 bps → 1 · 1/3 = 3333', () => {
    expect(progressBps(1, 20_000)).toBe(1);
    expect(progressBps(1, 3)).toBe(3_333);
    expect(progressBps(1, 20_001)).toBe(0);
  });
  it('เป้า N = 0 → null (ไม่หารศูนย์) · ค่าติดลบ/ทศนิยม/NaN = RangeError · เลขใหญ่เกิน 2^53 ตอนคูณไม่เพี้ยน', () => {
    expect(progressBps(500, 0)).toBeNull();
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => progressBps(bad, 100), String(bad)).toThrow(RangeError);
      expect(() => progressBps(100, bad), String(bad)).toThrow(RangeError);
    }
    expect(progressBps(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(10_000);
    expect(progressBps(Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)).toBe(9_999);
  });
  it('ผลเกินช่วงปลอดภัย = RangeError ไม่ตัดค่าเงียบ', () => {
    expect(() => progressBps(Number.MAX_SAFE_INTEGER, 1)).toThrow(RangeError);
  });
});

describe('progressBarPercent: ความกว้างแถบ', () => {
  it('0 → 0 · 3555 bps → 35 · 9999 → 99 · 10000 และเกินเป้า → 100 · ค่าผิด = RangeError', () => {
    expect(progressBarPercent(0)).toBe(0);
    expect(progressBarPercent(3_555)).toBe(35);
    expect(progressBarPercent(9_999)).toBe(99);
    expect(progressBarPercent(10_000)).toBe(100);
    expect(progressBarPercent(25_000)).toBe(100);
    for (const bad of [-1, 1.5, Number.NaN, -0]) expect(() => progressBarPercent(bad), String(bad)).toThrow(RangeError);
  });
  it('progressBps โยน RangeError กับ -0', () => {
    expect(() => progressBps(-0, 100)).toThrow(RangeError);
    expect(() => progressBps(100, -0)).toThrow(RangeError);
  });
});

describe('dcaVersusSaving: เทียบแผน DCA กับเงินที่ต้องเก็บ (แผนที่ตั้งไว้ ไม่ใช่เงินออมจริง)', () => {
  it('แผนน้อยกว่าที่ต้องเก็บ → ขาดเท่าส่วนต่าง · เท่ากันหรือมากกว่า = ไม่ขาด', () => {
    expect(dcaVersusSaving(300_000, 500_000)).toEqual({ dcaMonthly: 300_000, savingNeeded: 500_000, shortBy: 200_000, covered: false });
    expect(dcaVersusSaving(500_000, 500_000).covered).toBe(true);
    expect(dcaVersusSaving(900_000, 500_000)).toMatchObject({ shortBy: 0, covered: true });
  });
  it('ไม่ต้องเก็บ (0) = ครอบคลุม · แผน 0 = ขายเต็ม · ค่าผิด = RangeError', () => {
    expect(dcaVersusSaving(0, 0).covered).toBe(true);
    expect(dcaVersusSaving(0, 100)).toMatchObject({ shortBy: 100, covered: false });
    expect(() => dcaVersusSaving(-1, 100)).toThrow(RangeError);
    expect(() => dcaVersusSaving(1, Number.NaN)).toThrow(RangeError);
  });
});

describe('retirementAssetOptions: ตัวเลือกสินทรัพย์ที่ผู้ใช้เลือกนับเป็นเงินเกษียณ', () => {
  const opts = retirementAssetOptions(data, TODAY);
  const by = (id: string) => opts.find((o) => o.assetId === id);
  it('แสดงเฉพาะสินทรัพย์ที่ยังถือหน่วย (a3 ไม่มีหน่วยไม่แสดง) รวมที่เก็บถาวรแต่ยังถือ', () => {
    expect(opts.map((o) => o.assetId).sort()).toEqual(['a1', 'a2', 'a4', 'a5']);
  });
  it('มูลค่าตรงกับตัวอ่านพอร์ต R17 (หน่วย x ราคาที่ผู้ใช้ป้อน) ไม่ใช้ต้นทุน', () => {
    const rows = buildPortfolio(data, TODAY).rows;
    for (const o of opts) expect(o.valueSatang).toBe(rows.find((r) => r.asset.id === o.assetId)!.market?.value ?? null);
    expect(by('a1')!.valueSatang).toBe(12_000);
    expect(by('a1')!.valueSatang).not.toBe(100_000); // ไม่ใช่ราคาทุน
  });
  it('ไม่มีราคา = "ยังไม่มีราคา" (null ไม่ใช่ 0)', () => {
    expect(by('a2')!.valueSatang).toBeNull();
    expect(by('a2')!.priceDate).toBeNull();
  });
  it(`ราคาเก่ากว่า ${RETIREMENT_STALE_PRICE_DAYS} วัน = เตือน (30 วันพอดียังไม่เก่า · 31 วันเก่า)`, () => {
    expect(RETIREMENT_STALE_PRICE_DAYS).toBe(30);
    expect(by('a1')!.priceStale).toBe(false);
    expect(by('a4')!.priceStale).toBe(false);
    expect(by('a5')!.priceStale).toBe(true);
  });
  it('ราคาลงวันที่ในอนาคตไม่ถูกใช้', () => {
    const d: InvestmentData = { ...data, prices: [price('a1', '2027-01-01', 999_000_000)] };
    expect(retirementAssetOptions(d, TODAY).find((o) => o.assetId === 'a1')!.valueSatang).toBeNull();
  });
});

describe('summarizeRetirementPortfolio: สรุปตามที่ผู้ใช้เลือก', () => {
  it('ค่าเริ่มต้นไม่เลือกสักอัน = มูลค่า 0 ไม่มีแผน DCA', () => {
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(), [plan('p1', 'a1', 100_000)]);
    expect(s).toMatchObject({ selectedCount: 0, valueSatang: 0, unpricedCount: 0, staleCount: 0, oldestPriceDate: null, dcaMonthly: 0, dcaPlanCount: 0 });
  });
  it('เลือกสินทรัพย์ที่มีราคา → มูลค่ารวมและวันที่ราคาเก่าสุด', () => {
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(['a1', 'a4']), []);
    expect(s.valueSatang).toBe(12_000 + 8_000);
    expect(s).toMatchObject({ selectedCount: 2, unpricedCount: 0, staleCount: 0, oldestPriceDate: '2026-10-21' });
  });
  it('มีสินทรัพย์ที่เลือกแต่ยังไม่มีราคา → นับแยก ไม่นับเป็น 0 เงียบๆ (ธงมูลค่าไม่ครบ)', () => {
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(['a1', 'a2']), []);
    expect(s.valueSatang).toBe(12_000);
    expect(s.unpricedCount).toBe(1);
  });
  it('นับสินทรัพย์ราคาเก่า', () => {
    expect(summarizeRetirementPortfolio(data, TODAY, new Set(['a5']), []).staleCount).toBe(1);
  });
  it('id ที่ไม่มีในพอร์ตถูกเมิน', () => {
    expect(summarizeRetirementPortfolio(data, TODAY, new Set(['zzz', 'a1']), []).selectedCount).toBe(1);
  });
  it('DCA: นับเฉพาะแผนที่ไม่พักของสินทรัพย์ที่เลือก', () => {
    const plans = [plan('p1', 'a1', 100_000), plan('p2', 'a1', 50_000), plan('p3', 'a1', 777_000, true), plan('p4', 'a4', 30_000), plan('p5', 'a2', 20_000)];
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(['a1', 'a4']), plans);
    expect(s.dcaMonthly).toBe(180_000);
    expect(s.dcaPlanCount).toBe(3);
  });
  it('สินทรัพย์เก็บถาวรแต่ยังถือ: เลือกได้ และนับแผน DCA ที่ไม่พักของมัน', () => {
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(['a5']), [plan('p1', 'a5', 40_000)]);
    expect(s).toMatchObject({ selectedCount: 1, valueSatang: 3_000, dcaMonthly: 40_000, dcaPlanCount: 1 });
  });
  it('เลือกแต่ไม่มีราคาเลย: unpricedCount = selectedCount (หน้าจอใช้ธงนี้เพื่อไม่คำนวณ)', () => {
    const s = summarizeRetirementPortfolio(data, TODAY, new Set(['a2']), []);
    expect(s).toMatchObject({ selectedCount: 1, unpricedCount: 1, valueSatang: 0 });
  });
  it('ไม่แก้ข้อมูลเข้า (ฟังก์ชันล้วน)', () => {
    const copy = JSON.stringify(data);
    summarizeRetirementPortfolio(data, TODAY, new Set(['a1']), []);
    expect(JSON.stringify(data)).toBe(copy);
  });
});

describe('ฟอร์มเกษียณ: เงินออมจากพอร์ตแทนค่าที่กรอกเอง (ห้ามบวกซ้ำ)', () => {
  const filled = (over: Partial<RetirementForm> = {}): RetirementForm => ({
    ...emptyRetirementForm(), currentAge: '30', lifeExpectancy: '85', monthlyExpense: '10,000', inflation: '0', returnBefore: '0', returnAfter: '0', ...over,
  });
  it('ส่งมูลค่าพอร์ตเข้ามา = ใช้ค่านั้นและเมินช่อง "เงินที่เก็บไว้แล้ว" (ไม่บวกซ้ำ)', () => {
    const manual = buildRetirementInput(filled({ currentSavings: '1,000,000' }));
    const linked = buildRetirementInput(filled({ currentSavings: '1,000,000' }), 100_000_000);
    const linkedBlank = buildRetirementInput(filled({ currentSavings: '' }), 100_000_000);
    if (!manual.ok || !linked.ok || !linkedBlank.ok) throw new Error('ควรผ่าน');
    expect(linked.input.currentSavings).toBe(100_000_000);
    expect(linked.result).toEqual(manual.result); // 1,000,000 บาท = 100,000,000 สตางค์ เท่ากัน ไม่ได้เป็น 2 เท่า
    expect(linkedBlank.result).toEqual(manual.result);
  });
  it('ช่องกรอกเองที่พิมพ์ผิดไม่ทำให้ล้มเมื่อใช้ค่าจากพอร์ต · ไม่ส่ง = ทำงานเหมือนเดิม', () => {
    expect(buildRetirementInput(filled({ currentSavings: 'abc' }), 5_000_000).ok).toBe(true);
    expect(buildRetirementInput(filled({ currentSavings: 'abc' })).ok).toBe(false);
  });
  it('มูลค่าพอร์ตใหญ่เกินเพดานเงินออม = ข้อผิดพลาดชี้ช่องเงินออม ไม่ตัดค่าเงียบ', () => {
    const r = buildRetirementInput(filled(), 100_000_000_001);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.field)).toContain('currentSavings');
  });
});

describe('ขอบเขตของโค้ดเฟส 2 (R16, R17, R18)', () => {
  const files = import.meta.glob(['/src/domain/retirement/progress.ts', '/src/app/retirementPortfolio.ts', '/src/ui/RetirementView.tsx', '/src/app/retirementForm.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const get = (n: string) => strip(Object.entries(files).find(([p]) => p.endsWith(n))![1]);
  it('มีไฟล์ครบ', () => expect(Object.keys(files)).toHaveLength(4));
  it('ไม่มี float / Math / parseFloat / toFixed', () => {
    for (const n of ['progress.ts', 'retirementPortfolio.ts', 'RetirementView.tsx', 'retirementForm.ts']) expect(get(n), n).not.toMatch(/parseFloat|toFixed|Math\./);
  });
  it('มูลค่าพอร์ตไม่ใช้ต้นทุนแทน: ไม่อ้าง position.cost / .cost / marketSummary ราคา null ในตัวอ่านเกษียณ', () => {
    const t = get('retirementPortfolio.ts');
    expect(t).not.toMatch(/\.cost\b|position\.cost|averageCost/);
    expect(t).toContain('market');
  });
  it('โดเมนเกษียณไม่ import ledger/storage/ui · ไม่เขียนข้อมูล (ไม่เรียก save*/record*/add*/delete* ของ repository)', () => {
    expect(get('progress.ts')).not.toMatch(/from '\.\.\/ledger|from '\.\.\/\.\.\/storage|from '\.\.\/\.\.\/ui|from '\.\.\/invest|from '\.\.\/bills/);
    expect(get('RetirementView.tsx')).not.toMatch(/\brepo\.(save(?!Settings)|record|add|delete|import)\w*/);
  });
  it('หน้าจอ: ไม่เลือกสินทรัพย์ไหนเป็นค่าเริ่มต้น · บอกที่มาของเงินออม · ป้ายแผนที่ตั้งไว้ · ไม่มีคำต้องห้าม', () => {
    const view = Object.values(files).find((t) => t.includes('RetirementView'))!;
    expect(view).toContain('new Set<string>()');
    expect(view).toContain('จากพอร์ต');
    expect(view).toContain('กรอกเอง');
    expect(view).toContain('แผนที่ตั้งไว้ ไม่ใช่เงินที่ผูกพันว่าจะทำตามจริง');
    expect(view).toContain('ยังไม่มีราคา');
    expect(view).toContain('มูลค่ารวมไม่ครบ');
    expect(view).toContain('unpricedCount === summary.value.selectedCount'); // ไม่คำนวณเมื่อที่เลือกไม่มีราคาเลย
    expect(view).toContain('เกินเพดาน 1,000 ล้านบาท');
    const text = view.replace(/ไม่ใช่การรับประกันผลลัพธ์/g, '');
    for (const w of ['รับประกัน', 'การันตี', 'แน่นอน', 'ปลอดภัยแน่', 'จะได้', 'เกษียณสบาย']) expect(text, w).not.toContain(w);
  });
});
