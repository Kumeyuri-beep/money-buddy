import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { PRIVACY_POLICY_VERSION } from '../../src/domain/privacy/policy';
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

describe('PDPA (M2-E): ยอมรับนโยบาย · ลบบัญชีและข้อมูลทั้งหมด', () => {
  it('ยอมรับนโยบาย: เวลาตั้งที่เซิร์ฟเวอร์ เรียกซ้ำไม่เปลี่ยนเวลาเดิม · ผู้ใช้อ่านได้ แก้ตรงๆ ไม่ได้', async () => {
    const { client, id } = await signedIn(2);
    const before = await client.from('profiles').select('consented_at').eq('user_id', id).maybeSingle();
    expect(before.data?.consented_at ?? null).toBeNull();
    const first = await client.rpc('record_consent', { p_version: PRIVACY_POLICY_VERSION });
    expect(first.error).toBeNull();
    const a1 = await client.from('profiles').select('consented_at').eq('user_id', id).maybeSingle();
    expect(typeof a1.data?.consented_at).toBe('string');
    await client.rpc('record_consent', { p_version: PRIVACY_POLICY_VERSION });
    const bogus = await client.rpc('record_consent', { p_version: '2099-01-01' });
    expect(bogus.error).not.toBeNull(); // รับเฉพาะเวอร์ชันในรายการอนุญาต
    const noVersion = await client.rpc('record_consent');
    expect(noVersion.error).not.toBeNull(); // ฟังก์ชันแบบไม่มีเวอร์ชันถูกถอดแล้ว
    const a2 = await client.from('profiles').select('consented_at').eq('user_id', id).maybeSingle();
    expect(a2.data?.consented_at).toBe(a1.data?.consented_at);
    const forge = await client.from('profiles').update({ consented_at: '2000-01-01T00:00:00Z' }).eq('user_id', id);
    expect(forge.error !== null || (forge.count ?? 0) === 0).toBe(true);
    const a3 = await client.from('profiles').select('consented_at').eq('user_id', id).maybeSingle();
    expect(a3.data?.consented_at).toBe(a1.data?.consented_at);
  });

  it('ลบบัญชี: รหัสผิดไม่ลบ · รหัสถูกลบข้อมูลทุกตารางหมด เข้าสู่ระบบอีกไม่ได้ · ของผู้ใช้อื่นไม่ถูกแตะ', async () => {
    const { client, id } = await signedIn(2);
    const repo = createSupabaseRepository(client, id);
    await repo.saveInitialLedger(buildInitialLedger([{ name: 'ของ C', opening: '10' }], '2026-11-01'));
    await repo.addBill({ id: 'bill-c', name: 'บิล C', amount: 1, dueDay: 1 }, '2026-11-04');
    await repo.saveSettings({ payDay: 5 });
    // ข้อมูลลงทุนของ C (พิสูจน์ว่าลบบัญชีตาม PDPA ลบตารางลงทุนด้วย)
    await repo.addAsset({ id: 'asset-c', name: 'กองทุน C', kind: 'fund' });
    await repo.addTrade({ id: 'trade-c', assetId: 'asset-c', kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z', units: '100000000', amount: 1000, fee: 0, withholding: 0, memo: '' });
    await repo.savePrice({ assetId: 'asset-c', date: '2026-11-10', priceMicro: 1_000_000 });
    for (const table of ['assets', 'trades', 'asset_prices']) {
      const before = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', id);
      expect(before.count, table).toBeGreaterThan(0);
    }
    const aBefore = (await (await repoFor(0)).loadLedger()).entries.length;
    // cooldown 24 ชม. หลังเปลี่ยนรหัส (M2-F): แม้รหัสถูก ลบบัญชี/ล้างข้อมูลไม่ได้ จนกว่าจะพ้นเวลา
    const cooling = await client.rpc('delete_my_account_step', { p_password: live.users[2]!.password });
    expect(cooling.error?.message ?? '').toMatch(/24 ชั่วโมง/);
    expect(await repo.isEmpty()).toBe(false);
    const aged = await admin.from('profiles').update({ password_changed_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }).eq('user_id', id);
    expect(aged.error).toBeNull();
    const wrong = await client.rpc('delete_my_account_step', { p_password: 'definitely-wrong-1A' });
    expect(wrong.error).toBeNull();
    expect(wrong.data).toBe('wrong');
    expect(await repo.isEmpty()).toBe(false);
    const ok = await client.rpc('delete_my_account_step', { p_password: live.users[2]!.password });
    expect(ok.error).toBeNull();
    expect(ok.data).toBe('done'); // สมุดเล็ก (< 500 รายการ) จบในชุดเดียว
    for (const table of ['accounts', 'entries', 'lines', 'bills', 'settings', 'profiles', 'assets', 'trades', 'asset_prices']) {
      const left = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', id);
      expect(left.error, table).toBeNull();
      expect(left.count, table).toBe(0);
    }
    const again = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const login = await again.auth.signInWithPassword({ email: live.users[2]!.email, password: live.users[2]!.password });
    expect(login.error).not.toBeNull();
    expect((await (await repoFor(0)).loadLedger()).entries.length).toBe(aBefore);
  });
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

  it('M2-F: ผู้ใช้ B ใช้ REST/RPC ตรงๆ กับรหัสและ user_id ของ A อ่าน/แก้/ลบ/เขียนแทนไม่ได้', async () => {
    await wipe(0);
    await wipe(1);
    await a.saveInitialLedger(buildInitialLedger([{ name: 'ของ A', opening: '1000' }], '2026-11-01'));
    await a.saveSettings({ payDay: 11 });
    const aLedger = await a.loadLedger();
    const wallet = aLedger.accounts.find((x) => x.type === 'asset')!;
    const category = aLedger.accounts.find((x) => x.type === 'expense')!;
    await a.addBill({ id: 'iso-bill', name: 'บิล A', amount: 100, dueDay: 5, walletId: wallet.id, categoryId: category.id }, '2026-11-04');
    const aEntry = aLedger.entries[0]!;
    const aId = (await signedIn(0)).id;
    const { client: bc, id: bId } = await signedIn(1);
    // อ่าน: ไม่เห็นแถวของ A แม้ระบุ user_id หรือ id ตรงๆ
    for (const table of ['accounts', 'entries', 'lines', 'bills', 'settings', 'profiles', 'assets', 'trades', 'asset_prices']) {
      const byUser = await bc.from(table).select('*').eq('user_id', aId);
      expect(byUser.error, table).toBeNull();
      expect(byUser.data ?? [], table).toHaveLength(0);
    }
    const byId = await bc.from('entries').select('id').eq('id', aEntry.id);
    expect(byId.data ?? []).toHaveLength(0);
    // เขียนแทน A: ใส่ user_id ของ A ใน insert/upsert ถูกปฏิเสธ
    const forgeEntry = await bc.from('entries').insert({ user_id: aId, id: 'forged', date: '2026-11-01', memo: '' });
    expect(forgeEntry.error).not.toBeNull();
    const forgeAccount = await bc.from('accounts').insert({ user_id: aId, id: 'forged', type: 'asset', name: 'x', currency: 'THB' });
    expect(forgeAccount.error).not.toBeNull();
    const forgeSettings = await bc.from('settings').upsert({ user_id: aId, value: { payDay: 1 } }, { onConflict: 'user_id' });
    expect(forgeSettings.error).not.toBeNull();
    // แก้/ลบแถวของ A ด้วย id ตรงๆ: ไม่มีแถวใดถูกแตะ
    await bc.from('bills').update({ name: 'ถูกแก้' }).eq('id', 'iso-bill');
    await bc.from('bills').delete().eq('id', 'iso-bill');
    await bc.from('entries').delete().eq('id', aEntry.id);
    await bc.from('entries').update({ memo: 'ถูกแก้' }).eq('id', aEntry.id);
    // RPC ด้วยรหัสรายการของ A: update_entry ไม่พบ · create_entry ด้วยรหัสเดียวกันสร้างในพื้นที่ของ B เท่านั้น (ไม่ทับของ A)
    const upd = await bc.rpc('update_entry', { p_entry: { id: aEntry.id, date: '2026-11-02', memo: 'x', lines: [] } });
    expect(upd.error).not.toBeNull();
    const cross = await bc.rpc('create_entry', {
      p_entry: { id: 'x1', date: '2026-11-02', memo: 'x', source: 'manual', lines: [{ accountId: wallet.id, amount: 1 }, { accountId: category.id, amount: -1 }] },
    });
    expect(cross.error).not.toBeNull(); // บัญชีของ A ไม่มีในพื้นที่ของ B
    // หลังทั้งหมด ข้อมูลของ A ครบเหมือนเดิม
    const after = await a.loadLedger();
    expect(after.entries).toHaveLength(aLedger.entries.length);
    expect(after.entries.find((e) => e.id === aEntry.id)?.memo).toBe(aEntry.memo);
    expect((await a.loadBills())[0]).toMatchObject({ id: 'iso-bill', name: 'บิล A' });
    expect(await a.loadSettings()).toEqual({ payDay: 11 });
    expect(await b.isEmpty()).toBe(true);
    expect(bId).not.toBe(aId);
  });

  it('M2-F: สมัครเอง / เข้าสู่ระบบแบบไม่ระบุตัวตน ถูกปฏิเสธ (ปิดที่เซิร์ฟเวอร์ ไม่ใช่แค่ซ่อนปุ่ม)', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const email = `signup-probe-${Math.random().toString(36).slice(2)}@users.money-buddy.internal`;
    const signUp = await anon.auth.signUp({ email, password: 'Probe-Password-1x' });
    expect(signUp.error).not.toBeNull();
    expect(signUp.data.session).toBeNull();
    const guest = await anon.auth.signInAnonymously();
    expect(guest.error).not.toBeNull();
    const found = await admin.from('profiles').select('user_id', { count: 'exact', head: true }).eq('user_id', signUp.data.user?.id ?? '00000000-0000-0000-0000-000000000000');
    expect(found.count ?? 0).toBe(0);
  });

  it('คนที่ไม่ได้ล็อกอิน (anon) อ่านและเรียก RPC ไม่ได้เลย', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const read = await anon.from('entries').select('id');
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
    const rpc = await anon.rpc('reset_my_ledger', { p_password: 'x' });
    expect(rpc.error).not.toBeNull();
    for (const name of ['reset_my_ledger_step', 'delete_my_account_step']) {
      expect((await anon.rpc(name, { p_password: 'x' })).error, name).not.toBeNull();
    }
    const imp = await anon.rpc('import_ledger', { p_data: { accounts: [], bills: [], entries: [] } });
    expect(imp.error).not.toBeNull();
    expect((await a.loadLedger()).entries.length).toBeGreaterThan(0);
  });
});
