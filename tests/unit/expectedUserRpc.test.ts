import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { deleteMyAccount, type RpcApi } from '../../src/app/account';
import { buildInitialLedger } from '../../src/app/setup';
import type { BackupData } from '../../src/domain/backup/parseBackup';
import { emptyInvestments } from '../../src/domain/invest/types';
import { AccountChangedError, InvestmentImportError } from '../../src/storage/ledgerRepository';
import { createSupabaseRepository } from '../../src/storage/supabaseRepository';

/**
 * เว็บต้องเรียกตัวห่อ <ชื่อ>_as พร้อม p_expected_user (migration 20261128000100) เพื่อให้ฐานข้อมูลตรวจบัญชีในธุรกรรมเดียวกับการเขียน
 * PT412 = บัญชีเปลี่ยน ฐานข้อมูลยังไม่ได้ทำอะไรในคำสั่งนั้น
 */
interface Call {
  name: string;
  args: Record<string, unknown>;
}
type Answer = { data?: unknown; error?: { message: string; code?: string } };

function client(respond: (call: Call) => Answer) {
  const calls: Call[] = [];
  const value = {
    auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'me' } } } }) },
    rpc: (name: string, args: Record<string, unknown>) => {
      const call = { name, args };
      calls.push(call);
      const r = respond(call);
      const answer = Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      return Object.assign(answer, { setHeader: () => answer }); // หัวคำขอ x-expected-user ตรวจใน expectedUserHeader.test.ts
    },
  };
  return { client: value as unknown as SupabaseClient, calls };
}

const changed: Answer = { error: { message: 'บัญชีที่เข้าสู่ระบบเปลี่ยนไป ยังไม่ได้ทำอะไร', code: 'PT412' } };
const accounts = [
  { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
  { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
];
const file = (n: number, withInvest = false): BackupData => ({
  accounts,
  entries: Array.from({ length: n }, (_, i) => ({ id: 'e' + i, date: '2026-11-01', memo: '', source: 'manual' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] })),
  bills: [],
  settings: {},
  ...(withInvest ? { investments: { ...emptyInvestments(), assets: [{ id: 's', name: 'สมมติ', kind: 'fund' as const, accountId: 'a' }] } } : {}),
});
const ok = (call: Call): Answer => {
  if (call.name === 'import_ledger_begin_as') return { data: { accounts: 2, bills: 0, entries: (call.args.p_data as { entries: unknown[] }).entries.length } };
  if (call.name === 'import_ledger_append_as') return { data: { entries: (call.args.p_entries as unknown[]).length } };
  return { data: 'done' };
};
const repo = (c: SupabaseClient) => createSupabaseRepository(c, 'me', { getPasswordForReset: async () => 'pw' });
const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as Error);

describe('ทุกคำสั่งตั้งต้น นำเข้า และล้าง ส่ง p_expected_user ไปกับตัวห่อ _as', () => {
  it('ตั้งต้นสมุด', async () => {
    const { client: c, calls } = client(ok);
    await repo(c).saveInitialLedger(buildInitialLedger([{ name: 'เงินสด', opening: '1' }], '2026-11-01'));
    expect(calls.map((x) => [x.name, x.args.p_expected_user])).toEqual([['setup_ledger_as', 'me']]);
  });

  it('นำเข้าคำสั่งเดียว + ข้อมูลลงทุน', async () => {
    const { client: c, calls } = client(ok);
    await repo(c).importBackup(file(2, true));
    expect(calls.map((x) => [x.name, x.args.p_expected_user])).toEqual([['import_ledger_as', 'me'], ['import_ledger_investments_as', 'me']]);
  });

  it('นำเข้าข้อมูลลงทุนแบบแทนหมวดเดิม', async () => {
    const { client: c, calls } = client(ok);
    await repo(c).importBackup(file(2, true), undefined, { replaceCategories: 3 });
    expect(calls.at(-1)).toMatchObject({ name: 'import_ledger_investments_replacing_categories_as', args: { p_expected_user: 'me', p_expected_categories: 3 } });
  });

  it('นำเข้าแบ่งก้อน แล้วล้างเมื่อก้อนล้ม', async () => {
    const { client: c, calls } = client((x) => (x.name === 'import_ledger_append_as' ? { error: { message: 'ล้ม', code: '55000' } } : ok(x)));
    await caught(repo(c).importBackup(file(1600)));
    expect(calls.map((x) => [x.name, x.args.p_expected_user])).toEqual([['import_ledger_begin_as', 'me'], ['import_ledger_append_as', 'me'], ['import_ledger_abort_as', 'me']]);
  });

  it('ล้างข้อมูลทั้งหมด', async () => {
    const { client: c, calls } = client(ok);
    await repo(c).resetAll();
    expect(calls).toEqual([{ name: 'reset_my_ledger_step_as', args: { p_expected_user: 'me', p_password: 'pw' } }]);
  });
});

describe('ฐานข้อมูลตอบ PT412 = บัญชีเปลี่ยน (AccountChangedError) ไม่ใช่ข้อผิดพลาดทั่วไป', () => {
  it('ตั้งต้นสมุด และนำเข้าคำสั่งเดียว: บอกว่ายังไม่ได้บันทึก/นำเข้า', async () => {
    const { client: c } = client(() => changed);
    const setup = await caught(repo(c).saveInitialLedger(buildInitialLedger([{ name: 'เงินสด', opening: '1' }], '2026-11-01')));
    expect(setup).toBeInstanceOf(AccountChangedError);
    expect(setup?.message).toMatch(/ยังไม่ได้บันทึก/);
    const single = await caught(repo(c).importBackup(file(2)));
    expect(single).toBeInstanceOf(AccountChangedError);
    expect(single?.message).toMatch(/ยังไม่ได้นำเข้า/);
  });

  it('begin: ยังไม่ได้นำเข้า ไม่สั่งล้าง', async () => {
    const { client: c, calls } = client(() => changed);
    const e = await caught(repo(c).importBackup(file(1600)));
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.message).toMatch(/ยังไม่ได้นำเข้า/);
    expect(calls.map((x) => x.name)).toEqual(['import_ledger_begin_as']);
  });

  it('append กลางทาง: บอกว่าหยุดกลางทางและให้กลับบัญชีเดิม · ไม่สั่งล้าง', async () => {
    const { client: c, calls } = client((x) => (x.name === 'import_ledger_append_as' ? changed : ok(x)));
    const e = await caught(repo(c).importBackup(file(1600)));
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.message).toMatch(/หยุดกลางทาง/);
    expect(calls.map((x) => x.name)).toEqual(['import_ledger_begin_as', 'import_ledger_append_as']);
  });

  it('ล้างส่วนค้างหลังก้อนล้มแล้วเจอ PT412: ยังบอกว่าหยุดกลางทาง ไม่บอกว่าล้างแล้ว', async () => {
    const { client: c } = client((x) => (x.name === 'import_ledger_append_as' ? { error: { message: 'ล้ม', code: '55000' } } : x.name === 'import_ledger_abort_as' ? changed : ok(x)));
    const e = await caught(repo(c).importBackup(file(1600)));
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.message).toMatch(/หยุดกลางทาง/);
    expect(e?.message).not.toMatch(/ล้างส่วนที่นำเข้าค้างให้แล้ว/);
  });

  it('สั่งล้างส่วนค้างเอง', async () => {
    const { client: c } = client(() => changed);
    const e = await caught(repo(c).abortUnfinishedImport());
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.message).toMatch(/หยุดล้าง/);
  });

  it('สั่งล้างส่วนค้างเองแล้วบัญชีเปลี่ยนหลังล้างไปบางชุด: บอกว่าอาจล้างไปแล้วบางส่วน', async () => {
    let n = 0;
    const { client: c } = client(() => (++n === 1 ? { data: 'more' } : changed));
    const e = await caught(repo(c).abortUnfinishedImport());
    expect(e).toBeInstanceOf(AccountChangedError);
    expect(e?.message).toMatch(/บางส่วน/);
  });

  it.each([
    ['ข้อมูลลงทุน', true, 0],
    ['แทนหมวดเดิม', true, 2],
    ['ลบหมวดเดิมอย่างเดียว', false, 2],
  ])('ขั้น%s: InvestmentImportError not_saved บอกว่าบัญชีเปลี่ยน ไม่โทษการเชื่อมต่อหรือให้แจ้งผู้ดูแล', async (_label, withInvest, replaceCategories) => {
    const { client: c } = client((x) => (x.name.startsWith('import_ledger_investments') ? changed : ok(x)));
    const e = await caught(repo(c).importBackup(file(2, withInvest), undefined, replaceCategories ? { replaceCategories } : undefined));
    expect(e).toBeInstanceOf(InvestmentImportError);
    expect((e as InvestmentImportError).outcome).toBe('not_saved');
    expect(e?.message).toMatch(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป/);
    expect(e?.message).not.toMatch(/ผู้ดูแล|การเชื่อมต่อ/);
  });

  it('ล้างข้อมูล: ชุดแรก = ยังไม่ได้ล้าง · ชุดหลัง = อาจล้างไปแล้วบางส่วน', async () => {
    const first = await caught(repo(client(() => changed).client).resetAll());
    expect(first).toBeInstanceOf(AccountChangedError);
    expect(first?.message).toMatch(/ยังไม่ได้ล้าง/);
    let n = 0;
    const later = await caught(repo(client(() => (++n === 1 ? { data: 'more' } : changed)).client).resetAll());
    expect(later).toBeInstanceOf(AccountChangedError);
    expect(later?.message).toMatch(/บางส่วน/);
  });
});

describe('ลบบัญชี: เรียก delete_my_account_step_as พร้อมผู้ใช้ของหน้าจอ', () => {
  const api = (answers: Answer[]) => {
    const calls: Call[] = [];
    const value: RpcApi = {
      rpc: (name, args) => {
        calls.push({ name, args: args ?? {} });
        const r = answers.shift() ?? { data: 'done' };
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      },
    };
    return { value, calls };
  };

  it('ส่ง p_expected_user กับรหัสผ่านทุกชุด', async () => {
    const { value, calls } = api([{ data: 'more' }, { data: 'done' }]);
    expect(await deleteMyAccount(value, 'me', 'pw')).toEqual({ ok: true });
    const expected = { name: 'delete_my_account_step_as', args: { p_expected_user: 'me', p_password: 'pw' } };
    expect(calls).toEqual([expected, expected]);
  });

  it('PT412 ชุดแรก = ยังไม่ได้ลบ · ชุดหลัง = อาจลบไปแล้วบางส่วน · หยุดทันที', async () => {
    const first = await deleteMyAccount(api([changed]).value, 'me', 'pw');
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.message).toMatch(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป.*ยังไม่ได้ลบ/);
    const mid = api([{ data: 'more' }, changed]);
    const later = await deleteMyAccount(mid.value, 'me', 'pw');
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.message).toMatch(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป.*บางส่วน/);
    expect(mid.calls).toHaveLength(2);
  });

  it('ไม่มีรหัสผู้ใช้ = ไม่ยิงเซิร์ฟเวอร์', async () => {
    const { value, calls } = api([]);
    expect((await deleteMyAccount(value, '', 'pw')).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
