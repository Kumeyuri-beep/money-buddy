import { describe, expect, it } from 'vitest';
import { baht, signed } from '../../src/app/bahtFormat';
import { ASSET_KIND_LABEL } from '../../src/domain/invest/labels';
import { formatBaht, satang } from '../../src/domain/money/satang';

/** รวมตัวจัดรูปแบบที่ประกาศซ้ำไว้ที่เดียว (14 พ.ย. 2569) · ต้องให้ผลเหมือนฉบับเดิมทุกค่า */
// ฉบับเดิมที่เคยประกาศซ้ำในหน้าพอร์ต/แถวสินทรัพย์/รายการลงทุน/หน้าเกษียณ (คัดลอกตามต้นฉบับ ใช้เทียบ)
const oldBaht = (n: number): string => formatBaht(satang(n));
const oldSigned = (n: number): string => (n > 0 ? `+${oldBaht(n)}` : oldBaht(n));
const samples = [0, 1, 5, 9, 10, 99, 100, 101, 999, 1_000, 12_345, 99_999, 100_000, 123_456, 1_000_000, 123_456_789, 9_007_199_254_740, -1, -99, -100, -12_345, -123_456_789];

describe('baht / signed (รวมที่เดียว)', () => {
  it('baht ให้ผลเท่าฉบับเดิมทุกค่าตัวอย่าง (ศูนย์ น้อยมาก สตางค์เศษ หลักล้าน ค่าลบ)', () => {
    for (const n of samples) expect(baht(n), String(n)).toBe(oldBaht(n));
  });
  it('signed ให้ผลเท่าฉบับเดิม: บวกมี + · ศูนย์ไม่มีเครื่องหมาย · ลบตามรูปแบบ formatBaht', () => {
    for (const n of samples) expect(signed(n), String(n)).toBe(oldSigned(n));
    expect(signed(12_345).startsWith('+')).toBe(true);
    expect(signed(0)).toBe(baht(0));
    expect(signed(0).startsWith('+')).toBe(false);
    expect(signed(-1).startsWith('+')).toBe(false);
  });
  it('ค่าที่ไม่ใช่จำนวนเต็มสตางค์ยังถูกปฏิเสธเหมือนเดิม (ไม่กลืนความผิดพลาดเงียบๆ)', () => {
    const attempt = (fn: () => string): string => {
      try {
        return 'ok:' + fn();
      } catch (e) {
        return 'throw:' + (e instanceof Error ? e.constructor.name : 'x');
      }
    };
    for (const n of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(attempt(() => baht(n)), String(n)).toBe(attempt(() => oldBaht(n)));
      expect(attempt(() => signed(n)), String(n)).toBe(attempt(() => oldSigned(n)));
    }
  });
});

describe('ASSET_KIND_LABEL', () => {
  it('ชื่อไทยครบทุกชนิดเหมือนเดิม', () => {
    expect(ASSET_KIND_LABEL).toEqual({ fund: 'กองทุน', stock: 'หุ้น', other: 'อื่นๆ' });
  });
});

describe('ไม่มีการประกาศซ้ำอีก', () => {
  const ui = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('ไม่มีไฟล์ไหนในหน้าจอ/แอปประกาศ baht/signed/ASSET_KIND_LABEL ของตัวเองซ้ำ (ยกเว้นต้นฉบับ)', () => {
    for (const [path, text] of Object.entries(ui)) {
      if (path === '/src/app/bahtFormat.ts' || path === '/src/domain/invest/labels.ts' || path.startsWith('/src/domain/tax/')) continue;
      expect(text, path).not.toMatch(/^const baht = \(n: number\): string/m);
      expect(text, path).not.toMatch(/^const signed = \(n: number\): string/m);
      expect(text, path).not.toMatch(/ASSET_KIND_LABEL\s*(:\s*Record<AssetKind, string>)?\s*=\s*\{/);
    }
  });
  it('ไฟล์ที่เคยประกาศซ้ำนำเข้าจากที่เดียว', () => {
    const imports = (p: string, what: RegExp) => expect(ui[p], p).toMatch(what);
    imports('/src/ui/AssetFigures.tsx', /import \{ baht, signed \} from '..\/app\/bahtFormat'/);
    imports('/src/ui/PortfolioView.tsx', /import \{ baht, signed \} from '..\/app\/bahtFormat'/);
    imports('/src/ui/RetirementView.tsx', /import \{ baht \} from '..\/app\/bahtFormat'/);
    imports('/src/ui/TradeItem.tsx', /import \{ baht \} from '..\/app\/bahtFormat'/);
    imports('/src/ui/AssetFigures.tsx', /export const ASSET_KIND_LABEL_EN: Record<AssetKind, string>/); // domain ASSET_KIND_LABEL ยังเป็นไทย
    imports('/src/ui/PortfolioView.tsx', /import [{] AssetFigures, ASSET_KIND_LABEL_EN [}] from '[.]\/AssetFigures'/);
  });
});
