import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { negativeUsdCash, usdCashBalances } from '../../src/domain/invest/usdIntegrity';
import type { TradeRecord } from '../../src/domain/invest/types';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import { StorageError } from '../../src/storage/repository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import { loadAdmin } from '../../scripts/lib/admin.mjs';
import { authErrorText, liveClientOptions, wipeUserTables } from './liveHelpers';

/**
 * หุ้นสหรัฐและการแลกเงิน (A3-2): ยืนยันกับ Supabase จริงว่า repository ใหม่ (addUsdCash, addUsdStock, recordFxExchange, recordTradeFx, saveFxRate, deleteFxExchange)
 * ทำงานผ่าน RPC จริง · ยอดในสมุดตรง · Integrity ผ่าน · ไฟล์สำรองส่งออกแล้วตรวจผ่าน · เงินสด USD ติดลบถูกตรวจพบ · ผู้ใช้ B ไม่เห็นของ A
 * ข้อมูลสมมติทั้งหมด ไม่ใช่ข้อมูลจริง · รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น · ต้องตั้ง MONEY_BUDDY_LIVE_TESTS=yes)
 */
const live = inject('liveUsers');
const admin = loadAdmin().client;
const A = live.users[0]!;
const B = live.users[1]!;
const sessions = new Map<string, { client: SupabaseClient; id: string }>();

async function signedIn(index: number): Promise<{ client: SupabaseClient; id: string }> {
  const user = live.users[index]!;
  const cached = sessions.get(user.email);
  if (cached) return cached;
  const client = createClient(live.url, live.anonKey, liveClientOptions);
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.user) throw new Error('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: ' + authErrorText(error));
  const session = { client, id: data.user.id };
  sessions.set(user.email, session);
  return session;
}

function assertTestUser(id: string): void {
  const ok = (id === A.id && A.email.startsWith('livetest-')) || (id === B.id && B.email.startsWith('livetest-'));
  if (!ok) throw new Error('หยุด: ไม่ใช่ผู้ใช้ทดสอบ a/b ของรอบนี้ ไม่ลบอะไร');
}

async function wipe(index: number): Promise<void> {
  const { id } = await signedIn(index);
  assertTestUser(id);
  await wipeUserTables(admin, id, ['entries', 'bills', 'accounts', 'settings']);
}

async function repoFor(index: number): Promise<LedgerRepository> {
  const { client, id } = await signedIn(index);
  return createSupabaseRepository(client, id, { getPasswordForReset: async () => live.users[index]!.password });
}

const STOCK = { id: 'abc', name: 'ABC Corp', ticker: 'ABC', exchange: 'NASDAQ' };
const usdTrade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'usd-buy', assetId: STOCK.id, kind: 'buy', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z',
  units: '1000000000', priceMicro: 100_000_000, amount: 100_000, fee: 100, withholding: 0, memo: '', fxRateMicro: 35_000_000, ...over,
});
const FX1 = { id: 'fx1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'thb_to_usd' as const, thbSatang: 7_000_000, usdCents: 200_000, memo: '' };

describe('หุ้นสหรัฐและการแลกเงินผ่าน Supabase จริง (A3-2)', () => {
  let a: LedgerRepository;
  let b: LedgerRepository;
  let walletId = '';

  beforeAll(async () => {
    a = await repoFor(0);
    b = await repoFor(1);
    await wipe(0);
    await wipe(1);
    const ledger = buildInitialLedger([{ name: 'เงินสดบาท', opening: '100000' }], '2026-11-01');
    await a.saveInitialLedger(ledger);
    walletId = ledger.accounts.find((x) => x.type === 'asset')!.id;
  });
  afterAll(async () => {
    await wipe(0);
    await wipe(1);
  });

  it('แลกเงิน → ซื้อ → ขาย → ปันผล: ยอดสมุดตรง · Integrity ผ่าน · ต้นทุน 2 ถัง · ไฟล์สำรองตรวจผ่าน', async () => {
    await a.addUsdCash({ id: 'usd-cash', name: 'เงินสด USD' });
    const x = await a.recordFxExchange({ exchange: FX1, walletId, cashAccountId: 'usd-cash' });
    expect(x.rateMicro).toBe(35_000_000);
    expect(x.entryId).toBe('fx1-entry');
    await a.addUsdStock(STOCK);
    await a.recordTradeFx({ trade: usdTrade({}), cashAccountId: 'usd-cash' });
    await a.recordTradeFx({
      trade: usdTrade({ id: 'usd-sell', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', units: '400000000', priceMicro: 120_000_000, amount: undefined, fee: 100, fxRateMicro: 33_000_000 }),
      cashAccountId: 'usd-cash',
    });
    await a.recordTradeFx({
      trade: usdTrade({ id: 'usd-div', kind: 'dividend', date: '2026-11-12', createdAt: '2026-11-12T03:00:00.000Z', units: undefined, priceMicro: undefined, amount: 5_000, fee: 0, withholding: 750, fxRateMicro: 34_567_891 }),
      cashAccountId: 'usd-cash',
    });
    await a.saveFxRate({ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 });
    await a.savePrice({ assetId: STOCK.id, date: '2026-11-12', priceMicro: 125_000_000 });

    const ledger = await a.loadLedger();
    const inv = await a.loadInvestments();
    // เงินสด USD: 2,000.00 − 1,001.00 + 479.00 + 42.50 = 1,520.50 USD
    const cash = usdCashBalances(ledger.accounts, ledger.entries, inv);
    expect(cash).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: 152_050 }]);
    expect(negativeUsdCash(ledger.accounts, ledger.entries, inv)).toEqual([]);
    expect(inv.trades.map((t) => t.id).sort()).toEqual(['usd-buy', 'usd-div', 'usd-sell']);
    expect(inv.fxExchanges).toHaveLength(1);
    expect(inv.fxRates).toEqual([{ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 34_000_000 }]);
    const report = runIntegrityCheck(ledger.accounts, ledger.entries, inv);
    expect(report.ok).toBe(true);
    // ส่งออกแล้วตรวจไฟล์: ต้องผ่านตัวตรวจไฟล์สำรอง (ตรงทุกเซนต์/สตางค์)
    const snapshot = await a.exportSnapshot(new Date('2026-11-13T00:00:00Z'));
    expect(snapshot.investments?.trades).toHaveLength(3);
    const parsed = parseBackup(JSON.stringify(snapshot), '2026-11-13');
    if (!parsed.ok) throw new Error(parsed.problems.join(' | '));
    expect(parsed.data.investments).toEqual(snapshot.investments);
  });

  it('กติกาฝั่งเว็บ/ฐานข้อมูลปฏิเสธ: ขายเกินที่ถือ · ต้นทุนบาทของรายการปัดเป็น 0 สตางค์ (R20.3) · ไม่มีอัตรา · หุ้นบาทใช้ recordTradeFx ไม่ได้', async () => {
    await expect(
      a.recordTradeFx({ trade: usdTrade({ id: 'usd-over', kind: 'sell', date: '2026-11-15', createdAt: '2026-11-15T03:00:00.000Z', units: '9000000000', priceMicro: 100_000_000, amount: undefined, fee: 0 }), cashAccountId: 'usd-cash' }),
    ).rejects.toThrow(StorageError);
    await expect(a.recordTradeFx({ trade: usdTrade({ id: 'usd-tiny', date: '2026-11-16', createdAt: '2026-11-16T03:00:00.000Z', units: '100000000', priceMicro: 1, amount: 1, fee: 0, fxRateMicro: 499_999 }), cashAccountId: 'usd-cash' })).rejects.toThrow(/ปัดเป็น 0 สตางค์/);
    await expect(a.recordTradeFx({ trade: usdTrade({ id: 'usd-nofx', date: '2026-11-16', createdAt: '2026-11-16T04:00:00.000Z', fxRateMicro: undefined }), cashAccountId: 'usd-cash' })).rejects.toThrow(StorageError);
    await a.addAsset({ id: 'thb-fund', name: 'กองทุนบาท', kind: 'fund' });
    await expect(a.recordTradeFx({ trade: usdTrade({ id: 'x-thb', assetId: 'thb-fund', date: '2026-11-16', createdAt: '2026-11-16T05:00:00.000Z' }), cashAccountId: 'usd-cash' })).rejects.toThrow(/USD/);
    const inv = await a.loadInvestments();
    expect(inv.trades.map((t) => t.id).sort()).toEqual(['usd-buy', 'usd-div', 'usd-sell']);
  });

  it('ลบรายการแลกเงินที่ USD ถูกใช้ซื้อหุ้นไปแล้ว: ลบได้ แต่เงินสด USD ติดลบและตัวตรวจเตือน (ฐานข้อมูลไม่ตรวจเรื่องนี้)', async () => {
    await a.deleteFxExchange('fx1');
    const ledger = await a.loadLedger();
    const inv = await a.loadInvestments();
    expect(inv.fxExchanges ?? []).toHaveLength(0);
    // 1,520.50 − 2,000.00 = −479.50 USD
    expect(negativeUsdCash(ledger.accounts, ledger.entries, inv)).toEqual([{ accountId: 'usd-cash', name: 'เงินสด USD', cents: -47_950 }]);
  });

  it('ผู้ใช้ B ไม่เห็นข้อมูล USD ของ A · ใช้บัญชีเงินสด USD/หุ้นของ A ไม่ได้', async () => {
    const inv = await b.loadInvestments();
    expect(inv.assets).toEqual([]);
    expect(inv.fxRates ?? []).toEqual([]);
    expect(inv.fxExchanges ?? []).toEqual([]);
    await expect(b.recordTradeFx({ trade: usdTrade({ id: 'b-steal' }), cashAccountId: 'usd-cash' })).rejects.toThrow(StorageError);
    await expect(b.saveFxRate({ accountId: 'usd-cash', date: '2026-11-12', rateMicro: 1 })).rejects.toThrow(StorageError);
  });

  it('ส่งออกของ A (ก่อนลบการแลกเงิน) → นำเข้าเป็นของ B: ข้อมูล USD ครบทุกเซนต์ ส่งออกซ้ำเท่าเดิม · ของ A ไม่เปลี่ยน', async () => {
    // ข้อมูลของ A ตอนนี้ไม่มีรายการแลกเงินแล้ว (ข้อก่อนหน้าลบไป) จึงสร้างไฟล์จากสถานะเดิมด้วยการแลกกลับ: แลก 2,000.00 USD ใหม่ให้เงินสดไม่ติดลบ แล้วส่งออก
    await a.recordFxExchange({ exchange: { ...FX1, id: 'fx2', date: '2026-11-02', createdAt: '2026-11-02T04:00:00.000Z' }, walletId, cashAccountId: 'usd-cash' });
    const snapshot = await a.exportSnapshot(new Date('2026-11-13T00:00:00Z'));
    const parsed = parseBackup(JSON.stringify(snapshot), '2026-11-13');
    if (!parsed.ok) throw new Error(parsed.problems.join(' | '));
    await b.importBackup(parsed.data);
    const again = await b.exportSnapshot(new Date('2026-11-13T00:00:00Z'));
    expect(again.investments).toEqual(snapshot.investments);
    expect(await a.exportSnapshot(new Date('2026-11-13T00:00:00Z'))).toEqual(snapshot);
  });
});
