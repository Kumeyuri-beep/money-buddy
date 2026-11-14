import { describe, expect, it } from 'vitest';
import { drawShareCard } from '../../src/ui/shareCardCanvas';
import { buildAllocationModel, describeAllocation, OTHER_KEY } from '../../src/app/allocationView';
import { buildPortfolio } from '../../src/app/portfolio';
import { allocateBps, formatBps, groupSmallShares, TOTAL_BPS } from '../../src/domain/invest/allocation';
import type { InvestmentData, TradeRecord } from '../../src/domain/invest/types';

const sumBps = (xs: readonly { bps: number }[]): number => xs.reduce((s, x) => s + x.bps, 0);

describe('allocateBps: แบ่ง 10,000 bps ตามน้ำหนักด้วยจำนวนเต็ม', () => {
  it('รวม 10,000 พอดีเสมอ (เศษมากสุดได้ส่วนที่เหลือ)', () => {
    const r = allocateBps([{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }]);
    expect(sumBps(r)).toBe(TOTAL_BPS);
    expect(r.map((x) => x.bps).sort()).toEqual([3333, 3333, 3334]);
  });
  it('น้ำหนักเดียว = 100% · น้ำหนัก 0 ไม่ปรากฏ · ว่าง/รวมเป็น 0 = ไม่มีสัดส่วน', () => {
    expect(allocateBps([{ key: 'a', weight: 5 }, { key: 'z', weight: 0 }])).toEqual([{ key: 'a', bps: 10_000 }]);
    expect(allocateBps([])).toEqual([]);
    expect(allocateBps([{ key: 'a', weight: 0 }])).toEqual([]);
  });
  it('เรียงมากไปน้อย เท่ากันเรียงตามน้ำหนักแล้ว key (ผลคงที่ทุกครั้ง)', () => {
    const r = allocateBps([{ key: 'b', weight: 100 }, { key: 'a', weight: 100 }, { key: 'c', weight: 300 }]);
    expect(r.map((x) => x.key)).toEqual(['c', 'a', 'b']);
    expect(sumBps(r)).toBe(TOTAL_BPS);
  });
  it('น้ำหนักสตางค์ใหญ่ถึงขอบ (ใกล้ 2^53) ไม่เพี้ยน: ผลรวมยัง 10,000 และสัดส่วนถูก', () => {
    const big = Number.MAX_SAFE_INTEGER;
    const r = allocateBps([{ key: 'a', weight: big }, { key: 'b', weight: 1 }]);
    expect(sumBps(r)).toBe(TOTAL_BPS);
    expect(r[0]).toEqual({ key: 'a', bps: 10_000 });
    const half = allocateBps([{ key: 'a', weight: big - 1 }, { key: 'b', weight: big - 1 }]);
    expect(half.map((x) => x.bps)).toEqual([5000, 5000]);
  });
  it('น้ำหนักที่น้อยมาก (1 ใน 10^15) ได้ 0 bps แต่ยังรวม 10,000', () => {
    const r = allocateBps([{ key: 'a', weight: 1_000_000_000_000_000 }, { key: 'b', weight: 1 }]);
    expect(sumBps(r)).toBe(TOTAL_BPS);
    expect(r.find((x) => x.key === 'b')?.bps).toBe(0);
  });
  it('key ซ้ำ = RangeError (กันแจกเศษผิด) · -0 ถูกข้ามเหมือน 0', () => {
    expect(() => allocateBps([{ key: 'a', weight: 1 }, { key: 'a', weight: 1 }])).toThrow(RangeError);
    expect(allocateBps([{ key: 'a', weight: 5 }, { key: 'z', weight: -0 }])).toEqual([{ key: 'a', bps: 10_000 }]);
  });
  it('น้ำหนักติดลบ/ทศนิยม/NaN = RangeError', () => {
    for (const weight of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => allocateBps([{ key: 'a', weight }]), String(weight)).toThrow(RangeError);
    }
  });
});

describe('groupSmallShares / formatBps', () => {
  it('รวมส่วนที่เกินเป็น "อื่นๆ" โดยผลรวมคงเดิม', () => {
    const shares = allocateBps(Array.from({ length: 10 }, (_, i) => ({ key: `k${i}`, weight: 10 - i })));
    const g = groupSmallShares(shares, 4, OTHER_KEY);
    expect(g).toHaveLength(4);
    expect(g[3]?.key).toBe(OTHER_KEY);
    expect(sumBps(g)).toBe(TOTAL_BPS);
    expect(groupSmallShares(shares.slice(0, 3), 4)).toHaveLength(3);
  });
  it('formatBps ปัดครึ่งขึ้นที่ 0.1% ด้วยจำนวนเต็ม', () => {
    expect(formatBps(0)).toBe('0%');
    expect(formatBps(4)).toBe('<0.1%');
    expect(formatBps(5)).toBe('0.1%');
    expect(formatBps(1234)).toBe('12.3%');
    expect(formatBps(1235)).toBe('12.4%');
    expect(formatBps(5000)).toBe('50%');
    expect(formatBps(10_000)).toBe('100%');
    expect(formatBps(9995)).toBe('100%');
    expect(formatBps(9994)).toBe('99.9%');
    expect(formatBps(9999)).toBe('100%');
    expect(() => formatBps(10_001)).toThrow(RangeError);
    expect(() => formatBps(1.5)).toThrow(RangeError);
  });
});

const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 't', assetId: 'a1', kind: 'buy', date: '2026-11-01', createdAt: '2026-11-01T03:00:00.000Z', units: '100000000', amount: 100_000, fee: 0, withholding: 0, memo: '', ...over,
});
const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({
  assets: [
    { id: 'a1', name: 'กองทุนลับ ก', kind: 'fund', accountId: 'inv-a1' },
    { id: 'a2', name: 'หุ้นลับ ข', kind: 'stock', accountId: 'inv-a2' },
  ],
  trades: [trade({ id: 't1', assetId: 'a1', amount: 300_000 }), trade({ id: 't2', assetId: 'a2', amount: 100_000 })],
  prices: [],
  ...over,
});
const TODAY = '2026-11-10';

describe('buildAllocationModel: โมเดลที่ใช้วาดการ์ด (ไม่มียอดเงิน · ซ่อนชื่อเป็นค่าเริ่มต้น)', () => {
  it('ไม่มีสินทรัพย์ที่ถืออยู่ = null', () => {
    expect(buildAllocationModel(buildPortfolio({ assets: [], trades: [], prices: [] }, TODAY))).toBeNull();
    const sold = data({ trades: [trade({ id: 't1' }), trade({ id: 't2', kind: 'sell', date: '2026-11-02', priceMicro: 1_000_000, units: '100000000', amount: undefined })] });
    expect(buildAllocationModel(buildPortfolio({ ...sold, assets: [sold.assets[0]!] }, TODAY))).toBeNull();
  });
  it('ราคาไม่ครบ = สัดส่วนตามต้นทุน · ชื่อซ่อนเป็นค่าเริ่มต้น', () => {
    const m = buildAllocationModel(buildPortfolio(data(), TODAY))!;
    expect(m.basis).toBe('cost');
    expect(m.slices.map((s) => [s.label, s.bps])).toEqual([['สินทรัพย์ 1', 7500], ['สินทรัพย์ 2', 2500]]);
    expect(sumBps(m.slices)).toBe(TOTAL_BPS);
  });
  it('ราคาครบทุกสินทรัพย์ = สัดส่วนตามมูลค่า (ไม่ผสมกับต้นทุน)', () => {
    const d = data({ prices: [{ assetId: 'a1', date: '2026-11-09', priceMicro: 1_000_000 }, { assetId: 'a2', date: '2026-11-09', priceMicro: 9_000_000 }] });
    const m = buildAllocationModel(buildPortfolio(d, TODAY))!;
    expect(m.basis).toBe('value');
    expect(m.slices.map((s) => s.bps)).toEqual([9000, 1000]); // 1 หน่วย x 9 บาท : 1 หน่วย x 1 บาท
  });
  it('เปิดชื่อ = ใช้ชื่อจริง · ปิด = ไม่มีชื่อจริงอยู่ในโมเดลเลย', () => {
    const p = buildPortfolio(data(), TODAY);
    expect(buildAllocationModel(p, { showNames: true })!.slices.map((s) => s.label)).toEqual(['กองทุนลับ ก', 'หุ้นลับ ข']);
    const hidden = JSON.stringify(buildAllocationModel(p));
    expect(hidden).not.toContain('ลับ');
    expect(JSON.stringify(buildAllocationModel(p, { showNames: false }))).not.toContain('ลับ');
  });
  it('โมเดลไม่มียอดเงิน: ค่าตัวเลขมีเฉพาะ bps (≤ 10,000) และจำนวนสินทรัพย์', () => {
    const m = buildAllocationModel(buildPortfolio(data(), TODAY))!;
    const numbers: number[] = [];
    JSON.stringify(m, (_k, v) => (typeof v === 'number' ? (numbers.push(v), v) : v));
    expect(numbers.every((n) => Number.isInteger(n) && n >= 0 && n <= TOTAL_BPS)).toBe(true);
    expect(Object.keys(m).sort()).toEqual(['basis', 'excluded', 'holdings', 'slices', 'stalePrices']);
    for (const s of m.slices) expect(Object.keys(s).sort()).toEqual(['bps', 'isOther', 'key', 'label']);
  });
  it('สินทรัพย์เกิน maxVisible รวมเป็น "อื่นๆ"', () => {
    const assets = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, name: `n${i}`, kind: 'fund' as const, accountId: `inv-a${i}` }));
    const trades = assets.map((a, i) => trade({ id: `t${i}`, assetId: a.id, amount: 100_000 * (i + 1) }));
    const m = buildAllocationModel(buildPortfolio({ assets, trades, prices: [] }, TODAY), { maxVisible: 3 })!;
    expect(m.slices).toHaveLength(3);
    expect(m.slices[2]).toMatchObject({ label: 'อื่นๆ', isOther: true });
    expect(sumBps(m.slices)).toBe(TOTAL_BPS);
  });
  it('สินทรัพย์ข้อมูลผิดพลาดหรือมูลค่า 0 สตางค์ ไม่ถูกนับเงียบๆ: excluded บอกจำนวน · ราคาเก่าติดธง', () => {
    const base = data();
    const tiny = data({
      assets: [...base.assets, { id: 'a3', name: 'จิ๋ว', kind: 'fund', accountId: 'inv-a3' }, { id: 'a4', name: 'เสีย', kind: 'fund', accountId: 'inv-a4' }],
      trades: [
        ...base.trades,
        trade({ id: 't3', assetId: 'a3', units: '1', amount: 1 }),
        trade({ id: 't4', assetId: 'a4', kind: 'sell', units: '100000000', priceMicro: 1_000_000, amount: undefined }), // ขายโดยไม่มีหน่วย = ข้อมูลผิดพลาด
      ],
      prices: [
        { assetId: 'a1', date: '2026-10-01', priceMicro: 1_000_000 }, { assetId: 'a2', date: '2026-11-09', priceMicro: 1_000_000 },
        { assetId: 'a3', date: '2026-11-09', priceMicro: 1 },
      ],
    });
    const m = buildAllocationModel(buildPortfolio(tiny, TODAY))!;
    expect(m.basis).toBe('value');
    expect(m.excluded).toBe(2); // a4 ผิดพลาด + a3 มูลค่า 0 สตางค์
    expect(m.stalePrices).toBe(true); // a1 ราคาเก่ากว่า 7 วัน
    expect(sumBps(m.slices)).toBe(TOTAL_BPS);
    expect(buildAllocationModel(buildPortfolio(data(), TODAY))!.excluded).toBe(0);
  });
  it('describeAllocation ใช้ป้ายตามที่เลือกเท่านั้น', () => {
    const p = buildPortfolio(data(), TODAY);
    expect(describeAllocation(buildAllocationModel(p)!, formatBps)).toBe('สัดส่วนพอร์ตตามต้นทุน: สินทรัพย์ 1 75% · สินทรัพย์ 2 25%');
    expect(describeAllocation(buildAllocationModel(p, { showNames: true })!, formatBps)).toContain('กองทุนลับ ก');
  });
});

/** ctx ปลอมที่จดทุกข้อความที่ถูกวาดลงรูป (ตรวจว่ารูปมีอะไรจริง ไม่ใช่แค่ตรวจซอร์ส) */
function recordDraw(model: ReturnType<typeof buildAllocationModel> & object, asOf: string): string[] {
  const texts: string[] = [];
  const noop = () => undefined;
  const ctx = {
    createLinearGradient: () => ({ addColorStop: noop }),
    fillRect: noop, beginPath: noop, save: noop, restore: noop, clip: noop, fill: noop, rect: noop,
    measureText: (t: string) => ({ width: t.length * 10 }),
    fillText: (t: string) => void texts.push(t),
    fillStyle: '', font: '', textAlign: '', textBaseline: '',
  };
  drawShareCard(ctx as unknown as CanvasRenderingContext2D, model, asOf);
  return texts;
}

describe('รูปที่วาดจริง: ไม่มียอดเงิน/ชื่อจริง (ตรวจข้อความทุกบรรทัดที่ส่งให้ fillText)', () => {
  const p = buildPortfolio(data(), TODAY);
  it('ปิดชื่อ: ไม่มีชื่อจริง ไม่มี "บาท" ไม่มี ฿ และตัวเลขทุกตัวเป็น % หรือเลขลำดับ "สินทรัพย์ N" หรือวันที่ที่ส่งเข้า', () => {
    const texts = recordDraw(buildAllocationModel(p)!, 'ณ พ. 10 พ.ย.');
    const all = texts.join('\n');
    expect(all).not.toContain('ลับ');
    expect(all).not.toMatch(/บาท|฿|สตางค์|หน่วย/);
    for (const t of texts) {
      const digits = t.replace(/สินทรัพย์ \d+/g, '').replace(/\d+(\.\d)?%/g, '').replace('ณ พ. 10 พ.ย.', '');
      expect(digits, t).not.toMatch(/\d/);
    }
    expect(texts).toContain('75%');
    expect(texts).toContain('25%');
  });
  it('เปิดชื่อ: มีชื่อจริงเท่านั้นที่เพิ่ม ยังไม่มียอดเงิน', () => {
    const all = recordDraw(buildAllocationModel(p, { showNames: true })!, 'ณ x').join('\n');
    expect(all).toContain('กองทุนลับ ก');
    expect(all).not.toMatch(/บาท|฿|สตางค์|หน่วย/);
  });
  it('ชื่อมีอักขระควบคุม/ทิศทาง (U+202E) ถูกตัดออกก่อนวาด', () => {
    const d = data({ assets: [{ id: 'a1', name: 'ก\u202Eข\u0007ค', kind: 'fund', accountId: 'inv-a1' }, data().assets[1]!] });
    const m = buildAllocationModel(buildPortfolio(d, TODAY), { showNames: true })!;
    expect(m.slices.map((s) => s.label)).toContain('กขค');
  });
});

describe('ความเป็นส่วนตัวของการ์ดแชร์: ไม่ส่งข้อมูลออกเครือข่ายและไม่ฝังยอดเงินในรูป', () => {
  const sources = import.meta.glob(['/src/ui/ShareCardPanel.tsx', '/src/ui/shareCardCanvas.ts', '/src/app/allocationView.ts', '/src/domain/invest/allocation.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const stripped = Object.entries(sources).map(([p, t]) => [p, t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')] as const);
  it('มีไฟล์ครบ (กัน glob ว่างแล้วผ่านเปล่าๆ)', () => {
    expect(stripped).toHaveLength(4);
  });
  it('ไม่มี fetch / XMLHttpRequest / sendBeacon / WebSocket / EventSource / import จากเครือข่าย', () => {
    for (const [path, text] of stripped) {
      expect(text, path).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|https?:\/\//);
      expect(text, path).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
  it('รูปไม่ได้อ่านยอดเงิน/หน่วย/ชื่อผู้ใช้: ตัววาดรับเฉพาะโมเดลสัดส่วนและป้ายวันที่', () => {
    const canvas = stripped.find(([p]) => p.endsWith('shareCardCanvas.ts'))![1];
    expect(canvas.match(/^import .*$/gm)).toEqual(["import { formatBps } from '../domain/invest/allocation';", "import type { AllocationModel } from '../app/allocationView';", "import { cardColor, chartColor } from './chartColors';"]); // chartColors = อ่านชื่อสีตามธีมเท่านั้น (ไม่มีข้อมูลผู้ใช้/เครือข่าย)
    expect(canvas).not.toMatch(/\b(portfolio|position|totals|market|trades|assets|email|userId|session)\b/i);
    expect(canvas).toMatch(/drawShareCard\(ctx: CanvasRenderingContext2D, model: AllocationModel, asOfLabel: string\)/);
  });
  it('ไฟล์ที่แชร์ตั้งชื่อกลางๆ ไม่มีข้อมูลส่วนตัว', () => {
    const panel = stripped.find(([p]) => p.endsWith('ShareCardPanel.tsx'))![1];
    expect(panel).toContain("const FILE_NAME = 'portfolio-share.png'");
  });
});

describe('การ์ดสัดส่วนในหน้าภาพรวม: แสดงเฉพาะสัดส่วน ไม่แสดงยอดเงิน', () => {
  const panel = Object.values(
    import.meta.glob('/src/ui/overview/AllocationPanel.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
  )[0] ?? '';
  it('ไม่ใช้ตัวจัดรูปแบบเงิน และไม่เรียกเครือข่ายเอง (อ่านผ่าน repository เหมือนหน้าพอร์ต)', () => {
    expect(panel.length).toBeGreaterThan(200);
    expect(panel).not.toMatch(/formatBaht|satang|toBahtString|formatMicro|\.cost\b|\.value\b|totals/);
    expect(panel).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage/);
    expect(panel).toContain('buildAllocationModel');
  });
});
