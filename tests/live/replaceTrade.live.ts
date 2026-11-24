import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import { StorageError } from '../../src/storage/repository';
import { loadAdmin } from '../../scripts/lib/admin.mjs';
import { authErrorText, liveClientOptions, wipeUserTables } from './liveHelpers';

/**
 * แก้รายการที่บันทึกแล้ว + ลบสินทรัพย์ ผ่าน repository กับ Supabase จริง (replace_trade / delete_asset) · ข้อมูลสมมติทั้งหมด
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

describe('replaceTrade / deleteAsset ผ่าน Supabase จริง', () => {
  let a: LedgerRepository;
  beforeAll(async () => {
    const { client, id } = await signedIn();
    a = createSupabaseRepository(client, id, { getPasswordForReset: async () => A.password });
    await wipe();
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสดบาท', opening: '1000000' }], '2026-11-01'));
  });
  afterAll(async () => {
    await wipe();
  });

  it('แก้ขายล่าสุด (ต้นทุนตัดออกด้วย replay) · แก้ซื้อที่มีขายตามหลังถูกปฏิเสธ · ลบสินทรัพย์ต้องลบรายการก่อน', async () => {
    await a.addAsset({ id: 'rt-a', name: 'กองทุน RT', kind: 'fund' });
    const ledger = await a.loadLedger();
    const wallet = ledger.accounts.find((x) => x.type === 'asset' && x.kind !== 'investment')!.id;
    const base = { assetId: 'rt-a', withholding: 0, memo: '' };
    // ซื้อ 10 หน่วย 500.00 + ค่าธรรมเนียม 1.00 (ต้นทุน 50100) · ขาย 5 หน่วย @6.00 ค่าธรรมเนียม 0.10
    await a.recordTrade({ walletId: wallet, trade: { ...base, id: 'rt-b1', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '1000000000', amount: 50000, fee: 100 } });
    await a.recordTrade({ walletId: wallet, trade: { ...base, id: 'rt-s1', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', units: '500000000', priceMicro: 6000000, fee: 10 } });

    // แก้ขายล่าสุดเป็น 4 หน่วย: ต้นทุนตัดออกต้องคำนวณใหม่จากรายการที่เหลือ (50100 x 4 / 10 = 20040)
    const edited = await a.replaceTrade({ oldId: 'rt-s1', trade: { ...base, id: 'rt-s1b', kind: 'sell', date: '2026-11-10', createdAt: '2026-11-10T03:00:00.000Z', units: '400000000', priceMicro: 6000000, fee: 10 }, walletId: wallet });
    expect(edited.id).toBe('rt-s1b');
    const inv = await a.loadInvestments();
    expect(inv.trades.map((t) => t.id).sort()).toEqual(['rt-b1', 'rt-s1b']);
    const after = await a.loadLedger();
    const sellEntry = after.entries.find((e) => e.id === 'rt-s1b-entry')!;
    expect(sellEntry.lines.reduce((s, l) => s + l.amount, 0)).toBe(0);
    expect(sellEntry.lines.some((l) => l.amount === -20040)).toBe(true);
    expect(after.entries.some((e) => e.id === 'rt-s1-entry')).toBe(false);

    // แก้ซื้อที่มีรายการขายตามหลัง: ปฏิเสธ ไม่เปลี่ยนอะไร
    await expect(a.replaceTrade({ oldId: 'rt-b1', trade: { ...base, id: 'rt-b1b', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '1000000000', amount: 40000, fee: 0 }, walletId: wallet })).rejects.toThrow(StorageError);
    expect((await a.loadInvestments()).trades.map((t) => t.id).sort()).toEqual(['rt-b1', 'rt-s1b']);

    // ลบสินทรัพย์ที่ยังมีรายการ: ปฏิเสธ · ลบรายการทั้งหมด (ขายก่อน แล้วซื้อ) แล้วลบสินทรัพย์ได้ · บัญชีต้นทุนหายด้วย
    await expect(a.deleteAsset('rt-a')).rejects.toThrow(StorageError);
    await a.deleteTrade('rt-s1b');
    await a.deleteTrade('rt-b1');
    await a.deleteAsset('rt-a');
    const done = await a.loadInvestments();
    expect(done.assets.some((x) => x.id === 'rt-a')).toBe(false);
    await expect(a.deleteAsset('rt-a')).rejects.toThrow(StorageError);
  });
});
