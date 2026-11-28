import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { messageFor } from '../../src/domain/errors/coded';
import { AccountChangedError } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository, storageErrorFrom } from '../../src/storage/supabaseRepository';

/**
 * ทุกคำขอของ repository ต้องแนบ x-expected-user ให้ trigger ของฐานข้อมูล (migration 20261129000100) ตรวจบัญชีในธุรกรรมเดียวกับการเขียน
 * ใช้ supabase-js ตัวจริง + fetch จำลอง: ถ้าอัปเกรดไลบรารีแล้วหัวคำขอหาย เทสต์นี้ต้องล้ม
 */
const HEADER = 'x-expected-user';
const ME = '11111111-1111-4111-8111-111111111111';

interface Sent {
  method: string;
  path: string;
  expected: string | null;
}

function setup(respond: (sent: Sent) => { status: number; body: unknown } = () => ({ status: 200, body: [] })) {
  const sent: Sent[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const request = { method: init?.method ?? 'GET', path: url.pathname.replace('/rest/v1/', ''), expected: new Headers(init?.headers).get(HEADER) };
    sent.push(request);
    const r = respond(request);
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json', 'content-range': `0-0/${Array.isArray(r.body) ? r.body.length : 0}` },
    });
  };
  const client = createClient('http://example.invalid', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fakeFetch },
  });
  return { client, repo: createSupabaseRepository(client, ME), sent };
}
/** เรียกแล้วไม่สนผล (คำตอบจำลองไม่ครบทุกรูปแบบ) สนเฉพาะคำขอที่ออกไป */
const run = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);

describe('หัวคำขอ x-expected-user', () => {
  it('upsert (อัตราแลกเปลี่ยน ราคา)', async () => {
    const { repo, sent } = setup();
    await run(repo.saveFxRate({ accountId: 'a', date: '2026-11-01', rateMicro: 35_000_000 }));
    await run(repo.savePrice({ assetId: 's', date: '2026-11-01', priceMicro: 1_000_000 }));
    expect(sent.map((s) => [s.method, s.path, s.expected])).toEqual([
      ['POST', 'fx_rates', ME],
      ['POST', 'asset_prices', ME],
    ]);
  });

  it('insert (บัญชีเงินสด USD)', async () => {
    const { repo, sent } = setup();
    await run(repo.addUsdCash({ id: 'u', name: 'สมมติ' }));
    expect(sent).toEqual([{ method: 'POST', path: 'accounts', expected: ME }]);
  });

  it('delete (ลบรายการในสมุด ผ่าน fx_exchanges)', async () => {
    const { repo, sent } = setup((s) => ({ status: 200, body: s.path === 'fx_exchanges' ? [{ entry_id: 'e1' }] : [] }));
    await run(repo.deleteFxExchange('x'));
    expect(sent.at(-1)).toEqual({ method: 'DELETE', path: 'entries', expected: ME });
  });

  it('update (เปลี่ยนชื่อกระเป๋า)', async () => {
    const row = { id: 'w', type: 'asset', name: 'เดิม', currency: 'THB', archived: false, sort_order: 1, kind: 'normal' };
    const { repo, sent } = setup((s) => ({ status: 200, body: s.path === 'accounts' ? [row] : [] }));
    await run(repo.renameWallet('w', 'ใหม่'));
    expect(sent.find((s) => s.method === 'PATCH')).toEqual({ method: 'PATCH', path: 'accounts', expected: ME });
  });

  it('RPC (ลบสินทรัพย์ · ค่าตั้งค่า)', async () => {
    const { repo, sent } = setup((s) => ({ status: 200, body: s.path === 'settings' ? [] : {} }));
    await run(repo.deleteAsset('s'));
    await run(repo.patchSettings({ payDay: 5 }));
    const rpcs = sent.filter((s) => s.path.startsWith('rpc/'));
    expect(rpcs.map((s) => [s.path, s.expected])).toEqual([
      ['rpc/delete_asset', ME],
      ['rpc/merge_settings', ME],
    ]);
  });

  it('ไม่ติดไปกับ client เดิม (คำขอที่ไม่ผ่าน repository ไม่มีหัวคำขอ)', async () => {
    const { client, repo, sent } = setup();
    await run(repo.loadBills());
    await client.from('profiles').select('consented_at');
    expect(sent.at(-1)).toEqual({ method: 'GET', path: 'profiles', expected: null });
  });
});

describe('PT412 จาก trigger = บัญชีเปลี่ยน', () => {
  const changed = { status: 412, body: { code: 'PT412', message: 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป ยังไม่ได้ทำอะไร' } };

  it('storageErrorFrom คืน AccountChangedError มีรหัสและข้อความอังกฤษ', () => {
    const e = storageErrorFrom({ code: 'PT412', message: 'x' }) as Error & { code?: string };
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e.code).toBe('store.accountChanged');
    expect(e.message).toBe('บัญชีที่เข้าสู่ระบบเปลี่ยนไป คำสั่งนี้ยังไม่ได้บันทึก โหลดหน้าใหม่');
    expect(messageFor('store.accountChanged', {}, 'en')).toBe('The signed-in account has changed. This action was not saved. Reload the page.');
  });

  it('ทุกชนิดคำสั่งเขียนโยน AccountChangedError', async () => {
    const { repo } = setup((s) => (s.method === 'GET' || s.method === 'HEAD' ? { status: 200, body: [] } : changed));
    for (const call of [
      () => repo.saveFxRate({ accountId: 'a', date: '2026-11-01', rateMicro: 35_000_000 }),
      () => repo.addUsdCash({ id: 'u', name: 'สมมติ' }),
      () => repo.deleteAsset('s'),
      () => repo.patchSettings({ payDay: 5 }),
      () => repo.updateSettings(['payDay'], () => ({ payDay: 5 })),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(AccountChangedError);
    }
  });

  it('เพิ่มสินทรัพย์บาทแล้วบัญชีเปลี่ยนระหว่างสองคำสั่ง: แจ้งว่าทำไม่ครบ', async () => {
    const { repo } = setup((s) => (s.path === 'accounts' && s.method === 'POST' ? { status: 201, body: [] } : changed));
    await expect(repo.addAsset({ id: 's', name: 'สมมติ', kind: 'fund' })).rejects.toMatchObject({ code: 'store.accountChangedPartly' });
  });

  it('เพิ่มหุ้นแล้วบัญชีเปลี่ยนระหว่างสองคำสั่ง: ไม่อ้างว่ายังไม่ได้บันทึกอะไรเลย', async () => {
    const { repo } = setup((s) => (s.path === 'accounts' && s.method === 'POST' ? { status: 201, body: [] } : changed));
    const e = await repo.addUsdStock({ id: 's', name: 'สมมติ', ticker: 'ABC', exchange: 'NASDAQ' }).then(() => null, (x: unknown) => x as Error & { code?: string });
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.code).toBe('store.accountChangedPartly');
    expect(e?.message).not.toMatch(/ยังไม่ได้บันทึก/);
  });
});
