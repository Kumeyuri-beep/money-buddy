import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { codedMessage, hasCode, messageFor, registeredCodes, withCode } from '../../src/domain/errors/coded';
import { carryCode } from '../../src/storage/storageMessages';
import { createDexieRepository } from '../../src/storage/ledgerRepository';
import { SettingsConflictError, StorageError } from '../../src/storage/repository';
import {
  createSupabaseRepository,
  rowToAccount,
  rowToAsset,
  rowToFxExchange,
  rowToFxRate,
  rowToPrice,
  rowToTrade,
  storageErrorFrom,
} from '../../src/storage/supabaseRepository';

/**
 * Golden: ข้อความไทยทุกตัวคัดลอกจากโค้ดเดิมก่อนแก้ (R1) · ผลต้องเหมือนเดิมทุกตัวอักษร
 * ส่วนท้ายไฟล์ (หลังเพิ่มรหัส) ตรวจรหัส+params และอังกฤษ
 */

/** client จำลอง: ทุกคำสั่งตอบ data/error ตามที่กำหนด */
function fakeClient(result: { data?: unknown; error?: { message?: string; code?: string } | null } = {}): SupabaseClient {
  const proxy: Record<string, unknown> = {};
  for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'range', 'limit', 'maybeSingle']) proxy[op] = () => proxy;
  proxy.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: null }).then(resolve, reject);
  return { from: () => proxy, rpc: () => proxy } as unknown as SupabaseClient;
}

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('ไม่โยน error');
}
async function rejected(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('ไม่โยน error');
}

const repo = (result?: Parameters<typeof fakeClient>[0]) => createSupabaseRepository(fakeClient(result), 'u1');
const longName = 'x'.repeat(201);
const tradeRow = { id: 't', asset_id: 'a', kind: 'buy', date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', units: null, price_micro: null, amount: null, fee: 0, withholding: 0, memo: '', entry_id: null };

describe('golden ข้อความไทยของ storage (ก่อนแตะโค้ด)', () => {
  it('storageErrorFrom', () => {
    expect(storageErrorFrom({ message: 'duplicate key', code: '23505' }).message).toBe('รหัสนี้มีอยู่แล้ว ไม่เขียนทับ');
    expect(storageErrorFrom({ message: 'x', code: '23503' }).message).toBe('ข้อมูลอ้างอิงไม่ถูกต้อง (บัญชีหรือบิลที่เกี่ยวข้องไม่มีอยู่)');
    expect(storageErrorFrom({ message: 'x', code: '22003' }).message).toBe('ข้อมูลไม่ผ่านการตรวจของฐานข้อมูล');
    expect(storageErrorFrom({ message: 'Failed to fetch' }).message).toBe('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
    expect(storageErrorFrom({ message: 'boom' }).message).toBe('บันทึกหรืออ่านข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง');
    expect(storageErrorFrom({ message: 'ข้อความจากฐานข้อมูล', code: '23514' }).message).toBe('ข้อความจากฐานข้อมูล');
    expect(storageErrorFrom({ message: 'bill_cycle_once' }).message).toBe('รอบนี้จ่ายแล้ว (อาจจ่ายจากอีกหน้าต่างหนึ่งไปก่อนแล้ว) โหลดใหม่เพื่อดูสถานะล่าสุด');
  });

  it('แปลงแถวจากเซิร์ฟเวอร์', () => {
    expect(thrown(() => rowToAccount({ id: 'a', type: 'asset', name: 'n', currency: 'THB', archived: false, sort_order: null, kind: 'zzz' })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ประเภทบัญชี "zzz"');
    expect(thrown(() => rowToAsset({ id: 'a', name: 'n', kind: 'zzz', account_id: 'x', archived: false })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ชนิดสินทรัพย์ "zzz"');
    expect(thrown(() => rowToAsset({ id: 'a', name: 'n', kind: 'fund', account_id: 'x', archived: false, instrument_currency: 'JPY' })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: สกุลของสินทรัพย์ "JPY"');
    expect(thrown(() => rowToTrade({ ...tradeRow, kind: 'zzz' })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ชนิดรายการลงทุน "zzz"');
    expect(thrown(() => rowToTrade({ ...tradeRow, units: 'abc' })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: จำนวนหน่วยไม่ใช่ข้อความจำนวนเต็ม');
    expect(thrown(() => rowToTrade({ ...tradeRow, created_at: 'infinity' })).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: เวลาบันทึกของรายการลงทุนอยู่นอกช่วงที่รองรับ');
    expect(thrown(() => rowToFxExchange({ id: 'f', date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', direction: 'zzz', thb_satang: 1, usd_cents: 1, rate_micro: 1, memo: '', entry_id: 'e' } as never)).message).toBe('ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ทิศทางการแลกเงิน "zzz"');
  });

  it('safeInt: ชื่อฟิลด์ไทยทุกตัว', () => {
    const msg = (what: string) => `ข้อมูลจากเซิร์ฟเวอร์ไม่ถูกต้อง: ${what} ไม่ใช่จำนวนเต็มที่ปลอดภัย`;
    expect(thrown(() => rowToTrade({ ...tradeRow, fee: 1.5 })).message).toBe(msg('ค่าธรรมเนียม'));
    expect(thrown(() => rowToTrade({ ...tradeRow, withholding: 1.5 })).message).toBe(msg('ภาษีหัก ณ ที่จ่าย'));
    expect(thrown(() => rowToTrade({ ...tradeRow, price_micro: 1.5 })).message).toBe(msg('ราคาต่อหน่วย'));
    expect(thrown(() => rowToTrade({ ...tradeRow, amount: 1.5 })).message).toBe(msg('มูลค่า'));
    expect(thrown(() => rowToTrade({ ...tradeRow, fx_rate_micro: 1.5 })).message).toBe(msg('อัตราแลกเปลี่ยน'));
    expect(thrown(() => rowToFxRate({ account_id: 'a', date: '2026-01-01', rate_micro: 1.5 })).message).toBe(msg('อัตราแลกเปลี่ยน'));
    expect(thrown(() => rowToPrice({ asset_id: 'a', date: '2026-01-01', price_micro: 1.5 })).message).toBe(msg('ราคา'));
    const fx = { id: 'f', date: '2026-01-01', created_at: '2026-01-01T00:00:00Z', direction: 'thb_to_usd', thb_satang: 100, usd_cents: 100, rate_micro: 1, memo: '', entry_id: 'e' };
    expect(thrown(() => rowToFxExchange({ ...fx, thb_satang: 1.5 } as never)).message).toBe(msg('จำนวนบาทที่แลก'));
    expect(thrown(() => rowToFxExchange({ ...fx, usd_cents: 1.5 } as never)).message).toBe(msg('จำนวน USD ที่แลก'));
    expect(thrown(() => rowToFxExchange({ ...fx, rate_micro: 1.5 } as never)).message).toBe(msg('อัตราแลกเปลี่ยน'));
  });

  it('เมธอดลงทุน: ตรวจอินพุต', async () => {
    const r = repo();
    expect((await rejected(() => r.addAsset({ id: '', name: 'n', kind: 'fund' }))).message).toBe('รหัสสินทรัพย์ไม่ถูกต้อง');
    expect((await rejected(() => r.addAsset({ id: 'a', name: longName, kind: 'fund' }))).message).toBe('ชื่อสินทรัพย์ต้องยาว 1-200 ตัวอักษร');
    expect((await rejected(() => r.addAsset({ id: 'a', name: 'n', kind: 'zzz' as never }))).message).toBe('ชนิดสินทรัพย์ไม่ถูกต้อง');
    expect((await rejected(() => r.addWallet({ id: '', name: 'n' }))).message).toBe('รหัสกระเป๋าไม่ถูกต้อง');
    expect((await rejected(() => r.addWallet({ id: 'w', name: longName }))).message).toBe('ชื่อกระเป๋าต้องยาว 1-200 ตัวอักษร');
    expect((await rejected(() => r.addUsdCash({ id: '', name: 'n' }))).message).toBe('รหัสบัญชีไม่ถูกต้อง');
    expect((await rejected(() => r.addUsdCash({ id: 'c', name: longName }))).message).toBe('ชื่อบัญชีต้องยาว 1-200 ตัวอักษร');
    expect((await rejected(() => r.addUsdStock({ id: '', name: 'n', ticker: 'T', exchange: 'NYSE' }))).message).toBe('รหัสสินทรัพย์ไม่ถูกต้อง');
    expect((await rejected(() => r.addUsdStock({ id: 's', name: longName, ticker: 'T', exchange: 'NYSE' }))).message).toBe('ชื่อหุ้นต้องยาว 1-200 ตัวอักษร');
    expect((await rejected(() => r.addUsdStock({ id: 's', name: 'n', ticker: '', exchange: 'NYSE' }))).message).toBe('ticker ต้องยาว 1-20 ตัวอักษร');
    expect((await rejected(() => r.addUsdStock({ id: 's', name: 'n', ticker: 'T', exchange: 'XXX' }))).message).toBe('ตลาดไม่อยู่ในรายการที่รองรับ');
    expect((await rejected(() => r.saveFxRate({ accountId: 'a', date: '2026-01-01', rateMicro: 0 }))).message).toBe('อัตราแลกเปลี่ยนต้องเป็นจำนวนเต็ม micro ที่มากกว่า 0');
    expect((await rejected(() => r.savePrice({ assetId: 'a', date: '2026-01-01', priceMicro: 0 }))).message).toBe('ราคาต้องเป็นจำนวนเต็ม micro-baht ที่มากกว่า 0');
  });

  it('เมธอดลงทุน: ไม่พบข้อมูล', async () => {
    const r = repo(); // data = null
    const trade = { id: 't', assetId: 'a', kind: 'buy', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', fee: 0, withholding: 0, memo: '' } as never;
    expect((await rejected(() => r.recordTrade({ trade }))).message).toBe('ไม่พบสินทรัพย์นี้');
    expect((await rejected(() => r.recordTradeFx({ trade, cashAccountId: 'c' }))).message).toBe('ไม่พบสินทรัพย์นี้');
    expect((await rejected(() => r.deleteFxExchange('f'))).message).toBe('ไม่พบรายการแลกเงินนี้ อาจถูกลบไปแล้ว');
    expect((await rejected(() => r.deleteTrade('t'))).message).toBe('ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
  });

  it('recordTradeFx: หุ้นไม่ใช่ USD / ไม่มีอัตรา', async () => {
    const thbAsset = { id: 'a', name: 'n', kind: 'fund', account_id: 'x', archived: false };
    const usdAsset = { ...thbAsset, instrument_currency: 'USD' };
    const trade = { id: 't', assetId: 'a', kind: 'buy', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', fee: 0, withholding: 0, memo: '' } as never;
    expect((await rejected(() => repo({ data: thbAsset }).recordTradeFx({ trade, cashAccountId: 'c' }))).message).toBe('รายการนี้ใช้ได้เฉพาะหุ้นสกุล USD');
    expect((await rejected(() => repo({ data: usdAsset }).recordTradeFx({ trade, cashAccountId: 'c' }))).message).toBe('ต้องมีอัตราแลกเปลี่ยนของวันรายการ');
  });

  it('ค่าตั้งค่าชนกัน + ที่เก็บในเครื่อง', async () => {
    expect(new SettingsConflictError().message).toBe('ค่าตั้งค่าถูกแก้จากแท็บหรืออุปกรณ์อื่นแล้ว โหลดค่าล่าสุดแล้ว ลองบันทึกอีกครั้ง');
    const local = createDexieRepository({} as never);
    const e = await rejected(() => local.addAsset({ id: 'a', name: 'n', kind: 'fund' }));
    expect(e).toBeInstanceOf(StorageError);
    expect(e.message).toBe('พอร์ตลงทุนใช้ได้เฉพาะบัญชีออนไลน์ (ที่เก็บในเครื่องไม่รองรับ)');
  });
});

describe('รหัส + อังกฤษ ของ storage', () => {
  const THAI = /[฀-๿]/;
  type P = Record<string, string | number>;
  const ALL: [string, P][] = [
    ['store.dbDuplicate', {}], ['store.dbBadReference', {}], ['store.dbRejected', {}], ['store.network', {}], ['store.saveFailed', {}], ['store.readIncomplete', {}],
    ['store.badAccountKind', { value: 'zzz' }], ['store.badAssetKind', { value: 'zzz' }], ['store.badAssetCurrency', { value: 'JPY' }], ['store.badTimestamp', {}],
    ['store.badTradeKind', { value: 'zzz' }], ['store.badUnits', {}], ['store.badFxDirection', { value: 'zzz' }],
    ['store.assetIdInvalid', {}], ['store.assetNameLength', { max: 200 }], ['store.assetKindInvalid', {}], ['store.walletIdInvalid', {}], ['store.walletNameLength', { max: 200 }],
    ['store.usdAccountIdInvalid', {}], ['store.usdAccountNameLength', { max: 200 }], ['store.stockNameLength', { max: 200 }], ['store.tickerLength', { max: 20 }],
    ['store.exchangeUnsupported', {}], ['store.assetNotFound', {}], ['store.usdOnly', {}], ['store.fxRateRequired', {}], ['store.fxExchangeNotFound', {}],
    ['store.tradeNotFound', {}], ['store.tradeDeleteFailed', {}], ['store.fxRateInvalid', {}], ['store.priceInvalid', {}], ['store.settingsConflict', {}], ['store.localInvestUnsupported', {}],
    ['store.categoryCount', {}], ['store.categoryId', {}], ['store.categoryName', {}], ['store.categorySort', {}], ['store.categoryTarget', {}], ['store.categoryDuplicateId', {}], ['store.categoryDuplicateName', {}], ['store.categoryTargetTotal', {}],
    ...(['fee', 'withholding', 'unitPrice', 'tradeValue', 'fxRate', 'thbExchanged', 'usdExchanged', 'price', 'lineAmount', 'billAmount'] as const).map((field): [string, P] => ['store.badNumber', { field }]),
  ];

  it('อังกฤษไม่มีตัวอักษรไทย และใส่ค่า params ครบ', () => {
    for (const [code, params] of ALL) {
      const en = messageFor(code, params, 'en') ?? '';
      expect(en, code).not.toBe('');
      expect(THAI.test(en), `${code}: ${en}`).toBe(false);
      if (code !== 'store.badNumber') for (const v of Object.values(params)) expect(en, code).toContain(String(v));
    }
  });
  it('ครบทุกรหัสที่ลงทะเบียน (กลุ่ม store.)', () => {
    const covered = new Set(ALL.map(([c]) => c));
    expect(registeredCodes().filter((c) => c.startsWith('store.')).filter((c) => !covered.has(c))).toEqual([]);
  });
  it('error ที่โยนมีรหัส+params และอังกฤษตรงแม่แบบ', async () => {
    const e1 = await rejected(() => repo().addAsset({ id: 'a', name: longName, kind: 'fund' }));
    expect(e1).toBeInstanceOf(StorageError);
    expect(hasCode(e1) && e1.code).toBe('store.assetNameLength');
    expect(hasCode(e1) && e1.params).toEqual({ max: 200 });
    expect(codedMessage(e1, 'en')).toBe('Asset name must be 1-200 characters long.');
    const e2 = thrown(() => rowToTrade({ ...tradeRow, fee: 1.5 }));
    expect(hasCode(e2) && e2.params).toEqual({ field: 'fee' });
    expect(codedMessage(e2, 'en')).toBe('Invalid server data: fee is not a safe whole number.');
    const e3 = storageErrorFrom({ message: 'duplicate key', code: '23505' });
    expect(hasCode(e3) && e3.code).toBe('store.dbDuplicate');
    expect(hasCode(new SettingsConflictError())).toBe(true);
    expect(new SettingsConflictError()).toBeInstanceOf(StorageError);
  });
  it('ข้อความไทยจากฐานข้อมูลเองยังไม่มีรหัส (ผ่านต่อเป็นไทยเดิม)', () => {
    expect(hasCode(storageErrorFrom({ message: 'ข้อความจากฐานข้อมูล', code: '23514' }))).toBe(false);
  });
  it('ห่อ error ที่มีรหัสจากชั้น domain: รหัส+params ถูกส่งต่อ ข้อความเดิม', () => {
    const src = withCode(new RangeError('ไทย'), 'x.test', { n: 1 });
    const w = carryCode(new StorageError(src.message), src);
    expect(w.message).toBe('ไทย');
    expect(hasCode(w) && w.code).toBe('x.test');
    expect(hasCode(carryCode(new StorageError('a'), new RangeError('b')))).toBe(false);
  });
});
