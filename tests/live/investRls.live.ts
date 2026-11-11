import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { parseBackup } from '../../src/domain/backup/parseBackup';
import { isCashWallet } from '../../src/domain/ledger/accountKind';
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

/** นับแถวด้วยสิทธิ์ผู้ดูแล (ข้าม RLS) ตามเงื่อนไข · ใช้ยืนยันว่าคำสั่งที่ถูกปฏิเสธไม่ได้เขียน/ย้ายแถวจริง */
async function adminCount(table: string, filters: Record<string, string>): Promise<number> {
  let q = admin.from(table).select('*', { count: 'exact', head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
  const { count, error } = await q;
  if (error) throw new Error('นับแถวด้วยสิทธิ์ผู้ดูแลไม่สำเร็จที่ตาราง ' + table);
  return count ?? 0;
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

/** บันทึกรายการลงทุนผ่าน record_trade ด้วยกระเป๋าเงินสดแรกของผู้ใช้ (ไม่มีกระเป๋า = ให้ repository แจ้งว่าไม่พบสินทรัพย์/กระเป๋า) */
async function rec(r: LedgerRepository, t: TradeRecord): Promise<TradeRecord> {
  const wallet = (await r.loadLedger()).accounts.find(isCashWallet)?.id ?? 'no-wallet';
  return r.recordTrade({ trade: t, walletId: t.kind === 'reinvest' ? undefined : wallet });
}

const ASSET = { id: 'asset-live', name: 'กองทุนทดสอบ', kind: 'fund' as const };
const ASSET2 = { id: 'asset-live2', name: 'หุ้นทดสอบ', kind: 'stock' as const };
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
    await rec(a, trade({}));
    await rec(a, trade({ id: 'trade-sell', kind: 'sell', date: '2026-11-20', createdAt: '2026-11-20T03:00:00.000Z', units: '100000000', priceMicro: 12_000_000, amount: undefined, fee: 3 }));
    await rec(a, trade({ id: 'trade-div', kind: 'dividend', date: '2026-11-25', createdAt: '2026-11-25T03:00:00.000Z', units: undefined, priceMicro: undefined, amount: 1000, fee: 0, withholding: 100 }));
    await a.savePrice({ assetId: ASSET.id, date: '2026-11-10', priceMicro: 11_000_000 });
    // สินทรัพย์ที่สอง (พิสูจน์ว่า addTrade/deleteTrade อ่านรายการของสินทรัพย์เดียวได้เมื่อมีหลายสินทรัพย์)
    await a.addAsset(ASSET2);
    await rec(a, trade({ id: 'trade-buy2', assetId: ASSET2.id }));
    await a.deleteTrade('trade-buy2');
    await rec(a, trade({ id: 'trade-buy2', assetId: ASSET2.id }));
  });
  afterAll(async () => {
    await wipe(0);
    await wipe(1);
  });

  it('A เห็นข้อมูลลงทุนของตัวเองครบ · บัญชีลงทุนของสินทรัพย์ไม่นับเป็นเงินสด', async () => {
    const inv = await a.loadInvestments();
    expect(inv.assets).toEqual([
      { id: ASSET.id, name: ASSET.name, kind: 'fund', accountId: 'inv-asset-live' },
      { id: ASSET2.id, name: ASSET2.name, kind: 'stock', accountId: 'inv-asset-live2' },
    ]);
    expect(inv.trades.map((t) => t.id).sort()).toEqual(['trade-buy', 'trade-buy2', 'trade-div', 'trade-sell']);
    expect(inv.prices).toEqual([{ assetId: ASSET.id, date: '2026-11-10', priceMicro: 11_000_000 }]);
    const ledger = await a.loadLedger();
    expect(ledger.accounts.find((x) => x.id === 'inv-asset-live')?.kind).toBe('investment');
    expect(cashBalance(ledger.accounts, ledger.entries, '2026-11-30')).toBe(2_087); // เริ่ม 1,000 บาท (100,000 สตางค์) − ซื้อ 50,005 + ขาย 1,197 + ปันผลสุทธิ 900 − ซื้อ 50,005 (ผูกสมุด P4 · ไม่รวมบัญชีลงทุน)
  });

  it('ผ่าน repository: B ไม่เห็น · เพิ่มรายการ/ราคาให้สินทรัพย์ของ A ไม่ได้ · ลบรายการของ A ไม่ได้ · ข้อมูลของ A ไม่เปลี่ยน', async () => {
    const empty = await b.loadInvestments();
    expect(empty).toEqual({ assets: [], trades: [], prices: [] });
    await expect(rec(b, trade({ id: 'b-steal' }))).rejects.toThrow(StorageError); // FK: ไม่มีสินทรัพย์นี้ของ B
    await expect(b.savePrice({ assetId: ASSET.id, date: '2026-11-11', priceMicro: 1 })).rejects.toThrow(StorageError);
    await expect(b.deleteTrade('trade-sell')).rejects.toThrow(/ไม่พบ/);
    const after = await a.loadInvestments();
    expect(after.trades).toHaveLength(4);
    expect(after.prices).toHaveLength(1);
    expect((await b.loadInvestments()).trades).toHaveLength(0);
  });

  it('ผ่าน REST ตรง: B อ่านได้ 0 แถว · แก้/ลบของ A ได้ 0 แถว · ใส่ user_id ของ A ไม่ได้ (RLS 42501) · ผูกสินทรัพย์/รายการสมุดของ A ไม่ได้ (FK 23503)', async () => {
    const { client } = await signedIn(1);
    const aId = (await signedIn(0)).id;
    const RLS = '42501';
    const FK = '23503';
    // อ่าน: A มีข้อมูลอยู่ก่อนแล้ว (จึงพิสูจน์ได้ว่า "ว่าง" มาจาก RLS ไม่ใช่ไม่มีข้อมูล)
    for (const table of ['assets', 'trades', 'asset_prices']) {
      const readAsAdmin = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', aId);
      expect(readAsAdmin.count, table).toBeGreaterThan(0);
      const read = await client.from(table).select('*');
      expect(read.error, table).toBeNull();
      expect(read.data, table).toEqual([]);
    }
    // แก้/ลบแถวของ A ด้วยรหัสจริง: ไม่มี error แต่ได้ 0 แถว (RLS กรองทิ้ง)
    const upd = await client.from('trades').update({ memo: 'hack' }).eq('id', 'trade-buy').select('id');
    expect(upd.error).toBeNull();
    expect(upd.data).toEqual([]);
    const updAsset = await client.from('assets').update({ name: 'hack' }).eq('id', ASSET.id).select('id');
    expect(updAsset.error).toBeNull();
    expect(updAsset.data).toEqual([]);
    const updPrice = await client.from('asset_prices').update({ price_micro: 1 }).eq('asset_id', ASSET.id).select('asset_id');
    expect(updPrice.error).toBeNull();
    expect(updPrice.data).toEqual([]);
    const delTrade = await client.from('trades').delete().eq('id', 'trade-buy').select('id');
    expect(delTrade.error).toBeNull();
    expect(delTrade.data).toEqual([]);
    const delAsset = await client.from('assets').delete().eq('id', ASSET.id).select('id');
    expect(delAsset.error).toBeNull();
    expect(delAsset.data).toEqual([]);
    const delPrice = await client.from('asset_prices').delete().eq('asset_id', ASSET.id).select('asset_id');
    expect(delPrice.error).toBeNull();
    expect(delPrice.data).toEqual([]);

    // สินทรัพย์ของ B เอง: ใช้เป็น control ด้านล่าง และเป็นเป้าของกรณีข้ามผู้ใช้
    const bOwn = await b.addAsset({ id: 'b-own', name: 'ของ B', kind: 'fund' });

    // ---- เขียนในชื่อ A (user_id ของ A) ผ่าน REST ----
    // trades / asset_prices: payload ถูกต้องทุกช่อง (ผ่าน check constraint ของตาราง) ต่างจาก control แค่ user_id (และสินทรัพย์ของผู้ใช้นั้นเอง)
    // RLS (WITH CHECK) ทำงานก่อน check constraint/FK ดังนั้นต้องได้ 42501 · control: payload เดียวกันของ B เอง ต้องผ่าน (แล้วลบทิ้ง)
    // พิสูจน์ว่า 42501 มาจาก RLS ไม่ใช่เพราะข้อมูลผิดรูปแบบ
    const tradeBody = { kind: 'buy', date: '2026-11-06', units: '1', amount: 1, fee: 0, withholding: 0, memo: '' };
    const forgedTrade = await client.from('trades').insert({ user_id: aId, id: 'forge-t', asset_id: ASSET.id, ...tradeBody });
    expect(forgedTrade.error?.code).toBe(RLS);
    expect(await adminCount('trades', { id: 'forge-t' })).toBe(0); // ไม่มีแถวถูกเขียนจริง
    const ctrlTrade = await client.from('trades').insert({ user_id: B.id, id: 'forge-t', asset_id: bOwn.id, ...tradeBody });
    expect(ctrlTrade.error).toBeNull();
    const ctrlTradeDel = await client.from('trades').delete().eq('id', 'forge-t').select('id');
    expect(ctrlTradeDel.error).toBeNull();
    expect(ctrlTradeDel.data).toHaveLength(1);

    const priceBody = { date: '2026-11-12', price_micro: 5 };
    const forgedPrice = await client.from('asset_prices').insert({ user_id: aId, asset_id: ASSET.id, ...priceBody });
    expect(forgedPrice.error?.code).toBe(RLS);
    expect(await adminCount('asset_prices', { asset_id: ASSET.id, date: '2026-11-12' })).toBe(0);
    const ctrlPrice = await client.from('asset_prices').insert({ user_id: B.id, asset_id: bOwn.id, ...priceBody });
    expect(ctrlPrice.error).toBeNull();
    const ctrlPriceDel = await client.from('asset_prices').delete().eq('asset_id', bOwn.id).eq('date', '2026-11-12').select('asset_id');
    expect(ctrlPriceDel.error).toBeNull();
    expect(ctrlPriceDel.data).toHaveLength(1);
    const forgedUpsert = await client.from('asset_prices').upsert({ user_id: aId, asset_id: ASSET.id, date: '2026-11-10', price_micro: 5 }, { onConflict: 'user_id,asset_id,date' });
    expect(forgedUpsert.error).not.toBeNull();
    expect(await adminCount('asset_prices', { asset_id: ASSET.id, date: '2026-11-10', price_micro: '11000000' })).toBe(1); // ราคาของ A ไม่ถูกแก้

    // assets: ตาราง assets มี BEFORE trigger assets_guard (security invoker) ที่ตรวจว่าบัญชีเป็นบัญชีลงทุนของ user_id นั้น
    // ซึ่ง B มองบัญชีของ A ไม่เห็น (RLS ของ accounts) → ถูกปฏิเสธด้วย 23514 "ก่อน" ถึงเงื่อนไข WITH CHECK ของ assets · ผลคือปลอมไม่ได้เหมือนกัน
    // (ไม่ใช่ข้อบกพร่อง: BEFORE trigger ทำงานก่อน RLS) ส่วนเงื่อนไข WITH CHECK ของ assets พิสูจน์ด้วยการ update user_id ด้านล่าง (42501)
    const forgedAsset = await client.from('assets').insert({ user_id: aId, id: 'forge-a', name: 'x', kind: 'fund', account_id: 'inv-asset-live' });
    expect(forgedAsset.error?.code).toBe('23514');
    const forgedAssetRow = await admin.from('assets').select('id').eq('id', 'forge-a');
    expect(forgedAssetRow.data).toEqual([]); // ไม่มีแถวปลอมหลงเหลือ
    // control: payload เดียวกันแต่เป็นของ B เอง (บัญชีลงทุนของ B เอง) ต้องผ่าน แล้วลบทิ้ง
    const ctrlAcc = await client.from('accounts').insert({ id: 'inv-ctrl', type: 'asset', name: 'ctrl', currency: 'THB', kind: 'investment' });
    expect(ctrlAcc.error).toBeNull();
    const ctrlAsset = await client.from('assets').insert({ user_id: B.id, id: 'forge-a', name: 'x', kind: 'fund', account_id: 'inv-ctrl' });
    expect(ctrlAsset.error).toBeNull();
    const ctrlAssetDel = await client.from('assets').delete().eq('id', 'forge-a').select('id');
    expect(ctrlAssetDel.error).toBeNull();
    expect(ctrlAssetDel.data).toHaveLength(1);
    const ctrlAccDel = await client.from('accounts').delete().eq('id', 'inv-ctrl').select('id');
    expect(ctrlAccDel.error).toBeNull();
    expect(ctrlAccDel.data).toHaveLength(1);

    // ผูกสินทรัพย์/รายการสมุดของ A จากแถวของตัวเอง: FK รวม user_id ปฏิเสธ (23503)
    const crossAsset = await client.from('trades').insert({ id: 'cross-t', asset_id: ASSET.id, kind: 'buy', date: '2026-11-06', units: '1', amount: 1 });
    expect(crossAsset.error?.code).toBe(FK); // trades ไม่มี trigger ก่อนหน้า: RLS ผ่าน (user_id ของ B เอง) แล้ว FK ปฏิเสธ
    expect(await adminCount('trades', { id: 'cross-t' })).toBe(0);
    const aEntryId = (await a.loadLedger()).entries[0]!.id;
    const crossEntry = await client.from('trades').insert({ id: 'cross-e', asset_id: bOwn.id, kind: 'buy', date: '2026-11-06', units: '1', amount: 1, entry_id: aEntryId });
    expect(crossEntry.error?.code).toBe(RLS); // (P4) trigger กัน entry_id ที่ไม่ได้มาจาก record_trade ทำงานก่อน FK
    expect(await adminCount('trades', { id: 'cross-e' })).toBe(0);
    const bAssetOnAAccount = await client.from('assets').insert({ id: 'b-steal-acc', name: 'x', account_id: 'inv-asset-live' });
    // assets_guard (BEFORE trigger) ตรวจก่อน FK: B มองบัญชีของ A ไม่เห็น จึงปฏิเสธด้วย 23514 (ไม่ใช่ 23503)
    expect(bAssetOnAAccount.error?.code).toBe('23514');
    expect(await adminCount('assets', { id: 'b-steal-acc' })).toBe(0);

    // "ยัดข้อมูลของตัวเองเข้าบัญชีคนอื่น" ด้วย update: with check ต้องปฏิเสธ (42501) ทั้ง 3 ตาราง
    await rec(b, trade({ id: 'b-trade', assetId: bOwn.id, units: '100000000', amount: 1000 }));
    await b.savePrice({ assetId: bOwn.id, date: '2026-11-10', priceMicro: 1_000_000 });
    const moveTrade = await client.from('trades').update({ user_id: aId }).eq('id', 'b-trade');
    expect(moveTrade.error?.code).toBe(RLS); // update user_id ไม่ผ่าน assets_guard/trigger ใด: WITH CHECK ปฏิเสธ
    expect(await adminCount('trades', { id: 'b-trade', user_id: B.id })).toBe(1);
    const moveAsset = await client.from('assets').update({ user_id: aId }).eq('id', bOwn.id);
    expect(moveAsset.error?.code).toBe(RLS); // assets_guard ทำงานเฉพาะ insert หรือ update of account_id จึงไม่ถูกเรียกที่นี่
    expect(await adminCount('assets', { id: bOwn.id, user_id: B.id })).toBe(1);
    const movePrice = await client.from('asset_prices').update({ user_id: aId }).eq('asset_id', bOwn.id);
    expect(movePrice.error?.code).toBe(RLS);
    expect(await adminCount('asset_prices', { asset_id: bOwn.id, user_id: B.id })).toBe(1);
    // ย้ายรายการของตัวเองไปชี้สินทรัพย์ของ A: FK ปฏิเสธ
    const repoint = await client.from('trades').update({ asset_id: ASSET.id }).eq('id', 'b-trade');
    expect(repoint.error?.code).toBe(RLS); // (P4) trades_update_guard (BEFORE UPDATE) ปฏิเสธการแก้ตรงๆ ก่อน FK
    expect(await adminCount('trades', { id: 'b-trade', asset_id: bOwn.id })).toBe(1);

    // ข้อมูลของ A ยังครบเหมือนเดิมหลังความพยายามทั้งหมด
    const check = await a.loadInvestments();
    expect(check.assets.map((x) => x.name)).toEqual([ASSET.name, ASSET2.name]);
    expect(check.trades).toHaveLength(4);
    expect(check.trades.find((t) => t.id === 'trade-buy')?.memo).toBe('');
    expect(check.prices).toHaveLength(1);
    expect(check.prices[0]?.priceMicro).toBe(11_000_000);
    // ... และข้อมูลของ B มีแค่ของ B เอง
    const bInv = await b.loadInvestments();
    expect(bInv.assets.map((x) => x.id)).toEqual(['b-own']);
    expect(bInv.trades.map((t) => t.id)).toEqual(['b-trade']);
  });

  it('anon (ไม่ล็อกอิน) อ่าน/เขียน/ลบตารางลงทุนไม่ได้', async () => {
    const anon = createClient(live.url, live.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    for (const table of ['assets', 'trades', 'asset_prices']) {
      const res = await anon.from(table).select('*');
      expect(res.error !== null || (res.data ?? []).length === 0).toBe(true);
      const ins = await anon.from(table).insert(table === 'assets' ? { id: 'anon', name: 'x', account_id: 'x' } : table === 'trades' ? { id: 'anon', asset_id: 'x', kind: 'buy', date: '2026-11-06', units: '1', amount: 1 } : { asset_id: 'x', date: '2026-11-06', price_micro: 1 });
      expect(ins.error, table).not.toBeNull();
      const del = await anon.from(table).delete().neq('user_id', '00000000-0000-0000-0000-000000000000').select('*');
      expect(del.error !== null || (del.data ?? []).length === 0, table).toBe(true);
    }
    const aStill = await a.loadInvestments();
    expect(aStill.trades).toHaveLength(4);
  });

  it('กติกาลำดับ/ขายเกินที่ repository บังคับ: เพิ่มซื้อก่อนรายการขาย/ขายเกินที่ถือ/ลบซื้อก่อนขาย ถูกปฏิเสธ', async () => {
    await expect(rec(a, trade({ id: 'late-buy', date: '2026-11-15', createdAt: '2026-11-15T03:00:00.000Z' }))).rejects.toThrow(/รายการขาย/);
    await expect(rec(a, trade({ id: 'oversell', kind: 'sell', date: '2026-11-26', createdAt: '2026-11-26T03:00:00.000Z', units: '9999999999', amount: undefined, priceMicro: 1_000_000 }))).rejects.toThrow(/ถือ/);
    await expect(a.deleteTrade('trade-buy')).rejects.toThrow(/รายการขาย/);
    expect((await a.loadInvestments()).trades).toHaveLength(4);
  });

  it('ส่งออกไฟล์สำรองมีข้อมูลลงทุนครบ → ตรวจไฟล์ผ่าน → นำเข้าเป็นของ B ได้ครบ (kind, สินทรัพย์, รายการ, ราคา) โดยของ A ไม่เปลี่ยน', async () => {
    const snapshot = await a.exportSnapshot(new Date('2026-11-12T00:00:00.000Z'));
    expect(snapshot.investments?.assets).toHaveLength(2);
    expect(snapshot.investments?.trades).toHaveLength(4);
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
    expect(cashBalance(ledgerB.accounts, ledgerB.entries, '2026-11-30')).toBe(2_087); // เท่ากับของ A (นำเข้าทั้งสมุดและรายการลงทุนที่ผูก)
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
