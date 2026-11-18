import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { usdCashBalances } from '../../src/domain/invest/usdIntegrity';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import { loadAdmin } from '../../scripts/lib/admin.mjs';
import { authErrorText, liveClientOptions, wipeUserTables } from './liveHelpers';

/**
 * ปรับยอดเงินสดของพอร์ต (Invest v2 หน้า Cash): repository → RPC record_cash_adjustment ผ่าน Supabase จริง
 * ข้อมูลสมมติทั้งหมด · รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น)
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
async function wipe(index: number): Promise<void> {
  const { id } = await signedIn(index);
  const ok = (id === A.id && A.email.startsWith('livetest-')) || (id === B.id && B.email.startsWith('livetest-'));
  if (!ok) throw new Error('หยุด: ไม่ใช่ผู้ใช้ทดสอบ a/b ของรอบนี้ ไม่ลบอะไร');
  await wipeUserTables(admin, id, ['entries', 'bills', 'accounts', 'settings']);
}
async function repoFor(index: number): Promise<LedgerRepository> {
  const { client, id } = await signedIn(index);
  return createSupabaseRepository(client, id, { getPasswordForReset: async () => live.users[index]!.password });
}

describe('ปรับยอดเงินสดของพอร์ตผ่าน Supabase จริง', () => {
  let a: LedgerRepository;
  let b: LedgerRepository;
  beforeAll(async () => {
    a = await repoFor(0);
    b = await repoFor(1);
    await wipe(0);
    await wipe(1);
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสดบาท', opening: '100000' }], '2026-11-01'));
  });
  afterAll(async () => {
    await wipe(0);
    await wipe(1);
  });

  it('ฝาก → ถอน → ถอนเกิน(ปฏิเสธ) · ยอดสมุดตรง · ผู้ใช้อื่นใช้บัญชีนี้ไม่ได้', async () => {
    await a.addUsdCash({ id: 'usd-cash', name: 'เงินสด USD' });
    const base = { cashAccountId: 'usd-cash', currency: 'USD' as const, memo: '' };
    await a.recordCashAdjustment({ ...base, id: 'ca1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'deposit', amountMinor: 12_037 });
    await a.recordCashAdjustment({ ...base, id: 'ca2', date: '2026-11-03', createdAt: '2026-11-03T03:00:00.000Z', direction: 'withdraw', amountMinor: 2_037 });
    await expect(a.recordCashAdjustment({ ...base, id: 'ca3', date: '2026-11-04', createdAt: '2026-11-04T03:00:00.000Z', direction: 'withdraw', amountMinor: 10_001 })).rejects.toThrow();
    const ledger = await a.loadLedger();
    const inv = await a.loadInvestments();
    expect(usdCashBalances(ledger.accounts, ledger.entries, inv).find((x) => x.accountId === 'usd-cash')?.cents).toBe(10_000);
    expect(ledger.entries.some((e) => e.id === 'ca3')).toBe(false);
    expect(runIntegrityCheck(ledger.accounts, ledger.entries)).toMatchObject({ ok: true, issues: [] });
    await expect(b.recordCashAdjustment({ ...base, id: 'cb1', date: '2026-11-02', createdAt: '2026-11-02T03:00:00.000Z', direction: 'deposit', amountMinor: 100 })).rejects.toThrow();
  });
});
