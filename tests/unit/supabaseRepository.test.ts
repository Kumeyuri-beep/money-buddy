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
import { StorageError } from '../../src/storage/repository';

/** client จำลอง: บันทึกทุกคำสั่งที่ส่งออกไป และตอบตามที่เทสต์กำหนด (ไม่ต้องมีฐานข้อมูลจริง) */
interface Call {
  kind: 'from' | 'rpc';
  name: string;
  ops: string[];
  args?: unknown;
}
type Responder = (call: Call) => { data?: unknown; error?: { message?: string; code?: string } | null; count?: number };

function fakeClient(respond: Responder) {
  const calls: Call[] = [];
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
  it('ล้างข้อมูลทั้งหมด: เรียกเฉพาะ reset_my_ledger พร้อมรหัสผ่าน (ไม่ลบทีละตารางเอง)', async () => {
    const { client, calls } = fakeClient(() => ({ data: true }));
    await createSupabaseRepository(client, 'u', { getPasswordForReset: async () => 'pw-1' }).resetAll();
    expect(calls.map((c) => c.kind + ':' + c.name)).toEqual(['rpc:reset_my_ledger']);
    expect(calls[0]?.args).toEqual({ p_password: 'pw-1' });
  });
  it('ล้างข้อมูล: ไม่มีช่องรหัสผ่าน = ล้างไม่ได้ · รหัสผิด (false) = ปฏิเสธ', async () => {
    const none = fakeClient(() => ({ data: true }));
    await expect(createSupabaseRepository(none.client, 'u').resetAll()).rejects.toThrow(StorageError);
    expect(none.calls).toHaveLength(0);
    const wrong = fakeClient(() => ({ data: false }));
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
