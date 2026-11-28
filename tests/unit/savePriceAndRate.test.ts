import { describe, expect, it } from 'vitest';
import { savePriceAndRate } from '../../src/app/savePriceAndRate';

/** บันทึกราคาแล้วจึงบันทึกอัตรา (สองคำสั่ง ไม่อะตอมมิก): ขั้นอัตราล้มหลังราคาเข้าแล้ว ผู้เรียกต้องรู้ จะได้ไม่บอกว่า "ยังไม่ได้บันทึก" */
const price = { assetId: 's', date: '2026-11-01', priceMicro: 150_000_000 };
const rate = { accountId: 'c', date: '2026-11-01', rateMicro: 35_000_000 };

function repo(fail: { price?: Error; rate?: Error } = {}) {
  const saved: string[] = [];
  return {
    saved,
    savePrice: async () => { if (fail.price) throw fail.price; saved.push('price'); },
    saveFxRate: async () => { if (fail.rate) throw fail.rate; saved.push('rate'); },
  };
}

describe('savePriceAndRate', () => {
  it('บันทึกครบทั้งสอง', async () => {
    const r = repo();
    expect(await savePriceAndRate(r, { price, rate })).toEqual({});
    expect(r.saved).toEqual(['price', 'rate']);
  });

  it('ราคาเข้าแล้ว อัตราล้ม: คืนความผิดพลาดของอัตรา ไม่โยน', async () => {
    const error = new Error('x');
    const r = repo({ rate: error });
    expect(await savePriceAndRate(r, { price, rate })).toEqual({ rateError: error });
    expect(r.saved).toEqual(['price']);
  });

  it('กรอกอัตราอย่างเดียวแล้วล้ม = โยน (ไม่มีอะไรเข้า)', async () => {
    await expect(savePriceAndRate(repo({ rate: new Error('x') }), { rate })).rejects.toThrow('x');
  });

  it('ราคาล้ม = โยน และไม่บันทึกอัตราต่อ', async () => {
    const r = repo({ price: new Error('p') });
    await expect(savePriceAndRate(r, { price, rate })).rejects.toThrow('p');
    expect(r.saved).toEqual([]);
  });

  it('กรอกราคาอย่างเดียว', async () => {
    const r = repo();
    await savePriceAndRate(r, { price });
    expect(r.saved).toEqual(['price']);
  });
});
