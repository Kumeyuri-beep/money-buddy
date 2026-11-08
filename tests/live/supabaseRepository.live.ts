import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { StorageError } from '../../src/storage/repository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { describeRepositoryContract } from '../unit/repositoryContract';

/**
 * M2-C2/M2-F: เทสต์สัญญาชุดเดียวกับ Dexie รันกับ Supabase จริง + เทสต์แยกข้อมูลระหว่างผู้ใช้ 2 คน (RLS)
 * รัน: npm run admin:live-contract (เครื่องเจ้าของ) · ผู้ใช้ทดสอบถูกสร้างและลบอัตโนมัติ
 */
const live = inject('liveUsers');
const sessions = new Map<string, { client: SupabaseClient; id: string }>();

async function signedIn(index: number): Promise<{ client: SupabaseClient; id: string }> {
  const user = live.users[index]!;
  const cached = sessions.get(user.email);
  if (cached) return cached;
  const client = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.user) throw new Error('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ');
  const session = { client, id: data.user.id };
  sessions.set(user.email, session);
  return session;
}

async function repoFor(index: number): Promise<LedgerRepository> {
  const { client, id } = await signedIn(index);
  return createSupabaseRepository(client, id, { getPasswordForReset: async () => live.users[index]!.password });
}

// ผู้ใช้ A: ทุกเทสต์เริ่มจากสมุดว่าง
describeRepositoryContract('Supabase (จริง)', async () => {
  const repo = await repoFor(0);
  await repo.resetAll();
  return repo;
});

describe('แยกข้อมูลระหว่างผู้ใช้ (RLS) ผ่าน repository', () => {
  let a: LedgerRepository;
  let b: LedgerRepository;
  beforeAll(async () => {
    a = await repoFor(0);
    b = await repoFor(1);
    await a.resetAll();
    await b.resetAll();
    await a.saveInitialLedger(buildInitialLedger([{ name: 'ของ A', opening: '1000' }], '2026-11-01'));
  });

  it('B มองไม่เห็นข้อมูลของ A และสมุดของ B ว่างจริง', async () => {
    expect(await b.isEmpty()).toBe(true);
    expect((await b.loadLedger()).entries).toHaveLength(0);
    expect(await a.isEmpty()).toBe(false);
  });

  it('B แก้/ลบรายการของ A ด้วยรหัสจริงไม่ได้ (เห็นเป็นไม่พบ)', async () => {
    const aEntries = (await a.loadLedger()).entries;
    const id = aEntries[0]!.id;
    await expect(b.deleteEntry(id)).rejects.toThrow(StorageError);
    await expect(b.updateEntry(id, { id, date: '2026-11-02', memo: 'x', lines: [] })).rejects.toThrow();
    expect((await a.loadLedger()).entries).toHaveLength(aEntries.length);
  });

  it('B ตั้งต้นสมุดของตัวเองได้โดยไม่กระทบ A · ล้างของ B ไม่กระทบ A', async () => {
    const before = (await a.loadLedger()).entries.length;
    await b.saveInitialLedger(buildInitialLedger([{ name: 'ของ B', opening: '5' }], '2026-11-01'));
    expect((await a.loadLedger()).accounts.some((x) => x.name === 'ของ B')).toBe(false);
    await b.resetAll();
    expect((await a.loadLedger()).entries).toHaveLength(before);
  });

  it('B จ่ายบิลของ A ไม่ได้ (ไม่พบบิล)', async () => {
    const accounts = (await a.loadLedger()).accounts;
    const wallet = accounts.find((x) => x.type === 'asset')!;
    const category = accounts.find((x) => x.type === 'expense')!;
    await a.addBill({ id: 'bill-a', name: 'บิล A', amount: 100, dueDay: 5, walletId: wallet.id, categoryId: category.id }, '2026-11-04');
    await expect(b.payBill('bill-a', { today: '2026-11-04', entryId: 'x' })).rejects.toThrow(StorageError);
    await expect(b.deleteBill('bill-a')).rejects.toThrow(StorageError);
    expect((await a.loadBills()).map((x) => x.id)).toEqual(['bill-a']);
  });

  it('ค่าตั้งค่าแยกกัน', async () => {
    await a.saveSettings({ payDay: 10 });
    await b.saveSettings({ payDay: 20 });
    expect(await a.loadSettings()).toEqual({ payDay: 10 });
    expect(await b.loadSettings()).toEqual({ payDay: 20 });
  });

  it('คนที่ไม่ได้ล็อกอิน (anon) อ่านและเรียก RPC ไม่ได้เลย', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const read = await anon.from('entries').select('id');
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    const rpc = await anon.rpc('reset_my_ledger', {});
    expect(rpc.error).not.toBeNull();
    expect((await a.loadLedger()).entries.length).toBeGreaterThan(0);
  });
});
