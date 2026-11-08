import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { StorageError } from '../../src/storage/repository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { describeRepositoryContract } from '../unit/repositoryContract';
import { loadAdmin } from '../../scripts/lib/admin.mjs';

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

// ล้างข้อมูลของผู้ใช้ทดสอบด้วยสิทธิ์ผู้ดูแล (เฉพาะในชุดทดสอบนี้) เพื่อไม่ให้ชน rate limit ของ reset_my_ledger (5 ครั้ง/15 นาที)
// rate limit ของ production ไม่ถูกลด · ชุดนี้เรียก resetAll จริงแค่ 2 ครั้งต่อรอบ เพื่อทดสอบเส้นทางนั้นเอง
const admin = loadAdmin().client;
async function wipe(index: number): Promise<void> {
  const { id } = await signedIn(index);
  for (const table of ['entries', 'bills', 'accounts', 'settings']) {
    const { error } = await admin.from(table).delete().eq('user_id', id);
    if (error) throw new Error('ล้างข้อมูลผู้ใช้ทดสอบไม่สำเร็จที่ตาราง ' + table);
  }
}

async function repoFor(index: number): Promise<LedgerRepository> {
  const { client, id } = await signedIn(index);
  return createSupabaseRepository(client, id, { getPasswordForReset: async () => live.users[index]!.password });
}

// ผู้ใช้ A: ทุกเทสต์เริ่มจากสมุดว่าง
describeRepositoryContract('Supabase (จริง)', async () => {
  const repo = await repoFor(0);
  await wipe(0);
  return repo;
});

describe('แยกข้อมูลระหว่างผู้ใช้ (RLS) ผ่าน repository', () => {
  let a: LedgerRepository;
  let b: LedgerRepository;
  beforeAll(async () => {
    a = await repoFor(0);
    b = await repoFor(1);
    await wipe(0);
    await wipe(1);
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

  it('นำเข้าข้อมูลเสียที่ส่งตรงเข้า RPC (ข้ามการตรวจฝั่งเว็บ) ถูกฐานข้อมูลปฏิเสธทั้งก้อน ไม่เหลือแถวค้าง · นำเข้าซ้ำถูกปฏิเสธ', async () => {
    await wipe(1);
    const { client } = await signedIn(1);
    const accounts = [
      { id: 'w1', type: 'asset', name: 'w1', currency: 'THB' },
      { id: 'open', type: 'equity', name: 'open', currency: 'THB' },
    ];
    const bad = await client.rpc('import_ledger', {
      p_data: { accounts, bills: [], entries: [{ id: 'x', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'w1', amount: 100 }, { accountId: 'open', amount: -99 }] }] },
    });
    expect(bad.error).not.toBeNull();
    expect(await b.isEmpty()).toBe(true);
    const good = await client.rpc('import_ledger', {
      p_data: { accounts, bills: [], entries: [{ id: 'x', date: '2026-11-01', memo: '', source: 'system', lines: [{ accountId: 'w1', amount: 100 }, { accountId: 'open', amount: -100 }] }] },
    });
    expect(good.error).toBeNull();
    const again = await client.rpc('import_ledger', { p_data: { accounts, bills: [], entries: [] } });
    expect(again.error?.message ?? '').toMatch(/มีข้อมูลอยู่แล้ว/);
    // GUC ของการนำเข้าไม่ค้างหลังจบ: สร้างรายการ system ด้วย create_entry ต้องถูกปฏิเสธ
    const sys = await client.rpc('create_entry', {
      p_entry: { id: 'sys2', date: '2026-11-02', memo: '', source: 'system', lines: [{ accountId: 'w1', amount: 1 }, { accountId: 'open', amount: -1 }] },
    });
    expect(sys.error).not.toBeNull();
    expect((await b.loadLedger()).entries).toHaveLength(1);
  });

  it('payload ที่ใส่ user_id ของคนอื่นมา ถูกมองข้าม แถวเป็นของผู้เรียกเสมอ · อ้างบัญชีของอีกคนไม่ได้', async () => {
    await wipe(1);
    const { client } = await signedIn(1);
    const other = live.users[0]!;
    const ok = await client.rpc('import_ledger', {
      p_data: {
        accounts: [
          { id: 'w1', type: 'asset', name: 'w1', currency: 'THB', user_id: other.id },
          { id: 'open', type: 'equity', name: 'open', currency: 'THB', user_id: other.id },
        ],
        bills: [],
        entries: [{ id: 'u1', date: '2026-11-01', memo: '', source: 'system', user_id: other.id, lines: [{ accountId: 'w1', amount: 5 }, { accountId: 'open', amount: -5 }] }],
      },
    });
    expect(ok.error).toBeNull();
    expect((await a.loadLedger()).accounts.some((x) => x.id === 'w1' && x.name === 'w1')).toBe(false);
    expect((await b.loadLedger()).entries.map((e) => e.id)).toEqual(['u1']);
    await wipe(1);
    const cross = await client.rpc('import_ledger', {
      p_data: { accounts: [], bills: [], entries: [{ id: 'z', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'wallet-of-A', amount: 1 }, { accountId: 'x', amount: -1 }] }] },
    });
    expect(cross.error).not.toBeNull();
  });

  it('M2-G: สถานะจ่ายของบิลแก้ตรงๆ ผ่าน REST ไม่ได้ · จ่าย/ยกเลิก/เลิกทำการลบบิลยังใช้ได้ (R15)', async () => {
    const { client } = await signedIn(0);
    const accounts = (await a.loadLedger()).accounts;
    const wallet = accounts.find((x) => x.type === 'asset')!;
    const category = accounts.find((x) => x.type === 'expense')!;
    await a.addBill({ id: 'bill-lock', name: 'ล็อก', amount: 100, dueDay: 5, walletId: wallet.id, categoryId: category.id }, '2026-11-04');
    const direct = await client.from('bills').update({ last_paid_month: '2026-11' }).eq('id', 'bill-lock');
    expect(direct.error).not.toBeNull();
    const forged = await client.from('bills').insert({ id: 'bill-forged', name: 'x', amount: 1, due_day: 1, last_paid_month: '2026-11' });
    expect(forged.error).not.toBeNull();
    await a.payBill('bill-lock', { today: '2026-11-04', entryId: 'lock-pay' });
    const lastPaid = async () => (await a.loadBills()).find((x) => x.id === 'bill-lock')?.lastPaidMonth;
    expect(await lastPaid()).toBe('2026-11');
    const clear = await client.from('bills').update({ last_paid_month: null }).eq('id', 'bill-lock');
    expect(clear.error).not.toBeNull();
    expect(await lastPaid()).toBe('2026-11');
    // เลิกทำการลบบิล: ใส่บิลกลับพร้อมสถานะเดิม ผ่านเพราะมีรายการจ่ายรองรับ
    const removed = await a.deleteBill('bill-lock');
    await a.addBill(removed, '2026-11-09');
    expect(await lastPaid()).toBe('2026-11');
    await a.cancelLatestBillPayment('bill-lock');
    expect(await lastPaid()).toBeUndefined();
  });

  it('คนที่ไม่ได้ล็อกอิน (anon) อ่านและเรียก RPC ไม่ได้เลย', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const read = await anon.from('entries').select('id');
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    const rpc = await anon.rpc('reset_my_ledger', { p_password: 'x' });
    expect(rpc.error).not.toBeNull();
    const imp = await anon.rpc('import_ledger', { p_data: { accounts: [], bills: [], entries: [] } });
    expect(imp.error).not.toBeNull();
    expect((await a.loadLedger()).entries.length).toBeGreaterThan(0);
  });
});
