import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  createSupabaseRepository,
  entryToJson,
  rowToBill,
  rowToEntry,
  storageErrorFrom,
  type BillRow,
  type EntryRow,
} from '../../src/storage/supabaseRepository';
import { AccountChangedError, ImportUnconfirmedError, InvestmentImportError } from '../../src/storage/ledgerRepository';
import { StorageError } from '../../src/storage/repository';

/** client จำลอง: บันทึกทุกคำสั่งที่ส่งออกไป และตอบตามที่เทสต์กำหนด (ไม่ต้องมีฐานข้อมูลจริง) */
interface Call {
  kind: 'from' | 'rpc';
  name: string;
  ops: string[];
  args?: unknown;
}
type Responder = (call: Call) => { data?: unknown; error?: { message?: string; code?: string } | null; count?: number };

/** sessionUsers = ผู้ใช้ของเซสชันในการถามแต่ละครั้ง (ตัวสุดท้ายใช้ต่อไปเรื่อยๆ · null = ออกจากระบบ) */
function fakeClient(respond: Responder, sessionUsers: (string | null)[] = ['u']) {
  const calls: Call[] = [];
  let asked = 0;
  const builder = (call: Call) => {
    const proxy: Record<string, unknown> = {};
    const chain = (op: string) => (...args: unknown[]) => {
      call.ops.push(op);
      if (op === 'insert' || op === 'update' || op === 'upsert') call.args = args[0];
      return proxy;
    };
    for (const op of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'order', 'range', 'limit', 'maybeSingle']) proxy[op] = chain(op);
    proxy.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      const r = respond(call);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }).then(resolve, reject);
    };
    return proxy;
  };
  const client = {
    auth: {
      getSession: () => {
        const id = sessionUsers[Math.min(asked++, sessionUsers.length - 1)] ?? null;
        return Promise.resolve({ data: { session: id === null ? null : { user: { id } } } });
      },
    },
    from: (name: string) => {
      const call: Call = { kind: 'from', name, ops: [] };
      calls.push(call);
      return builder(call);
    },
    rpc: (name: string, args: unknown) => {
      const call: Call = { kind: 'rpc', name, ops: [], args };
      calls.push(call);
      return builder(call);
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const accountRows = [
  { id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB', archived: false, sort_order: 1 },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB', archived: false, sort_order: null },
];
const billRow: BillRow = {
  id: 'b1', name: 'ค่าเน็ต', amount: 59_900, due_day: 5, wallet_id: 'w1', category_id: 'food',
  last_paid_month: null, start_month: '2026-11', archived: false,
};

describe('แปลงแถวฐานข้อมูล <-> โดเมน', () => {
  const row: EntryRow = {
    id: 'e1', date: '2026-11-02', memo: 'ข้าว', source: 'manual', group_id: null,
    created_at: '2026-11-02T03:04:05.678+00:00', bill_id: null, bill_cycle: null, bill_before: null,
    lines: [{ idx: 2, account_id: 'w1', amount: '-500' }, { idx: 1, account_id: 'food', amount: 500 }],
  };
  it('เรียงบรรทัดตาม idx · amount เป็นจำนวนเต็ม · เวลาเป็น ISO มิลลิวินาที · ไม่มีฟิลด์ว่าง', () => {
    const e = rowToEntry(row);
    expect(e.lines).toEqual([{ accountId: 'food', amount: 500 }, { accountId: 'w1', amount: -500 }]);
    expect(e.createdAt).toBe('2026-11-02T03:04:05.678Z');
    expect('groupId' in e).toBe(false);
    expect('bill' in e).toBe(false);
  });
  it('ผูกบิล: before มีเมื่อมีค่าเท่านั้น', () => {
    expect(rowToEntry({ ...row, bill_id: 'b', bill_cycle: '2026-11' }).bill).toEqual({ id: 'b', cycle: '2026-11' });
    expect(rowToEntry({ ...row, bill_id: 'b', bill_cycle: '2026-11', bill_before: '2026-10' }).bill).toEqual({ id: 'b', cycle: '2026-11', before: '2026-10' });
  });
  it('จำนวนเงินที่ไม่ใช่จำนวนเต็มปลอดภัย (ข้อมูลเสีย) ถูกปฏิเสธ ไม่ปัดเงียบๆ (R1)', () => {
    for (const bad of [1.5, '9007199254740993', 'abc', null]) {
      expect(() => rowToEntry({ ...row, lines: [{ idx: 1, account_id: 'w1', amount: bad as unknown as number }] })).toThrow(StorageError);
    }
    expect(rowToEntry({ ...row, lines: [{ idx: 1, account_id: 'w1', amount: '9007199254740991' }] }).lines[0]?.amount).toBe(Number.MAX_SAFE_INTEGER);
  });
  it('entryToJson ส่งเฉพาะฟิลด์ที่ RPC รู้จัก', () => {
    const json = entryToJson({ id: 'e', date: '2026-11-01', memo: 'm', source: 'recurring', createdAt: 'x', bill: { id: 'b', cycle: '2026-11' }, lines: [{ accountId: 'a', amount: 1 }] });
    expect(json).toEqual({ id: 'e', date: '2026-11-01', memo: 'm', source: 'recurring', createdAt: 'x', bill: { id: 'b', cycle: '2026-11' }, lines: [{ accountId: 'a', amount: 1 }] });
  });
  it('บิล: ฟิลด์ว่างไม่ถูกใส่ · archived เฉพาะที่จริง', () => {
    expect(rowToBill(billRow)).toEqual({ id: 'b1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, walletId: 'w1', categoryId: 'food', startMonth: '2026-11' });
    expect(rowToBill({ ...billRow, archived: true, last_paid_month: '2026-10' })).toMatchObject({ archived: true, lastPaidMonth: '2026-10' });
  });
});

describe('storageErrorFrom (ไม่รั่วรายละเอียดภายใน)', () => {
  it('ข้อความไทยจากฐานข้อมูลใช้ได้เลย · อังกฤษ/ภายในแปลงเป็นข้อความทั่วไป', () => {
    expect(storageErrorFrom({ message: 'รอบนี้จ่ายแล้ว', code: '23514' }).message).toBe('รอบนี้จ่ายแล้ว');
    const dup = storageErrorFrom({ message: 'duplicate key value violates unique constraint "entries_pkey"', code: '23505' });
    expect(dup.message).not.toMatch(/entries_pkey|constraint/);
    expect(storageErrorFrom({ message: 'TypeError: Failed to fetch' }).message).toMatch(/เชื่อมต่อ/);
    expect(storageErrorFrom({ message: 'relation "public.secret" does not exist', code: '42P01' }).message).not.toMatch(/secret|relation/);
    expect(storageErrorFrom({ message: 'x' })).toBeInstanceOf(StorageError);
    // ข้อความ Postgres เองที่ปนค่าภาษาไทยที่ผู้ใช้กรอก ไม่ส่งต่อ
    expect(storageErrorFrom({ message: 'invalid input syntax for type integer: "สวัสดี"', code: '22P02' }).message).not.toMatch(/invalid|syntax/);
    expect(storageErrorFrom({ message: 'duplicate key value violates unique constraint "entries_bill_cycle_once_idx"', code: '23505' }).message).toMatch(/รอบนี้จ่ายแล้ว/);
  });
});

describe('ความเป็นอะตอมของบิล (R15) ผ่านฐานข้อมูล', () => {
  const responder: Responder = (call) => {
    if (call.kind === 'rpc') return { data: 'ok' };
    if (call.name === 'accounts') return { data: accountRows };
    if (call.name === 'bills') return { data: billRow };
    return { data: null };
  };

  it('จ่ายบิล = เรียก create_entry ครั้งเดียว ไม่เขียนตาราง bills/entries ตรงๆ (trigger ตั้ง lastPaidMonth ในธุรกรรมเดียวกัน)', async () => {
    const { client, calls } = fakeClient(responder);
    const repo = createSupabaseRepository(client, 'user-1');
    const result = await repo.payBill('b1', { today: '2026-11-04', entryId: 'pay-1' });
    expect(result.cycle).toBe('2026-11');
    const writes = calls.filter((c) => c.ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o)));
    expect(writes).toEqual([]);
    const rpcs = calls.filter((c) => c.kind === 'rpc');
    expect(rpcs.map((c) => c.name)).toEqual(['create_entry']);
    const sent = (rpcs[0]?.args as { p_entry: { source: string; bill: { id: string; cycle: string }; lines: { amount: number }[] } }).p_entry;
    expect(sent).toMatchObject({ source: 'recurring', bill: { id: 'b1', cycle: '2026-11' } });
    expect(sent.lines.map((l) => l.amount)).toEqual([59_900, -59_900]);
  });

  it('จ่ายล้มเหลว (ฐานข้อมูลปฏิเสธ) = โยน StorageError และไม่มีการเขียนอื่นตามมา', async () => {
    const { client, calls } = fakeClient((c) => (c.kind === 'rpc' ? { error: { message: 'รอบนี้จ่ายแล้ว', code: '23514' } } : responder(c)));
    const repo = createSupabaseRepository(client, 'user-1');
    await expect(repo.payBill('b1', { today: '2026-11-04', entryId: 'pay-1' })).rejects.toThrow('รอบนี้จ่ายแล้ว');
    expect(calls.filter((c) => c.ops.includes('update') || c.ops.includes('upsert'))).toEqual([]);
  });

  it('ไม่มีกระเป๋า/หมวด = ปฏิเสธก่อนส่งอะไรออกไป', async () => {
    const noWallet = { ...billRow, wallet_id: null };
    const { client, calls } = fakeClient((c) => (c.kind === 'from' && c.name === 'bills' ? { data: noWallet } : responder(c)));
    const repo = createSupabaseRepository(client, 'user-1');
    await expect(repo.payBill('b1', { today: '2026-11-04', entryId: 'p' })).rejects.toThrow(StorageError);
    expect(calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it('ยกเลิกการจ่าย = ลบรายการครั้งเดียว ไม่แก้ตาราง bills ตรงๆ (trigger คืน lastPaidMonth)', async () => {
    const paid = { ...billRow, last_paid_month: '2026-11' };
    const entryRow: EntryRow = {
      id: 'pay-1', date: '2026-11-04', memo: 'ค่าเน็ต', source: 'recurring', group_id: null, created_at: '2026-11-04T00:00:00Z',
      bill_id: 'b1', bill_cycle: '2026-11', bill_before: null,
      lines: [{ idx: 1, account_id: 'food', amount: 59_900 }, { idx: 2, account_id: 'w1', amount: -59_900 }],
    };
    const { client, calls } = fakeClient((c) => {
      if (c.kind === 'from' && c.name === 'entries') return c.ops.includes('delete') ? {} : { data: entryRow };
      if (c.kind === 'from' && c.name === 'bills') return { data: paid };
      return responder(c);
    });
    const repo = createSupabaseRepository(client, 'user-1');
    const out = await repo.cancelBillPayment('pay-1');
    expect(out.entry.id).toBe('pay-1');
    const writes = calls.filter((c) => c.ops.some((o) => ['insert', 'update', 'upsert', 'delete'].includes(o)));
    expect(writes.map((c) => `${c.name}:${c.ops.filter((o) => o === 'delete' || o === 'update').join()}`)).toEqual(['entries:delete']);
  });

  it('ยกเลิกรอบที่ไม่ใช่รอบล่าสุด = ปฏิเสธก่อนลบ', async () => {
    const later = { ...billRow, last_paid_month: '2026-12' };
    const entryRow: EntryRow = {
      id: 'pay-1', date: '2026-11-04', memo: 'x', source: 'recurring', group_id: null, created_at: '2026-11-04T00:00:00Z',
      bill_id: 'b1', bill_cycle: '2026-11', bill_before: null, lines: [],
    };
    const { client, calls } = fakeClient((c) => {
      if (c.kind === 'from' && c.name === 'entries') return { data: entryRow };
      if (c.kind === 'from' && c.name === 'bills') return { data: later };
      return responder(c);
    });
    const repo = createSupabaseRepository(client, 'user-1');
    await expect(repo.cancelBillPayment('pay-1')).rejects.toThrow(/รอบล่าสุด/);
    expect(calls.some((c) => c.ops.includes('delete'))).toBe(false);
  });
});

describe('อ่านครบจริง (pagination)', () => {
  it('แถวซ้ำข้ามหน้าถูกตัด · จำนวนไม่ตรง count = อ่านใหม่ แล้วปฏิเสธถ้ายังไม่ตรง', async () => {
    const acc = (id: string) => ({ id, type: 'asset', name: id, currency: 'THB', archived: false, sort_order: null });
    const dup = fakeClient((c) => {
      if (c.name !== 'accounts') return {};
      return c.ops.includes('range') ? { data: [acc('a'), acc('a'), acc('b')] } : { count: 2 };
    });
    const ledger = await createSupabaseRepository(dup.client, 'u').loadLedger();
    expect(ledger.accounts.map((a) => a.id).sort()).toEqual(['a', 'b']);
    const short = fakeClient((c) => (c.name !== 'accounts' ? {} : c.ops.includes('range') ? { data: [acc('a')] } : { count: 5 }));
    await expect(createSupabaseRepository(short.client, 'u').loadLedger()).rejects.toThrow(/ลองใหม่/);
  });
});

describe('นำเข้าไฟล์สำรอง', () => {
  const data = {
    accounts: [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ],
    entries: [{ id: 'e', date: '2026-11-01', memo: '', source: 'system' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] }],
    bills: [{ id: 'bill', name: 'x', amount: 5, dueDay: 1, lastPaidMonth: '2026-11' }],
    settings: { payDay: 3 },
  };
  it('เรียก import_ledger ครั้งเดียว ส่งครบทุกส่วน ไม่เขียนตารางตรงๆ', async () => {
    const { client, calls } = fakeClient(() => ({ data: { accounts: 2, bills: 1, entries: 1 } }));
    const out = await createSupabaseRepository(client, 'u').importBackup(data);
    expect(out).toEqual({ accounts: 2, entries: 1, bills: 1 });
    expect(calls.map((c) => c.kind + ':' + c.name)).toEqual(['rpc:import_ledger']);
    const sent = (calls[0]?.args as { p_data: { accounts: unknown[]; entries: unknown[]; bills: { lastPaidMonth?: string }[]; settings: unknown } }).p_data;
    expect(sent.accounts).toHaveLength(2);
    expect(sent.entries).toHaveLength(1);
    expect(sent.bills[0]?.lastPaidMonth).toBe('2026-11');
    expect(sent.settings).toEqual({ payDay: 3 });
  });
  it('ข้อมูลไม่สมดุลถูกปฏิเสธก่อนส่ง · เซิร์ฟเวอร์ปฏิเสธ (มีข้อมูลอยู่แล้ว) = StorageError ข้อความไทย', async () => {
    const none = fakeClient(() => ({}));
    const bad = { ...data, entries: [{ ...data.entries[0]!, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -9 }] }] };
    await expect(createSupabaseRepository(none.client, 'u').importBackup(bad)).rejects.toThrow(StorageError);
    expect(none.calls).toHaveLength(0);
    const exists = fakeClient(() => ({ error: { message: 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)', code: '23505' } }));
    await expect(createSupabaseRepository(exists.client, 'u').importBackup(data)).rejects.toThrow(/มีข้อมูลอยู่แล้ว/);
  });
});

describe('นำเข้าแบบแบ่งก้อน (เกิน 1,500 รายการ)', () => {
  const accounts = [
    { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
    { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
  ];
  const many = (n: number) => ({
    accounts,
    entries: Array.from({ length: n }, (_, i) => ({ id: 'e' + i, date: '2026-11-01', memo: '', source: 'manual' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] })),
    bills: [{ id: 'bill', name: 'x', amount: 5, dueDay: 1 }],
    settings: { payDay: 3 },
  });
  type Args = { p_data?: { accounts: unknown[]; bills: unknown[]; entries: { id: string }[]; settings: unknown }; p_total_entries?: number; p_entries?: { id: string }[] };
  const ok = (call: { name: string; args?: unknown }) => {
    const a = (call.args ?? {}) as Args;
    if (call.name === 'import_ledger_begin') return { data: { accounts: 2, bills: 1, entries: a.p_data?.entries.length ?? 0, done: false } };
    if (call.name === 'import_ledger_append') return { data: { entries: a.p_entries?.length ?? 0, done: false } };
    if (call.name === 'import_ledger_abort') return { data: 'done' };
    return { data: true };
  };

  it('1,600 รายการ: begin ครั้งเดียว (บัญชี บิล ตั้งค่า + ก้อนแรก + จำนวนรวม) แล้ว append ก้อนละไม่เกิน 500 · ทุกรายการถูกส่งครั้งเดียวตามลำดับ', async () => {
    const { client, calls } = fakeClient(ok);
    const progress: [number, number][] = [];
    const out = await createSupabaseRepository(client, 'u').importBackup(many(1600), (done, total) => progress.push([done, total]));
    expect(out).toEqual({ accounts: 2, entries: 1600, bills: 1 });
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_begin', 'import_ledger_append', 'import_ledger_append', 'import_ledger_append']);
    const begin = calls[0]!.args as Args;
    expect(begin.p_total_entries).toBe(1600);
    expect(begin.p_data!.accounts).toHaveLength(2);
    expect(begin.p_data!.bills).toHaveLength(1);
    expect(begin.p_data!.settings).toEqual({ payDay: 3 });
    const sent = [...begin.p_data!.entries, ...calls.slice(1).flatMap((c) => (c.args as Args).p_entries!)];
    expect(sent.map((e) => e.id)).toEqual(Array.from({ length: 1600 }, (_, i) => 'e' + i));
    expect(Math.max(...calls.map((c) => (c.args as Args).p_entries?.length ?? (c.args as Args).p_data!.entries.length))).toBeLessThanOrEqual(500);
    expect(progress.at(-1)).toEqual([1600, 1600]);
    expect(progress.map((p) => p[0])).toEqual([...progress.map((p) => p[0])].sort((a, b) => a - b));
  });

  it('ไม่เกิน 1,500 รายการ: ยังใช้ import_ledger คำสั่งเดียวเหมือนเดิม (อะตอมมิก)', async () => {
    const { client, calls } = fakeClient(() => ({ data: { accounts: 2, bills: 1, entries: 1500 } }));
    await createSupabaseRepository(client, 'u').importBackup(many(1500));
    expect(calls.map((c) => c.name)).toEqual(['import_ledger']);
  });

  it('รายการไม่ถึง 1,500 แต่บรรทัดรวมเกิน 20,000 ต่อคำสั่ง: ต้องแบ่งก้อนด้วย (ไม่ให้ import_ledger คำสั่งเดียวถูกปฏิเสธ) และแต่ละก้อนไม่เกิน 20,000 บรรทัด', async () => {
    const wide = many(1000);
    wide.entries = wide.entries.map((e) => ({ ...e, lines: Array.from({ length: 30 }, (_, j) => ({ accountId: j % 2 ? 'b' : 'a', amount: j % 2 ? -1 : 1 })) }));
    const { client, calls } = fakeClient(ok);
    await createSupabaseRepository(client, 'u').importBackup(wide);
    expect(calls[0]!.name).toBe('import_ledger_begin');
    expect(calls.length).toBeGreaterThan(1);
    for (const c of calls) {
      const list = (c.args as Args).p_entries ?? (c.args as Args).p_data!.entries;
      expect((list as unknown as { lines: unknown[] }[]).reduce((n, e) => n + e.lines.length, 0)).toBeLessThanOrEqual(20_000);
    }
  });

  it('ก้อนกลางทางล้ม: สั่งล้างส่วนที่นำเข้าค้างทันที 1 ครั้ง แล้วแจ้งว่าล้างให้แล้ว (ไม่ส่งก้อนต่อ)', async () => {
    let appends = 0;
    const { client, calls } = fakeClient((call) => {
      if (call.name === 'import_ledger_append' && ++appends === 2) return { error: { message: 'ล้มกลางทาง' } };
      return ok(call);
    });
    await expect(createSupabaseRepository(client, 'u').importBackup(many(1600))).rejects.toThrow(/ล้างส่วนที่นำเข้าค้างให้แล้ว/);
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_begin', 'import_ledger_append', 'import_ledger_append', 'import_ledger_abort']);
  });

  it('ล้างส่วนค้างไม่สำเร็จด้วย: แจ้งให้เปิดแอปใหม่ (แอปจะพาไปหน้าล้าง) ไม่บอกว่าล้างแล้ว', async () => {
    const { client } = fakeClient((call) => {
      if (call.name === 'import_ledger_append' || call.name === 'import_ledger_abort') return { error: { message: 'ล้ม' } };
      return ok(call);
    });
    const err = await createSupabaseRepository(client, 'u').importBackup(many(1600)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect((err as Error).message).toMatch(/เปิดแอปใหม่/);
    expect((err as Error).message).not.toMatch(/ล้างส่วนที่นำเข้าค้างให้แล้ว/);
  });

  it('คำตอบก้อนสุดท้ายหายหลังบันทึก (abort ตอบ none): ห้ามบอกว่าล้างให้แล้ว · บอกให้ตรวจยอด', async () => {
    let appends = 0;
    const { client, calls } = fakeClient((call) => {
      if (call.name === 'import_ledger_append' && ++appends === 3) return { error: { message: 'TypeError: Failed to fetch', code: '' } };
      if (call.name === 'import_ledger_abort') return { data: 'none' };
      return ok(call);
    });
    const message = ((await createSupabaseRepository(client, 'u').importBackup(many(1600)).catch((e: unknown) => e)) as Error).message;
    expect(message).toMatch(/ยืนยันผลไม่ได้/);
    expect(message).toMatch(/ตรวจยอด/);
    expect(message).not.toMatch(/ล้างส่วนที่นำเข้าค้างให้แล้ว|ลองนำเข้าใหม่ได้|Failed to fetch/);
    expect(message).not.toMatch(/ข้อมูลลงทุน/);
    await expect(createSupabaseRepository(fakeClient((c) => (c.name === 'import_ledger_abort' ? { data: 'none' } : c.name === 'import_ledger_append' ? { error: { message: 'x' } } : ok(c))).client, 'u').importBackup(many(1600))).rejects.toBeInstanceOf(ImportUnconfirmedError);
    expect(calls.at(-1)!.name).toBe('import_ledger_abort');
  });

  it('เหมือนข้างบนและไฟล์มีข้อมูลลงทุน: บอกว่าส่วนลงทุนยังไม่ได้นำเข้า (ยังไม่ได้เรียกเลย)', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.name === 'import_ledger_append') return { error: { message: 'x', code: '' } };
      if (call.name === 'import_ledger_abort') return { data: 'none' };
      return ok(call);
    });
    const data = { ...many(1600), investments: { assets: [{ id: 's', name: 'สมมติ', kind: 'fund' as const, accountId: 'a' }], trades: [], prices: [] } };
    await expect(createSupabaseRepository(client, 'u').importBackup(data)).rejects.toThrow(/ข้อมูลลงทุนยังไม่ได้นำเข้า/);
    expect(calls.some((c) => c.name.startsWith('import_ledger_investments'))).toBe(false);
  });

  it('ล้างเป็นชุด (more แล้ว done) ยังบอกว่าล้างให้แล้ว', async () => {
    const answers = ['more', 'done'];
    const { client } = fakeClient((call) => {
      if (call.name === 'import_ledger_append') return { error: { message: 'ล้ม' } };
      if (call.name === 'import_ledger_abort') return { data: answers.shift() };
      return ok(call);
    });
    const e = await createSupabaseRepository(client, 'u').importBackup(many(1600)).catch((x: unknown) => x);
    expect((e as Error).message).toMatch(/ล้างส่วนที่นำเข้าค้างให้แล้ว/);
    expect(e).not.toBeInstanceOf(ImportUnconfirmedError);
  });

  it('begin ถูกปฏิเสธ (เช่นมีข้อมูลอยู่แล้ว): ไม่สั่งล้าง เพราะยังไม่ได้เปิดเซสชัน ข้อมูลเดิมต้องไม่ถูกแตะ', async () => {
    const { client, calls } = fakeClient((call) => (call.name === 'import_ledger_begin' ? { error: { message: 'มีข้อมูลอยู่แล้ว นำเข้าไม่ได้ (ไม่ทับข้อมูลเดิม)', code: '23505' } } : ok(call)));
    await expect(createSupabaseRepository(client, 'u').importBackup(many(1600))).rejects.toThrow(/มีข้อมูลอยู่แล้ว/);
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_begin']);
  });

  it('ข้อมูลไม่สมดุลถูกปฏิเสธก่อนส่งแม้เป็นไฟล์ใหญ่ (ไม่เปิดเซสชันเลย)', async () => {
    const data = many(1600);
    data.entries[1599] = { ...data.entries[1599]!, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -9 }] };
    const { client, calls } = fakeClient(ok);
    await expect(createSupabaseRepository(client, 'u').importBackup(data)).rejects.toThrow(StorageError);
    expect(calls).toHaveLength(0);
  });

  it('ล้างส่วนค้างเป็นชุด: ได้ more ก็เรียกซ้ำจนได้ done (ไม่เกินเพดานเวลาต่อคำสั่ง)', async () => {
    const answers = ['more', 'more', 'done'];
    const { client, calls } = fakeClient(() => ({ data: answers.shift() }));
    await createSupabaseRepository(client, 'u').abortUnfinishedImport();
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_abort', 'import_ledger_abort', 'import_ledger_abort']);
  });

  it('ล้างส่วนค้างไม่มีวันจบ (more ตลอด) ต้องหยุดและแจ้งผิดพลาด ไม่วนไม่รู้จบ', async () => {
    const { client, calls } = fakeClient(() => ({ data: 'more' }));
    await expect(createSupabaseRepository(client, 'u').abortUnfinishedImport()).rejects.toThrow(StorageError);
    expect(calls.length).toBeLessThanOrEqual(200);
  });

  it('ไม่มีเซสชัน (none) = ไม่ทำอะไรต่อ', async () => {
    const { client, calls } = fakeClient(() => ({ data: 'none' }));
    await createSupabaseRepository(client, 'u').abortUnfinishedImport();
    expect(calls).toHaveLength(1);
  });

  it('hasUnfinishedImport / abortUnfinishedImport เรียก RPC ของตัวเองเท่านั้น', async () => {
    const { client, calls } = fakeClient((call) => ({ data: call.name === 'import_ledger_status' ? true : 'done' }));
    const repo = createSupabaseRepository(client, 'u');
    expect(await repo.hasUnfinishedImport()).toBe(true);
    await repo.abortUnfinishedImport();
    expect(calls.map((c) => c.kind + ':' + c.name)).toEqual(['rpc:import_ledger_status', 'rpc:import_ledger_abort']);
  });
});

describe('การป้องกันอื่น', () => {
  it('ไม่มี userId = สร้าง repository ไม่ได้', () => {
    const { client } = fakeClient(() => ({}));
    expect(() => createSupabaseRepository(client, '')).toThrow(StorageError);
  });
  it('ค่าตั้งค่าผิดรูปถูกปฏิเสธก่อนส่ง', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const repo = createSupabaseRepository(client, 'u');
    await expect(repo.saveSettings({ payDay: 99 })).rejects.toThrow(StorageError);
    expect(calls).toHaveLength(0);
  });
  it('ล้างข้อมูลทั้งหมด: เรียกเฉพาะ reset_my_ledger_step พร้อมรหัสผ่าน (ไม่ลบทีละตารางเอง)', async () => {
    const { client, calls } = fakeClient(() => ({ data: 'done' }));
    await createSupabaseRepository(client, 'u', { getPasswordForReset: async () => 'pw-1' }).resetAll();
    expect(calls.map((c) => c.kind + ':' + c.name)).toEqual(['rpc:reset_my_ledger_step']);
    expect(calls[0]?.args).toEqual({ p_password: 'pw-1' });
  });
  it('ล้างข้อมูลเป็นชุด: more, more, done → เรียก 3 ครั้งด้วยรหัสเดิม ถามรหัสผ่านครั้งเดียว', async () => {
    const answers = ['more', 'more', 'done'];
    const { client, calls } = fakeClient(() => ({ data: answers.shift() }));
    let asked = 0;
    await createSupabaseRepository(client, 'u', { getPasswordForReset: async () => { asked += 1; return 'pw-1'; } }).resetAll();
    expect(calls.map((c) => c.name)).toEqual(['reset_my_ledger_step', 'reset_my_ledger_step', 'reset_my_ledger_step']);
    expect(calls.every((c) => JSON.stringify(c.args) === JSON.stringify({ p_password: 'pw-1' }))).toBe(true);
    expect(asked).toBe(1);
  });
  it('ล้างข้อมูลเป็นชุด: ชุดกลางทางล้ม/รหัสถูกเปลี่ยนกลางทาง = หยุดทันที ไม่เรียกต่อ · ไม่จบ (more ตลอด) หยุดที่ 200 ชุด · ค่าแปลก = ผิดพลาด', async () => {
    const answers: unknown[] = ['more', 'wrong'];
    const mid = fakeClient(() => ({ data: answers.shift() }));
    await expect(createSupabaseRepository(mid.client, 'u', { getPasswordForReset: async () => 'x' }).resetAll()).rejects.toThrow(/รหัสผ่าน/);
    expect(mid.calls).toHaveLength(2);
    const err = fakeClient(() => ({ data: 'more' }));
    await expect(createSupabaseRepository(err.client, 'u', { getPasswordForReset: async () => 'x' }).resetAll()).rejects.toThrow(StorageError);
    expect(err.calls.length).toBeLessThanOrEqual(200);
    for (const data of [true, false, null, 'oops', 1]) {
      const odd = fakeClient(() => ({ data }));
      await expect(createSupabaseRepository(odd.client, 'u', { getPasswordForReset: async () => 'x' }).resetAll(), String(data)).rejects.toThrow(StorageError);
      expect(odd.calls).toHaveLength(1);
    }
  });
  it('ล้างข้อมูล: ไม่มีช่องรหัสผ่าน = ล้างไม่ได้ · รหัสผิด (false) = ปฏิเสธ', async () => {
    const none = fakeClient(() => ({ data: true }));
    await expect(createSupabaseRepository(none.client, 'u').resetAll()).rejects.toThrow(StorageError);
    expect(none.calls).toHaveLength(0);
    const wrong = fakeClient(() => ({ data: 'wrong' }));
    await expect(createSupabaseRepository(wrong.client, 'u', { getPasswordForReset: async () => 'x' }).resetAll()).rejects.toThrow(/รหัสผ่าน/);
  });
  it('ตั้งต้นที่ไม่สมดุลถูกปฏิเสธก่อนส่งไปเซิร์ฟเวอร์', async () => {
    const { client, calls } = fakeClient(() => ({}));
    const repo = createSupabaseRepository(client, 'u');
    const accounts = [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ];
    const bad = { id: 'e', date: '2026-11-01', memo: '', source: 'system' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -9 }] };
    await expect(repo.saveInitialLedger({ accounts, entries: [bad] })).rejects.toThrow(StorageError);
    expect(calls).toHaveLength(0);
  });
});

describe('saveCategories (R2 Categories): ตรวจก่อนส่ง แล้วเรียก RPC เดียว', () => {
  const cats = [
    { id: 'c1', name: 'Tech', targetBps: 6000, sortOrder: 1 },
    { id: 'c2', name: 'Funds', targetBps: 4000, sortOrder: 2 },
  ];
  it('ส่ง save_categories ครั้งเดียว: หมวดทั้งชุด + การจัดหมวดเฉพาะ key ที่ใส่ (null = ล้าง) · เป้าที่ไม่ตั้งไม่ส่งคีย์', async () => {
    const { client, calls } = fakeClient(() => ({ data: { categories: 2, assignments: 2 } }));
    const repo = createSupabaseRepository(client, 'u');
    await repo.saveCategories(cats, [{ assetId: 'a1', categoryId: 'c1', sector: 'Utilities' }, { assetId: 'a2', categoryId: null }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('rpc');
    expect(calls[0]!.name).toBe('save_categories');
    expect(calls[0]!.args).toEqual({
      p_categories: [
        { id: 'c1', name: 'Tech', sortOrder: 1, targetBps: 6000 },
        { id: 'c2', name: 'Funds', sortOrder: 2, targetBps: 4000 },
      ],
      p_assignments: [{ assetId: 'a1', categoryId: 'c1', sector: 'Utilities' }, { assetId: 'a2', categoryId: null }],
    });
    const none = fakeClient(() => ({ data: {} }));
    await createSupabaseRepository(none.client, 'u').saveCategories([{ id: 'c', name: 'X', targetBps: null, sortOrder: 0 }], []);
    expect((none.calls[0]!.args as { p_categories: unknown[] }).p_categories).toEqual([{ id: 'c', name: 'X', sortOrder: 0 }]);
  });
  it('ข้อมูลผิดกติกา (เป้ารวมไม่ครบ · ชื่อซ้ำ · ชื่อมีช่องว่างนำหน้า) ถูกปฏิเสธก่อนส่ง ไม่เรียกเครือข่าย พร้อมรหัสข้อผิดพลาด', async () => {
    const { client, calls } = fakeClient(() => ({ data: {} }));
    const repo = createSupabaseRepository(client, 'u');
    const reason = async (c: typeof cats): Promise<string> => {
      try {
        await repo.saveCategories(c, []);
      } catch (e) {
        expect(e).toBeInstanceOf(StorageError);
        return String((e as { code?: string }).code);
      }
      return 'no-error';
    };
    expect(await reason([{ ...cats[0]!, targetBps: 5999 }, cats[1]!])).toBe('store.categoryTargetTotal');
    expect(await reason([cats[0]!, { ...cats[1]!, name: 'tech' }])).toBe('store.categoryDuplicateName');
    expect(await reason([{ ...cats[0]!, name: ' Tech' }, cats[1]!])).toBe('store.categoryName');
    expect(calls).toHaveLength(0);
  });
  it('ฐานข้อมูลปฏิเสธ (เช่น เป้ารวมผิดที่ฐานข้อมูล) = StorageError ไม่รั่วรายละเอียดภายใน', async () => {
    const { client } = fakeClient(() => ({ error: { message: 'internal detail user_id=secret', code: '23514' } }));
    const repo = createSupabaseRepository(client, 'u');
    await expect(repo.saveCategories(cats, [])).rejects.toThrow(StorageError);
    await expect(repo.saveCategories(cats, [])).rejects.not.toThrow(/secret/);
  });
});

describe('นำเข้าเมื่อมีหมวดเดิมค้าง (ผู้ใช้ยืนยันให้ลบแล้ว)', () => {
  const data = {
    accounts: [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ],
    entries: [{ id: 'e', date: '2026-11-01', memo: '', source: 'system' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] }],
    bills: [],
    settings: {},
  };
  const NEW_RPC = 'import_ledger_investments_replacing_categories';
  const okLedger = () => fakeClient(() => ({ data: { accounts: 2, bills: 0, entries: 1 } }));
  const failMessage = async (error: { message: string; code?: string }) => {
    const { client } = fakeClient((call) => (call.name === NEW_RPC ? { error } : { data: { accounts: 2, bills: 0, entries: 1 } }));
    const err = await createSupabaseRepository(client, 'u').importBackup(data, undefined, { replaceCategories: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    return (err as Error).message;
  };

  it('countCategories: นับจากตาราง asset_categories อย่างเดียว · อ่านไม่ได้ = StorageError (ไม่ถือว่าเป็น 0)', async () => {
    const { client, calls } = fakeClient(() => ({ count: 3 }));
    expect(await createSupabaseRepository(client, 'u').countCategories()).toBe(3);
    expect(calls.map((c) => c.kind + ':' + c.name)).toEqual(['from:asset_categories']);
    expect(calls[0]!.ops).toEqual(['select']);
    await expect(createSupabaseRepository(fakeClient(() => ({ error: { message: 'x' } })).client, 'u').countCategories()).rejects.toThrow(StorageError);
    await expect(createSupabaseRepository(fakeClient(() => ({})).client, 'u').countCategories()).rejects.toThrow(StorageError);
  });

  it('เรียก RPC ใหม่พร้อมจำนวนที่ผู้ใช้ยืนยัน แม้ไฟล์ไม่มีข้อมูลลงทุน · ไม่เรียกตัวเดิม', async () => {
    const { client, calls } = okLedger();
    await createSupabaseRepository(client, 'u').importBackup(data, undefined, { replaceCategories: 2 });
    expect(calls.map((c) => c.name)).toEqual(['import_ledger', NEW_RPC]);
    expect(calls[1]!.args).toEqual({ p_data: { assets: [], trades: [], prices: [] }, p_expected_categories: 2 });
  });

  it('จำนวนยืนยัน 0 หรือไม่ส่ง = ทางเดิมทุกอย่าง', async () => {
    for (const options of [undefined, { replaceCategories: 0 }]) {
      const { client, calls } = okLedger();
      await createSupabaseRepository(client, 'u').importBackup(data, undefined, options);
      expect(calls.map((c) => c.name)).toEqual(['import_ledger']);
    }
  });

  it('ไฟล์ใหญ่ (แบ่งก้อน): ขั้นสุดท้ายก็เป็น RPC ใหม่', async () => {
    const big = { ...data, entries: Array.from({ length: 1600 }, (_, i) => ({ ...data.entries[0]!, id: 'e' + i })) };
    const { client, calls } = fakeClient(() => ({ data: { entries: 500 } }));
    await createSupabaseRepository(client, 'u').importBackup(big, undefined, { replaceCategories: 1 });
    expect(calls[0]!.name).toBe('import_ledger_begin');
    expect(calls.at(-1)!.name).toBe(NEW_RPC);
  });

  it('ขั้นสุดท้ายถูกฐานข้อมูลปฏิเสธ: บอกว่าสมุดเข้าแล้ว ข้อมูลลงทุนไม่เข้า หมวดเดิมยังอยู่', async () => {
    expect(await failMessage({ message: 'เป้ารวมต้องเป็น 100%', code: '23514' })).toMatch(/สมุดบัญชีสำเร็จแล้ว.*หมวดเดิมยังอยู่ครบ/);
  });

  it('หมวดเปลี่ยนหลังกดยืนยัน (PT409): บอกว่าไม่ได้ลบหมวด', async () => {
    expect(await failMessage({ message: 'หมวดเปลี่ยนไปแล้ว', code: 'PT409' })).toMatch(/หมวดเปลี่ยนหลังคุณกดยืนยัน.*ไม่ได้ลบหมวด/);
  });

  it('ไม่ได้คำตอบจากฐานข้อมูล (เน็ตหลุด ไม่มีรหัส): ไม่อ้างว่าหมวดยังอยู่', async () => {
    const message = await failMessage({ message: 'TypeError: Failed to fetch', code: '' });
    expect(message).toMatch(/ยืนยันผลไม่ได้/);
    expect(message).not.toMatch(/หมวดเดิมยังอยู่|ไม่ได้ลบ/);
  });
});

describe('ขั้นข้อมูลลงทุนล้ม: ชนิดข้อผิดพลาดสำหรับปุ่มลองใหม่', () => {
  const ledger = {
    accounts: [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ],
    entries: [{ id: 'e', date: '2026-11-01', memo: '', source: 'system' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] }],
    bills: [],
    settings: {},
  };
  const investments = { assets: [{ id: 's', name: 'สมมติ', kind: 'fund' as const, accountId: 'i' }], trades: [], prices: [] };
  const OLD_RPC = 'import_ledger_investments';
  const NEW_RPC = 'import_ledger_investments_replacing_categories';
  const failing = (error: { message: string; code?: string }) => fakeClient((call) => (call.name === OLD_RPC || call.name === NEW_RPC ? { error } : { data: { accounts: 2, bills: 0, entries: 1 } }));
  const fail = async (data: Parameters<ReturnType<typeof createSupabaseRepository>['importBackup']>[0], error: { message: string; code?: string }, replaceCategories?: number) => {
    const options = replaceCategories === undefined ? undefined : { replaceCategories };
    const e = await createSupabaseRepository(failing(error).client, 'u').importBackup(data, undefined, options).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InvestmentImportError);
    return e as InvestmentImportError;
  };

  it('ฐานข้อมูลปฏิเสธ = not_saved ทั้งสองทาง', async () => {
    for (const replace of [undefined, 2]) {
      const e = await fail({ ...ledger, investments }, { message: 'x', code: '23514' }, replace);
      expect(e.outcome).toBe('not_saved');
      expect(e.message).toMatch(/สมุดบัญชีสำเร็จแล้ว.*ข้อมูลลงทุนยังไม่เข้า/);
    }
  });
  it('ไม่ได้คำตอบ (ไม่มีรหัส) = unknown ทั้งสองทาง ไม่อ้างว่าไม่เข้า', async () => {
    for (const replace of [undefined, 2]) {
      const e = await fail({ ...ledger, investments }, { message: 'TypeError: Failed to fetch', code: '' }, replace);
      expect(e.outcome).toBe('unknown');
      expect(e.message).toMatch(/ยืนยันผลไม่ได้/);
      expect(e.message).not.toMatch(/ยังไม่เข้า|หมวดเดิมยังอยู่|Failed to fetch/);
    }
  });
  it('หมวดเปลี่ยน (PT409) = not_saved', async () => {
    expect((await fail({ ...ledger, investments }, { message: 'x', code: 'PT409' }, 2)).outcome).toBe('not_saved');
  });
  it('ไฟล์ไม่มีข้อมูลลงทุน (ลบหมวดอย่างเดียว): ข้อความพูดเรื่องลบหมวด ไม่พูดว่าข้อมูลลงทุนไม่เข้า', async () => {
    for (const code of ['23514', 'PT409', '']) {
      const e = await fail(ledger, { message: 'x', code }, 2);
      expect(e.message).toMatch(/สมุดบัญชีสำเร็จแล้ว.*หมวดเดิม/);
      expect(e.message).not.toMatch(/ข้อมูลลงทุน/);
    }
    expect((await fail(ledger, { message: 'x', code: '' }, 2)).message).not.toMatch(/หมวดเดิมยังอยู่|ไม่ได้ลบ/);
  });
  it('สมุดบัญชีล้มเอง ไม่ใช่ InvestmentImportError', async () => {
    const { client } = fakeClient(() => ({ error: { message: 'x', code: '23514' } }));
    const e = await createSupabaseRepository(client, 'u').importBackup({ ...ledger, investments }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StorageError);
    expect(e).not.toBeInstanceOf(InvestmentImportError);
  });
  /** client จำลองที่มีเซสชันของผู้ใช้ที่กำหนด (null = ออกจากระบบ) */
  const signedIn = (client: SupabaseClient, id: string | null) =>
    Object.assign(client, { auth: { getSession: () => Promise.resolve({ data: { session: id === null ? null : { user: { id } } } }) } });
  it('บัญชีที่เข้าสู่ระบบเปลี่ยนไป (หรือออกจากระบบ) = ไม่เรียกฐานข้อมูลเลย', async () => {
    for (const id of ['other', null]) {
      const { client, calls } = fakeClient(() => ({ data: {} }));
      await expect(createSupabaseRepository(signedIn(client, id), 'u').retryImportInvestments(investments)).rejects.toThrow(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป/);
      expect(calls).toHaveLength(0);
    }
  });
  it('retryImportInvestments: เรียกเฉพาะขั้นข้อมูลลงทุน ไม่เรียกนำเข้าสมุดอีก', async () => {
    for (const [replace, name] of [[undefined, OLD_RPC], [2, NEW_RPC]] as const) {
      const { client, calls } = fakeClient(() => ({ data: {} }));
      await createSupabaseRepository(signedIn(client, 'u'), 'u').retryImportInvestments(investments, replace === undefined ? undefined : { replaceCategories: replace });
      expect(calls.map((c) => c.name)).toEqual([name]);
    }
  });
  it('retryImportInvestments ล้ม = InvestmentImportError เหมือนรอบแรก', async () => {
    const repo = createSupabaseRepository(signedIn(failing({ message: 'x', code: '' }).client, 'u'), 'u');
    await expect(repo.retryImportInvestments(investments)).rejects.toMatchObject({ outcome: 'unknown' });
  });
});

describe('บัญชีเปลี่ยนจากแท็บอื่นระหว่างนำเข้า', () => {
  const ledger = {
    accounts: [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ],
    entries: [{ id: 'e', date: '2026-11-01', memo: '', source: 'system' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] }],
    bills: [],
    settings: {},
  };
  const investments = { assets: [{ id: 's', name: 'สมมติ', kind: 'fund' as const, accountId: 'a' }], trades: [], prices: [] };
  const ok = () => ({ data: { accounts: 2, bills: 0, entries: 1 } });

  it('เปลี่ยนก่อนเริ่ม (หรือออกจากระบบ): ไม่เรียกฐานข้อมูลเลย', async () => {
    for (const id of ['other', null]) {
      const { client, calls } = fakeClient(ok, [id]);
      await expect(createSupabaseRepository(client, 'u').importBackup(ledger)).rejects.toThrow(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป/);
      expect(calls).toHaveLength(0);
    }
  });
  it('เปลี่ยนหลังสมุดเข้าแล้ว: ไม่เรียกขั้นข้อมูลลงทุน · เป็น InvestmentImportError', async () => {
    const { client, calls } = fakeClient(ok, ['u', 'other']);
    const e = await createSupabaseRepository(client, 'u').importBackup({ ...ledger, investments }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(InvestmentImportError);
    expect((e as Error).message).toMatch(/บัญชีที่เข้าสู่ระบบเปลี่ยนไป/);
    expect(calls.map((c) => c.name)).toEqual(['import_ledger']);
  });
  it('confirmSameAccount: ผู้ใช้เดิมผ่าน · ต่างหรือออกจากระบบ = StorageError', async () => {
    await expect(createSupabaseRepository(fakeClient(ok).client, 'u').confirmSameAccount()).resolves.toBeUndefined();
    for (const id of ['other', null]) {
      await expect(createSupabaseRepository(fakeClient(ok, [id]).client, 'u').confirmSameAccount()).rejects.toBeInstanceOf(AccountChangedError);
    }
  });
});

describe('บัญชีเปลี่ยนระหว่างส่งก้อนและระหว่างล้าง', () => {
  const big = {
    accounts: [
      { id: 'a', type: 'asset' as const, name: 'a', currency: 'THB' },
      { id: 'b', type: 'equity' as const, name: 'b', currency: 'THB' },
    ],
    entries: Array.from({ length: 1600 }, (_, i) => ({ id: 'e' + i, date: '2026-11-01', memo: '', source: 'manual' as const, lines: [{ accountId: 'a', amount: 10 }, { accountId: 'b', amount: -10 }] })),
    bills: [],
    settings: {},
  };
  const ok = () => ({ data: { entries: 500 } });
  const CHANGED = /บัญชีที่เข้าสู่ระบบเปลี่ยนไป/;

  it('เปลี่ยนก่อนก้อนถัดไป: ไม่ส่งต่อ และไม่สั่งล้างในชื่อบัญชีใหม่', async () => {
    // ถามครั้งที่ 1 = ก่อนเริ่ม · 2 = ก่อน append แรก · 3 = ก่อน append ที่สอง
    const { client, calls } = fakeClient(ok, ['u', 'u', 'other']);
    const e = await createSupabaseRepository(client, 'u').importBackup(big).catch((x: unknown) => x);
    expect((e as Error).message).toMatch(CHANGED);
    expect(e).not.toBeInstanceOf(ImportUnconfirmedError);
    expect((e as Error).message).not.toMatch(/ล้างส่วนที่นำเข้าค้างให้แล้ว/);
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_begin', 'import_ledger_append']);
  });
  it('ก้อนล้มและบัญชีเปลี่ยนก่อนล้าง: ไม่เรียก abort', async () => {
    const { client, calls } = fakeClient((c) => (c.name === 'import_ledger_append' ? { error: { message: 'x', code: '55000' } } : ok()), ['u', 'u', 'other']);
    await expect(createSupabaseRepository(client, 'u').importBackup(big)).rejects.toThrow(CHANGED);
    expect(calls.map((c) => c.name)).toEqual(['import_ledger_begin', 'import_ledger_append']);
  });
  it('abortUnfinishedImport: บัญชีอื่นตั้งแต่แรก = ไม่เรียกเลย · เปลี่ยนระหว่างชุด = หยุด', async () => {
    const first = fakeClient(() => ({ data: 'done' }), ['other']);
    await expect(createSupabaseRepository(first.client, 'u').abortUnfinishedImport()).rejects.toThrow(CHANGED);
    expect(first.calls).toHaveLength(0);
    const mid = fakeClient(() => ({ data: 'more' }), ['u', 'other']);
    await expect(createSupabaseRepository(mid.client, 'u').abortUnfinishedImport()).rejects.toThrow(CHANGED);
    expect(mid.calls).toHaveLength(1);
  });
  it('resetAll หยุดกลางทาง: บอกว่าอาจล้างไปแล้วบางส่วน', async () => {
    const mid = fakeClient(() => ({ data: 'more' }), ['u', 'other']);
    await expect(createSupabaseRepository(mid.client, 'u', { getPasswordForReset: async () => 'pw' }).resetAll()).rejects.toThrow(/อาจล้างไปแล้วบางส่วน/);
  });
  it('resetAll: ตรวจหลังกรอกรหัสผ่านและก่อนทุกชุด', async () => {
    const options = { getPasswordForReset: async () => 'pw' };
    const first = fakeClient(() => ({ data: 'done' }), ['other']);
    await expect(createSupabaseRepository(first.client, 'u', options).resetAll()).rejects.toThrow(CHANGED);
    expect(first.calls).toHaveLength(0);
    const mid = fakeClient(() => ({ data: 'more' }), ['u', 'other']);
    await expect(createSupabaseRepository(mid.client, 'u', options).resetAll()).rejects.toThrow(CHANGED);
    expect(mid.calls).toHaveLength(1);
  });
});
