import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { hasCode, codedMessage } from '../../src/domain/errors/coded';
import { tradesFingerprint } from '../../src/domain/invest/tradesFingerprint';
import { investError } from '../../src/ui/invest/investError';
import { createSupabaseRepository, type AssetRow, type TradeRow } from '../../src/storage/supabaseRepository';
import { StorageError } from '../../src/storage/repository';
import type { TradeRecord } from '../../src/domain/invest/types';

/**
 * R2 แก้รายการที่บันทึกแล้ว + ลบสินทรัพย์ (ฝั่งเว็บ): replaceTrade / deleteAsset
 * ตรวจกติกาก่อนส่ง (ซ้ำกับฐานข้อมูล) · ต้นทุนที่ตัดออกของรายการขายคำนวณด้วย replay ที่ไม่รวมรายการเดิม ·
 * basedOn = ลายนิ้วมือของรายการทั้งหมดของสินทรัพย์ (รวมรายการที่กำลังแก้) · PT409/40P01/40001 = "Data changed — reload and try again"
 */

interface Call { kind: 'from' | 'rpc'; name: string; ops: string[]; args?: unknown }
type Respond = (call: Call) => { data?: unknown; error?: { message?: string; code?: string } | null };

function fakeClient(respond: Respond) {
  const calls: Call[] = [];
  const builder = (call: Call) => {
    // หัวคำขอ x-expected-user ตรวจใน expectedUserHeader.test.ts
    const proxy: Record<string, unknown> = { headers: new Headers(), setHeader: () => proxy };
    for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'range', 'limit', 'maybeSingle']) {
      proxy[op] = (...a: unknown[]) => {
        call.ops.push(op);
        if (op === 'insert' || op === 'update' || op === 'upsert') call.args = a[0];
        return proxy;
      };
    }
    proxy.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const r = respond(call);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: null }).then(resolve, reject);
    };
    return proxy;
  };
  const client = {
    from: (name: string) => { const c: Call = { kind: 'from', name, ops: [] }; calls.push(c); return builder(c); },
    rpc: (name: string, args: unknown) => { const c: Call = { kind: 'rpc', name, ops: [], args }; calls.push(c); return builder(c); },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const thbAsset: AssetRow = { id: 'a1', name: 'Fund A', kind: 'fund', account_id: 'inv1', archived: false };
const usdAsset: AssetRow = { id: 'u1', name: 'Stock U', kind: 'stock', account_id: 'inv-us', archived: false, instrument_currency: 'USD', ticker: 'ABC', exchange: 'NASDAQ' };

const row = (o: Partial<TradeRow> & Pick<TradeRow, 'id' | 'kind' | 'date'>): TradeRow => ({
  asset_id: 'a1', created_at: `${o.date}T03:00:00+00:00`, units: null, price_micro: null, amount: null, fee: 0, withholding: 0, memo: '', entry_id: `${o.id}-entry`, ...o,
});
// ซื้อ 10 หน่วย มูลค่า 500.00 ค่าธรรมเนียม 1.00 (ต้นทุน 50100) · ขาย 5 หน่วยวันที่ 11-10
const buy = row({ id: 'b1', kind: 'buy', date: '2026-11-05', units: '1000000000', price_micro: 5000000, amount: 50000, fee: 100 });
const sell = row({ id: 's1', kind: 'sell', date: '2026-11-10', units: '500000000', price_micro: 6000000, fee: 10 });
const div = row({ id: 'd1', kind: 'dividend', date: '2026-11-02', amount: 1000, withholding: 100 });

function repoWith(assets: AssetRow, trades: TradeRow[], failRpc?: { code: string; message: string }) {
  const { client, calls } = fakeClient((c) => {
    if (c.kind === 'rpc') return failRpc ? { error: failRpc } : { data: { ok: true } };
    if (c.name === 'assets') return { data: assets };
    if (c.name === 'trades') return c.ops.includes('maybeSingle') ? { data: trades[0] } : { data: trades };
    return { data: [] };
  });
  return { repo: createSupabaseRepository(client, 'u1'), calls };
}
/** ให้ maybeSingle ของ trades คืนแถวเดิมที่กำลังแก้ (ตัวแรกของรายการ) */
const withOldFirst = (old: TradeRow, all: TradeRow[]) => [old, ...all.filter((t) => t.id !== old.id)];

const asRecord = (r: TradeRow): TradeRecord => ({
  id: r.id, assetId: r.asset_id, kind: r.kind as TradeRecord['kind'], date: r.date, createdAt: r.created_at,
  ...(r.units !== null ? { units: r.units } : {}), ...(r.price_micro !== null ? { priceMicro: Number(r.price_micro) } : {}),
  ...(r.amount !== null ? { amount: Number(r.amount) } : {}), fee: Number(r.fee), withholding: Number(r.withholding), memo: r.memo,
});

async function rejectedWith(fn: () => Promise<unknown>): Promise<Error & { code?: string }> {
  try { await fn(); } catch (e) { return e as Error & { code?: string }; }
  throw new Error('ไม่โยน error');
}

describe('replaceTrade (บาท)', () => {
  it('แก้ซื้อที่ไม่มีขายตามหลัง: เรียก replace_trade ครั้งเดียว · basedOn = ลายนิ้วมือของรายการทั้งหมดรวมรายการเดิม · Entry ซื้อตามยอดใหม่', async () => {
    const all = [buy, div];
    const { repo, calls } = repoWith(thbAsset, withOldFirst(buy, all));
    const next: TradeRecord = { ...asRecord(buy), id: 'b1-new', units: '2000000000', amount: 100000, fee: 100 };
    const out = await repo.replaceTrade({ oldId: 'b1', trade: next, walletId: 'w1' });
    expect(out.id).toBe('b1-new');
    const rpcs = calls.filter((c) => c.kind === 'rpc');
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]!.name).toBe('replace_trade');
    const args = rpcs[0]!.args as { p_old_id: string; p_trade: Record<string, unknown>; p_entry: { lines: { accountId: string; amount: number }[] }; p_accounts: unknown[] };
    expect(args.p_old_id).toBe('b1');
    expect(args.p_trade.id).toBe('b1-new');
    expect(args.p_trade.basedOn).toBe(await tradesFingerprint(all));
    expect(args.p_entry.lines).toEqual([{ accountId: 'inv1', amount: 100100 }, { accountId: 'w1', amount: -100100 }]);
  });

  it('แก้ขายล่าสุด: ต้นทุนที่ตัดออกคำนวณด้วย replay ที่ไม่รวมรายการขายเดิม (ขาย 5 หน่วย ต้นทุน 25050 ขาดทุน 22060)', async () => {
    const { repo, calls } = repoWith(thbAsset, withOldFirst(sell, [buy, sell]));
    const next: TradeRecord = { ...asRecord(sell), id: 's1-new', units: '500000000', priceMicro: 6000000, fee: 10 };
    await repo.replaceTrade({ oldId: 's1', trade: next, walletId: 'w1' });
    const args = calls.find((c) => c.kind === 'rpc')!.args as { p_entry: { lines: { accountId: string; amount: number }[] }; p_accounts: { id: string }[] };
    const byAcc = Object.fromEntries(args.p_entry.lines.map((l) => [l.accountId, l.amount]));
    expect(byAcc['w1']).toBe(2990);
    expect(byAcc['inv1']).toBe(-25050);
    expect(byAcc['inv-loss']).toBe(22060);
    expect(args.p_accounts.map((a) => a.id)).toContain('inv-loss');
  });

  it('แก้ขายให้ขายเกินที่ถืออยู่ถูกปฏิเสธก่อนส่ง (ไม่เรียก RPC)', async () => {
    const { repo, calls } = repoWith(thbAsset, withOldFirst(sell, [buy, sell]));
    const next: TradeRecord = { ...asRecord(sell), id: 's1-new', units: '9000000000', priceMicro: 6000000 };
    const e = await rejectedWith(() => repo.replaceTrade({ oldId: 's1', trade: next, walletId: 'w1' }));
    expect(e).toBeInstanceOf(StorageError);
    expect(calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it('แก้ซื้อที่มีรายการขายตามหลัง (วันที่ ≤ วันขายล่าสุด) ถูกปฏิเสธก่อนส่ง · แก้ขายที่ไม่ใช่ล่าสุดถูกปฏิเสธ', async () => {
    const sell2 = row({ id: 's2', kind: 'sell', date: '2026-11-12', units: '100000000', price_micro: 6000000 });
    const a = repoWith(thbAsset, withOldFirst(buy, [buy, sell]));
    const e1 = await rejectedWith(() => a.repo.replaceTrade({ oldId: 'b1', trade: { ...asRecord(buy), id: 'b1-new', amount: 40000 }, walletId: 'w1' }));
    expect(e1).toBeInstanceOf(StorageError);
    expect(a.calls.some((c) => c.kind === 'rpc')).toBe(false);
    const b = repoWith(thbAsset, withOldFirst(sell, [buy, sell, sell2]));
    const e2 = await rejectedWith(() => b.repo.replaceTrade({ oldId: 's1', trade: { ...asRecord(sell), id: 's1-new', units: '100000000' }, walletId: 'w1' }));
    expect(e2).toBeInstanceOf(StorageError);
    expect(b.calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it('ย้ายวันที่ซื้อไปก่อนวันขายถูกปฏิเสธ · ย้ายวันที่ขายไปก่อนวันซื้อถูกปฏิเสธ (ไม่เรียก RPC)', async () => {
    const sell2 = row({ id: 's2', kind: 'sell', date: '2026-11-12', units: '100000000', price_micro: 6000000 });
    const buy2 = row({ id: 'b2', kind: 'buy', date: '2026-11-15', units: '500000000', price_micro: 5000000, amount: 25000 });
    // ซื้อ b2 วันที่ 11-15 (หลังขาย) ย้ายไป 11-05 (ก่อนขาย) = ปฏิเสธ
    const a = repoWith(thbAsset, withOldFirst(buy2, [buy, sell, buy2]));
    const e1 = await rejectedWith(() => a.repo.replaceTrade({ oldId: 'b2', trade: { ...asRecord(buy2), id: 'b2-new', date: '2026-11-05' }, walletId: 'w1' }));
    expect(e1).toBeInstanceOf(StorageError);
    expect(a.calls.some((c) => c.kind === 'rpc')).toBe(false);
    // ขาย s1 (ล่าสุด) ย้ายไปวันที่ 11-01 ก่อนวันซื้อ 11-05 = ปฏิเสธ (M1)
    const b = repoWith(thbAsset, withOldFirst(sell, [buy, sell]));
    const e2 = await rejectedWith(() => b.repo.replaceTrade({ oldId: 's1', trade: { ...asRecord(sell), id: 's1-new', date: '2026-11-01' }, walletId: 'w1' }));
    expect(e2).toBeInstanceOf(StorageError);
    expect(b.calls.some((c) => c.kind === 'rpc')).toBe(false);
    void sell2;
  });

  it('เปลี่ยนชนิด/ย้ายสินทรัพย์ไม่ได้ · ไม่พบรายการเดิม = store.tradeNotFound', async () => {
    const a = repoWith(thbAsset, withOldFirst(buy, [buy]));
    const e1 = await rejectedWith(() => a.repo.replaceTrade({ oldId: 'b1', trade: { ...asRecord(buy), id: 'x', kind: 'dividend' }, walletId: 'w1' }));
    expect(e1.code).toBe('store.tradeNoRetype');
    const e2 = await rejectedWith(() => a.repo.replaceTrade({ oldId: 'b1', trade: { ...asRecord(buy), id: 'x', assetId: 'other' }, walletId: 'w1' }));
    expect(e2.code).toBe('store.tradeNoRetype');
    const { client } = fakeClient((c) => (c.kind === 'from' ? { data: null } : { data: {} }));
    const e3 = await rejectedWith(() => createSupabaseRepository(client, 'u1').replaceTrade({ oldId: 'nope', trade: { ...asRecord(buy), id: 'x' }, walletId: 'w1' }));
    expect(e3.code).toBe('store.tradeNotFound');
  });

  it('PT409 / 40P01 / 40001 จากฐานข้อมูล = "Data changed — reload and try again." (ข้อความเดียว ไม่รั่วรายละเอียด)', async () => {
    for (const code of ['PT409', '40P01', '40001']) {
      const { repo } = repoWith(thbAsset, withOldFirst(buy, [buy]), { code, message: 'internal detail user_id=secret' });
      const e = await rejectedWith(() => repo.replaceTrade({ oldId: 'b1', trade: { ...asRecord(buy), id: 'b1-new', amount: 40000 }, walletId: 'w1' }));
      expect(e).toBeInstanceOf(StorageError);
      expect(hasCode(e)).toBe(true);
      expect(e.code).toBe('store.dataChanged');
      expect(codedMessage(e, 'en')).toBe('Data changed — reload and try again.');
      expect(investError(e)).toBe('Data changed — reload and try again.');
      expect(e.message).not.toMatch(/secret/);
    }
  });
});

describe('replaceTrade: วันที่ไม่เปลี่ยน = คงลำดับเวลาเดิม (เหมือนฐานข้อมูล)', () => {
  it('ซื้อ 10:00 ขาย 09:00 วันเดียวกันไม่ได้อยู่แล้ว · ขายวัน 11-10 เวลาเช้า ซื้อ 11-10 เวลาสาย (ซื้อหลังขาย) ส่ง createdAt ใหม่แล้ว replay ต้องใช้เวลาเดิมของรายการเดิม', async () => {
    const buyEarly = row({ id: 'b0', kind: 'buy', date: '2026-11-01', units: '1000000000', price_micro: 5000000, amount: 50000, fee: 100 });
    const s1 = row({ id: 's9', kind: 'sell', date: '2026-11-10', created_at: '2026-11-10T03:00:00+00:00', units: '500000000', price_micro: 6000000, fee: 10 });
    const { repo, calls } = repoWith(thbAsset, withOldFirst(s1, [buyEarly, s1]));
    const next: TradeRecord = { ...asRecord(s1), id: 's9-new', createdAt: '2030-01-01T00:00:00.000Z', units: '400000000' };
    await repo.replaceTrade({ oldId: 's9', trade: next, walletId: 'w1' });
    const args = calls.find((c) => c.kind === 'rpc')!.args as { p_trade: { createdAt: string } };
    expect(args.p_trade.createdAt).toBe('2026-11-10T03:00:00.000Z');
  });
  it('วันที่เปลี่ยน = ใช้เวลาใหม่ที่ส่งมา · รายการบาทไม่ส่ง fxRateMicro', async () => {
    const { repo, calls } = repoWith(thbAsset, withOldFirst(buy, [buy]));
    const next: TradeRecord = { ...asRecord(buy), id: 'b1-new', date: '2026-11-06', createdAt: '2026-11-06T05:00:00.000Z', fxRateMicro: 35000000 };
    await repo.replaceTrade({ oldId: 'b1', trade: next, walletId: 'w1' });
    const args = calls.find((c) => c.kind === 'rpc')!.args as { p_trade: { createdAt: string; fxRateMicro?: number } };
    expect(args.p_trade.createdAt).toBe('2026-11-06T05:00:00.000Z');
    expect(args.p_trade.fxRateMicro).toBeUndefined();
  });
});

describe('replaceTrade (USD)', () => {
  const usdBuy = row({ id: 'ub', asset_id: 'u1', kind: 'buy', date: '2026-11-03', units: '1000000000', price_micro: 100000000, amount: 100000, fee: 100, fx_rate_micro: 35000000 });
  it('แก้ซื้อหุ้น USD ผ่าน record_trade_fx path: ส่ง replace_trade พร้อม fxRateMicro และ Entry เงินสด USD', async () => {
    const { repo, calls } = repoWith(usdAsset, withOldFirst(usdBuy, [usdBuy]));
    const next: TradeRecord = { ...asRecord(usdBuy), id: 'ub-new', assetId: 'u1', units: '500000000', amount: 50000, fee: 100, fxRateMicro: 35000000 };
    await repo.replaceTrade({ oldId: 'ub', trade: next, cashAccountId: 'usd-cash' });
    const args = calls.find((c) => c.kind === 'rpc')!.args as { p_trade: Record<string, unknown>; p_entry: { lines: { accountId: string; amount: number }[] } };
    expect(args.p_trade.fxRateMicro).toBe(35000000);
    expect(args.p_entry.lines).toEqual([{ accountId: 'inv-us', amount: 50100 }, { accountId: 'usd-cash', amount: -50100 }]);
  });
  it('หุ้น USD ไม่มีอัตรา = ปฏิเสธก่อนส่ง', async () => {
    const { repo, calls } = repoWith(usdAsset, withOldFirst(usdBuy, [usdBuy]));
    const next: TradeRecord = { ...asRecord(usdBuy), id: 'ub-new', assetId: 'u1' };
    delete (next as { fxRateMicro?: number }).fxRateMicro;
    await expect(repo.replaceTrade({ oldId: 'ub', trade: next, cashAccountId: 'usd-cash' })).rejects.toThrow(StorageError);
    expect(calls.some((c) => c.kind === 'rpc')).toBe(false);
  });
});

describe('deleteAsset', () => {
  it('เรียก delete_asset ครั้งเดียวด้วย p_asset_id', async () => {
    const { client, calls } = fakeClient(() => ({ data: { assetId: 'a1', accountId: 'inv1' } }));
    await createSupabaseRepository(client, 'u1').deleteAsset('a1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', name: 'delete_asset', args: { p_asset_id: 'a1' } });
  });
  it('PT409/40P01 = Data changed · ข้อความไทยของฐานข้อมูล (ยังมีรายการ) ไม่รั่วเป็นข้อความดิบ แต่เป็น StorageError', async () => {
    const a = fakeClient(() => ({ error: { code: 'PT409', message: 'x' } }));
    const e1 = await rejectedWith(() => createSupabaseRepository(a.client, 'u1').deleteAsset('a1'));
    expect(e1.code).toBe('store.dataChanged');
    const b = fakeClient(() => ({ error: { code: '23514', message: 'ลบสินทรัพย์ไม่ได้ ยังมีรายการลงทุนของสินทรัพย์นี้' } }));
    const e2 = await rejectedWith(() => createSupabaseRepository(b.client, 'u1').deleteAsset('a1'));
    expect(e2).toBeInstanceOf(StorageError);
  });
  it('รหัสว่าง = ปฏิเสธก่อนส่ง', async () => {
    const { client, calls } = fakeClient(() => ({ data: {} }));
    await expect(createSupabaseRepository(client, 'u1').deleteAsset('')).rejects.toThrow(StorageError);
    expect(calls).toHaveLength(0);
  });
});

describe('recordTrade ก็จับ PT409 เป็น Data changed ด้วย', () => {
  it('ซื้อใหม่ได้ PT409 จากฐานข้อมูล', async () => {
    const { repo } = repoWith(thbAsset, [], { code: 'PT409', message: 'x' });
    const e = await rejectedWith(() => repo.recordTrade({ trade: { ...asRecord(buy), id: 'n1', amount: 1000, units: '100000000', fee: 0 }, walletId: 'w1' }));
    expect(e.code).toBe('store.dataChanged');
  });
});
