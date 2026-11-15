import { describe, expect, it } from 'vitest';
import { buildInvestBadge } from '../../src/app/investBadge';
import type { InvestmentData } from '../../src/domain/invest/types';

const data = (over: Partial<InvestmentData> = {}): InvestmentData => ({ assets: [], trades: [], prices: [], ...over });

describe('buildInvestBadge', () => {
  it('ยังโหลดไม่เสร็จ/ไม่มีข้อมูล: ไม่มีวันที่และอัตรา (ไม่เดา)', () => {
    expect(buildInvestBadge(null, '2026-11-16')).toEqual({ updatedOn: null, rateMicro: null, rateText: null });
    expect(buildInvestBadge(data(), '2026-11-16')).toEqual({ updatedOn: null, rateMicro: null, rateText: null });
  });
  it('วันที่อัปเดต = วันล่าสุดของราคาหรืออัตราที่ไม่เกินวันนี้ · อัตราแสดงอย่างน้อย 2 ตำแหน่ง', () => {
    const b = buildInvestBadge(
      data({
        prices: [{ assetId: 'a', date: '2026-11-10', priceMicro: 1 }, { assetId: 'a', date: '2026-11-20', priceMicro: 1 }],
        fxRates: [{ accountId: 'u', date: '2026-11-12', rateMicro: 35_000_000 }, { accountId: 'u', date: '2026-11-30', rateMicro: 40_000_000 }],
      }),
      '2026-11-16',
    );
    expect(b).toEqual({ updatedOn: '2026-11-12', rateMicro: 35_000_000, rateText: '35.00 ฿/$' });
  });
  it('มีแต่ราคา (ไม่มีอัตรา): มีวันที่ ไม่มีอัตรา · อัตราละเอียดแสดงครบ', () => {
    expect(buildInvestBadge(data({ prices: [{ assetId: 'a', date: '2026-11-14', priceMicro: 1 }] }), '2026-11-16')).toEqual({ updatedOn: '2026-11-14', rateMicro: null, rateText: null });
    expect(buildInvestBadge(data({ fxRates: [{ accountId: 'u', date: '2026-11-14', rateMicro: 34_567_891 }] }), '2026-11-16').rateText).toBe('34.567891 ฿/$');
  });
});
