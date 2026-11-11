import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { cashBalance } from '../../src/domain/ledger/overview';
import type { TradeRecord } from '../../src/domain/invest/types';
import { StorageError } from '../../src/storage/repository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';
import type { LedgerRepository } from '../../src/storage/ledgerRepository';
import { loadAdmin } from '../../scripts/lib/admin.mjs';

/**
 * พอร์ตลงทุน P3: ยืนยันกับ Supabase จริงว่าตาราง assets / trades / asset_prices แยกข้อมูลต่อผู้ใช้ (RLS)
 * ทั้งผ่าน repository และ REST ตรง (ผู้ใช้ B อ่าน/แก้/ลบ/เขียนแทนของ A ไม่ได้) และไฟล์สำรองที่มีข้อมูลลงทุน ส่งออก→ตรวจ→นำเข้า ครบ
 * รัน: npm run admin:live-contract (เครื่องเจ้าของเท่านั้น · ต้องตั้ง MONEY_BUDDY_LIVE_TESTS=yes) · ใช้ผู้ใช้ทดสอบ a และ b
 * ล้างข้อมูลของ a และ b ด้วยสิทธิ์ผู้ดูแลก่อนและหลังรัน (เฉพาะผู้ใช้ livetest-)
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
  const client = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.user) throw new Error('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ');
  const session = { client, id: data.user.id };
  sessions.set(user.email, session);
  return session;
}

/** ด่านกันเผื่ออนาคต: ลบด้วยสิทธิ์ผู้ดูแลได้เฉพาะผู้ใช้ทดสอบ livetest- ของรอบนี้ */
function assertTestUser(id: string): void {
  const ok = (id === A.id && A.email.startsWith('livetest-')) || (id === B.id && B.email.startsWith('livetest-'));
  if (!ok) throw new Error('หยุด: ไม่ใช่ผู้ใช้ทดสอบ a/b ของรอบนี้ ไม่ลบอะไร');
}

// ลำดับตาม FK เดิม: รายการ → บิล → บัญชี (ลบบัญชีลงทุน cascade ไปสินทรัพย์/รายการ/ราคา) → ตั้งค่า
async function wipe(index: number): Promise<void> {
  const { id } = await signedIn(index);
  assertTestUser(id);
  for (const table of ['entries', 'bills', 'accounts', 'settings']) {
    const { error } = await admin.from(table).delete().eq('user_id', id);
    if (error) throw new Error('ล้างข้อมูลผู้ใช้ทดสอบไม่สำเร็จที่ตาราง ' + table);
  }
}

async function repoFor(index: number): Promise<LedgerRepository> {
  const { client, id } = await signedIn(index);
  return createSupabaseRepository(client, id, { getPasswordForReset: async () => live.users[index]!.password });
}

const ASSET = { id: 'asset-live', name: 'กองทุนทดสอบ', kind: 'fund' as const };
const trade = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'trade-buy', assetId: ASSET.id, kind: 'buy', date: '2026-11-05', createdAt: '2026-11-05T03:00:00.000Z',
  units: '500000000', priceMicro: 10_000_000, amount: 50_000, fee: 5, withholding: 0, memo: '', ...over,
});

describe('พอร์ตลงทุน: แยกข้อมูลต่อผู้ใช้ (RLS) ผ่าน repository และ REST ตรง', () => {
  let a: LedgerRepository;
  let b: LedgerRepository;
  beforeAll(async () => {
    a = await repoFor(0);
    b = await repoFor(1);
    await wipe(0);
    await wipe(1);
    await a.saveInitialLedger(buildInitialLedger([{ name: 'เงินสดของ A', opening: '1000' }], '2026-11-01'));
    await a.addAsset(ASSET);
    await a.addTrade(trade({}));
    await a.addTrade(trade({ id: 'trade-sell', kind: 'sell', date: '2026-11-20', createdAt: '2026-11-20T03:00:00.000Z', units: '100000000', priceMicro: 12_000_000, amount: undefined, fee: 3 }));
    await a.addTrade(trade({ id: 'trade-div', kind: 'dividend', date: '2026-11-25', createdAt: '2026-11-25T03:00:00.000Z', units: undefined, priceMicro: undefined, amount: 1000, fee: 0, withholding: 100 }));
    await a.savePrice({ assetId: ASSET.id, date: '2026-11-10', priceMicro: 11_000_000 });
  });
  afterAll(async () => {
    await wipe(0);
    await wipe(1);
  });

  it('A เห็นข้อมูลลงทุนของตัวเองครบ · บัญชีลงทุนของสินทรัพย์ไม่นับเป็นเงินสด', async () => {
    const inv = await a.loadInvestments();
    expect(inv.assets).toEqual([{ id: ASSET.id, name: ASSET.name, kind: 'fund', accountId: 'inv-asset-live' }]);
    expect(inv.trades.map((t) => t.id).sort()).toEqual(['trade-buy', 'trade-div', 'trade-sell']);
    expect(inv.prices).toEqual([{ assetId: ASSET.id, date: '2026-11-10', priceMicro: 11_000_000 }]);
    const ledger = await a.loadLedger();
    expect(ledger.accounts.find((x) => x.id === 'inv-asset-live')?.kind).toBe('investment');
    expect(cashBalance(ledger.accounts, ledger.entries, '2026-11-30')).toBe(100_000); // 1,000 บาท (ไม่รวมบัญชีลงทุน)
  });

  it('ผ่าน repository: B ไม่เห็น · เพิ่มรายการ/ราคาให้สินทรัพย์ของ A ไม่ได้ · ลบรายการของ A ไม่ได้ · ข้อมูลของ A ไม่เปลี่ยน', async () => {
    const empty = await b.loadInvestments();
    expect(empty).toEqual({ assets: [], trades: [], prices: [] });
    await expect(b.addTrade(trade({ id: 'b-steal' }))).rejects.toThrow(StorageError); // FK: ไม่มีสินทรัพย์นี้ของ B
    await expect(b.savePrice({ assetId: ASSET.id, date: '2026-11-11', priceMicro: 1 })).rejects.toThrow(StorageError);
    await expect(b.deleteTrade('trade-sell')).rejects.toThrow(/ไม่พบ/);
    const after = await a.loadInvestments();
    expect(after.trades).toHaveLength(3);
    expect(after.prices).toHaveLength(1);
    expect((await b.loadInvestments()).trades).toHaveLength(0);
  });

  it('ผ่าน REST ตรง: B อ่านได้ 0 แถว · แก้/ลบของ A ได้ 0 แถว · ใส่ user_id ของ A ไม่ได้ · ผูกสินทรัพย์/รายการสมุดของ A ไม่ได้', async () => {
    const { client } = await signedIn(1);
    for (const table of ['assets', 'trades', 'asset_prices']) {
      const read = await client.from(table).select('*');
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
    }
    const upd = await client.from('trades').update({ memo: 'hack' }).eq('id', 'trade-buy').select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual([]);
    const updAsset = await client.from('assets').update({ name: 'hack' }).eq('id', ASSET.id).select('id');
    expect(updAsset.data ?? []).toEqual([]);
    const updPrice = await client.from('asset_prices').update({ price_micro: 1 }).eq('asset_id', ASSET.id).select('asset_id');
    expect(updPrice.data ?? []).toEqual([]);
    for (const [table, key] of [['trades', 'id'], ['assets', 'id'], ['asset_prices', 'asset_id']] as const) {
      const del = await client.from(table).delete().eq(key, key === 'asset_id' ? ASSET.id : key === 'id' && table === 'assets' ? ASSET.id : 'trade-buy').select(key);
      expect(del.error).toBeNull();
      expect(del.data).toEqual([]);
    }
    // เขียนในชื่อ A (user_id ของ A) ถูก RLS ปฏิเสธ
    const aId = (await signedIn(0)).id;
    const forgedAsset = await client.from('assets').insert({ user_id: aId, id: 'forged', name: 'x', account_id: 'inv-asset-live' });
    expect(forgedAsset.error).not.toBeNull();
    const forgedTrade = await client.from('trades').insert({ user_id: aId, id: 'forged-t', asset_id: ASSET.id, kind: 'buy', date: '2026-11-06', units: '1', amount: 1 });
    expect(forgedTrade.error).not.toBeNull();
    // เขียนในชื่อตัวเองแต่อ้างสินทรัพย์/รายการสมุดของ A: FK แบบรวม user_id ปฏิเสธ
    const crossAsset = await client.from('trades').insert({ id: 'cross-t', asset_id: ASSET.id, kind: 'buy', date: '2026-11-06', units: '1', amount: 1 });
    expect(crossAsset.error).not.toBeNull();
    const aLedger = await (await repoFor(0)).loadLedger();
    const aEntryId = aLedger.entries[0]!.id;
    const bAsset = await client.from('assets').insert({ id: 'b-own', name: 'x', account_id: 'inv-asset-live' });
    expect(bAsset.error).not.toBeNull(); // บัญชีลงทุนของ A ใช้ไม่ได้
    const crossEntry = await client.from('trades').insert({ id: 'cross-e', asset_id: 'b-own', kind: 'buy', date: '2026-11-06', units: '1', amount: 1, entry_id: aEntryId });
    expect(crossEntry.error).not.toBeNull();
    // ข้อมูลของ A ยังครบหลังความพยายามทั้งหมด
    const check = await a.loadInvestments();
    expect(check.assets).toHaveLength(1);
    expect(check.trades.find((t) => t.id === 'trade-buy')?.memo).toBe('');
    expect(check.trades).toHaveLength(3);
    expect(check.prices[0]?.priceMicro).toBe(11_000_000);
  });

  it('anon (ไม่ล็อกอิน) อ่านตารางลงทุนไม่ได้', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    for (const table of ['assets', 'trades', 'asset_prices']) {
      const res = await anon.from(table).select('*');
      expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
    }
  });

  it('กติกาลำดับ/ขายเกินที่ repository บังคับ: เพิ่มซื้อก่อนรายการขาย/ขายเกินที่ถือ/ลบซื้อก่อนขาย ถูกปฏิเสธ', async () => {
    await expect(a.addTrade(trade({ id: 'late-buy', date: '2026-11-15', createdAt: '2026-11-15T03:00:00.000Z' }))).rejects.toThrow(/รายการขาย/);
    await expect(a.addTrade(trade({ id: 'oversell', kind: 'sell', date: '2026-11-26', createdAt: '2026-11-26T03:00:00.000Z', units: '9999999999', amount: undefined, priceMicro: 1_000_000 }))).rejects.toThrow(/ถือ/);
    await expect(a.deleteTrade('trade-buy')).rejects.toThrow(/รายการขาย/);
    expect((await a.loadInvestments()).trades).toHaveLength(3);
  });

  it('ส่งออกไฟล์สำรองมีข้อมูลลงทุนครบ → ตรวจไฟล์ผ่าน → นำเข้าเป็นของ B ได้ครบ (kind, สินทรัพย์, รายการ, ราคา) โดยของ A ไม่เปลี่ยน', async () => {
    const snapshot = await a.exportSnapshot(new Date('2026-11-12T00:00:00.000Z'));
    expect(snapshot.investments?.assets).toHaveLength(1);
    expect(snapshot.investments?.trades).toHaveLength(3);
    expect(snapshot.investments?.prices).toHaveLength(1);
    const text = JSON.stringify(snapshot);
    const parsed = parseBackup(text, '2026-11-12');
    if (!parsed.ok) throw new Error(parsed.problems.join(' | '));
    expect(parsed.data.investments).toEqual(snapshot.investments);
    expect(parsed.data.accounts.find((x) => x.id === 'inv-asset-live')?.kind).toBe('investment');

    await wipe(1);
    expect(await b.isEmpty()).toBe(true);
    await b.importBackup(parsed.data);
    const inv = await b.loadInvestments();
    expect(inv.assets).toEqual(snapshot.investments?.assets);
    expect(inv.trades).toEqual(snapshot.investments?.trades);
    expect(inv.prices).toEqual(snapshot.investments?.prices);
    const ledgerB = await b.loadLedger();
    expect(ledgerB.accounts.find((x) => x.id === 'inv-asset-live')?.kind).toBe('investment');
    expect(cashBalance(ledgerB.accounts, ledgerB.entries, '2026-11-30')).toBe(100_000);
    // ส่งออกของ B ซ้ำ = ข้อมูลลงทุนเดิม (round-trip)
    const again = await b.exportSnapshot(new Date('2026-11-12T00:00:00.000Z'));
    expect(again.investments).toEqual(snapshot.investments);
    // ของ A ไม่เปลี่ยนจากการนำเข้าของ B
    expect(await a.loadInvestments()).toEqual(inv);
  });

  it('นำเข้าไฟล์ที่ข้อมูลลงทุนเสียถูกฐานข้อมูล/ตัวตรวจปฏิเสธ ไม่เหลือข้อมูลลงทุนครึ่งเดียว', async () => {
    const snapshot = await a.exportSnapshot(new Date('2026-11-12T00:00:00.000Z'));
    const broken = JSON.parse(JSON.stringify(snapshot)) as { investments: { trades: { units?: string }[] } };
    broken.investments.trades[0]!.units = '012'; // เลขนำหน้าด้วย 0 ผิดรูปแบบ
    expect(parseBackup(JSON.stringify(broken), '2026-11-12').ok).toBe(false);
    // ส่งตรงเข้า RPC (ข้ามตัวตรวจฝั่งเว็บ): ฐานข้อมูลต้องปฏิเสธทั้งก้อน
    await wipe(1);
    const { client } = await signedIn(1);
    const begin = await client.rpc('import_ledger', { p_data: { accounts: snapshot.accounts, entries: snapshot.entries } });
    expect(begin.error).toBeNull();
    const bad = await client.rpc('import_ledger_investments', { p_data: broken.investments });
    expect(bad.error).not.toBeNull();
    const inv = await b.loadInvestments();
    expect(inv).toEqual({ assets: [], trades: [], prices: [] });
  });
});
