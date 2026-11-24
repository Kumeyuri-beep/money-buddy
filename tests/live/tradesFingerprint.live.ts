import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { tradesFingerprint } from '../../src/domain/invest/tradesFingerprint';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository, type TradeRow } from '../../src/storage/supabaseRepository';
import { loadAdmin } from '../../scripts/lib/admin.mjs';
import { authErrorText, liveClientOptions, wipeUserTables } from './liveHelpers';

/**
 * basedOn เป็นลายนิ้วมือรายการ: สูตรฝั่งเว็บ (tradesFingerprint) ต้องตรงกับ private.trades_fingerprint ในฐานข้อมูลจริง
 * และแก้รายการจำนวนเท่าเดิมแล้วแท็บเก่า (ถือลายนิ้วมือเก่า) ต้องถูกปฏิเสธ PT409 · ข้อมูลสมมติทั้งหมด
 * รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น)
 */
const live = inject('liveUsers');
const admin = loadAdmin().client;
const A = live.users[0]!;
let session: { client: SupabaseClient; id: string } | undefined;

async function signedIn(): Promise<{ client: SupabaseClient; id: string }> {
  if (session) return session;
  const client = createClient(live.url, live.anonKey, liveClientOptions);
  const { data, error } = await client.auth.signInWithPassword({ email: A.email, password: A.password });
  if (error || !data.user) throw new Error('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: ' + authErrorText(error));
  session = { client, id: data.user.id };
  return session;
}
async function wipe(): Promise<void> {
  const { id } = await signedIn();
  if (!(id === A.id && A.email.startsWith('livetest-'))) throw new Error('หยุด: ไม่ใช่ผู้ใช้ทดสอบ a ของรอบนี้ ไม่ลบอะไร');
  await wipeUserTables(admin, id, ['entries', 'bills', 'accounts', 'settings']);
}

describe('basedOn ลายนิ้วมือรายการผ่าน Supabase จริง', () => {
  let a: LedgerRepository;
  beforeAll(async () => {
    const { client, id } = await signedIn();
    a = createSupabaseRepository(client, id, { getPasswordForReset: async () => A.password });
    await wipe();
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสดบาท', opening: '100000' }], '2026-11-01'));
  });
  afterAll(async () => {
    await wipe();
  });

  it('ซื้อสองครั้งผ่าน repository (สูตรเว็บตรงฐานข้อมูล) · แก้รายการจำนวนเท่าเดิม → แท็บเก่า PT409 · ลายนิ้วมือล่าสุดผ่าน', async () => {
    const { client } = await signedIn();
    await a.addAsset({ id: 'fp-a', name: 'กองทุน FP', kind: 'fund' });
    const ledger = await a.loadLedger();
    const wallet = ledger.accounts.find((x) => x.type === 'asset' && x.kind !== 'investment')!.id;
    const base = { assetId: 'fp-a', kind: 'buy' as const, withholding: 0, memo: '', fee: 0 };
    // ครั้งแรก: ลายนิ้วมือของสินทรัพย์ว่าง · ครั้งที่สอง: ของ 1 รายการ (ถ้าสูตรเว็บไม่ตรงฐานข้อมูล สองครั้งนี้จะได้ PT409)
    await a.recordTrade({ walletId: wallet, trade: { ...base, id: 'fp-1', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '1000000000', amount: 50000 } });
    await a.recordTrade({ walletId: wallet, trade: { ...base, id: 'fp-2', date: '2026-11-06', createdAt: '2026-11-06T03:00:00.000Z', units: '500000000', amount: 25000 } });

    const asset = await client.from('assets').select('account_id').eq('id', 'fp-a').single();
    expect(asset.error).toBeNull();
    const assetAccount = (asset.data as { account_id: string }).account_id;
    const rowsNow = async () => ((await client.from('trades').select('*').eq('asset_id', 'fp-a')).data ?? []) as TradeRow[];

    const stale = await tradesFingerprint(await rowsNow()); // แท็บเก่าเปิดฟอร์มตอนนี้ (2 รายการ)
    const entryOf = (id: string, date: string, amount: number) => ({
      id: `${id}-entry`, date, memo: '', source: 'manual',
      lines: [{ accountId: assetAccount, amount }, { accountId: wallet, amount: -amount }],
    });
    const tradeOf = (id: string, date: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id, assetId: 'fp-a', kind: 'buy', date, units: '500000000', amount, fee: 0, withholding: 0, memo: '', ...extra,
    });

    // แท็บที่สองแก้ fp-2 (ยังมี 2 รายการ) ด้วยลายนิ้วมือที่ตรง = ผ่าน
    const replaced = await client.rpc('replace_trade', {
      p_old_id: 'fp-2',
      p_trade: tradeOf('fp-2b', '2026-11-06', 30000, { basedOn: stale }),
      p_entry: entryOf('fp-2b', '2026-11-06', 30000),
      p_accounts: [],
    });
    expect(replaced.error).toBeNull();
    expect((await rowsNow()).length).toBe(2); // จำนวนเท่าเดิม: ตัวนับจำนวนเดิมจับไม่ได้

    // แท็บเก่าบันทึกซื้อเพิ่มด้วยลายนิ้วมือเก่า → ปฏิเสธ PT409 ไม่เขียนแถว
    const stalePush = await client.rpc('record_trade', {
      p_trade: tradeOf('fp-3', '2026-11-07', 10000, { basedOn: stale }),
      p_entry: entryOf('fp-3', '2026-11-07', 10000),
      p_accounts: [],
    });
    expect(stalePush.error?.code).toBe('PT409');
    expect((await rowsNow()).some((r) => r.id === 'fp-3')).toBe(false);

    // ใช้ลายนิ้วมือล่าสุดผ่าน repository (โหลดใหม่) = ผ่าน
    await a.recordTrade({ walletId: wallet, trade: { ...base, id: 'fp-4', date: '2026-11-08', createdAt: '2026-11-08T03:00:00.000Z', units: '100000000', amount: 5000 } });
    expect((await rowsNow()).map((r) => r.id).sort()).toEqual(['fp-1', 'fp-2b', 'fp-4']);
  });
});
