import { describe, expect, it } from 'vitest';
import { buildInitialLedger } from '../../src/app/setup';
import { MAX_IMPORT_BYTES, parseBackup, type BackupData } from '../../src/domain/backup/parseBackup';

const TODAY = '2026-11-09';

const good = (): Record<string, unknown> => {
  const ledger = buildInitialLedger([{ name: 'CashFlow', opening: '5408.41' }, { name: 'Vault Zero', opening: '2500' }], '2026-11-01');
  const wallet = ledger.accounts.find((a) => a.type === 'asset')!;
  const category = ledger.accounts.find((a) => a.type === 'expense')!;
  return {
    schemaVersion: 2,
    exportedAt: '2026-11-08T10:00:00.000Z',
    accounts: ledger.accounts,
    entries: [
      ...ledger.entries,
      { id: 'e1', date: '2026-11-02', memo: 'ข้าว', source: 'manual', createdAt: '2026-11-02T03:00:00.000Z', lines: [{ accountId: category.id, amount: 5000 }, { accountId: wallet.id, amount: -5000 }] },
      {
        id: 'pay-1', date: '2026-11-05', memo: 'ค่าเน็ต', source: 'recurring', bill: { id: 'bill-1', cycle: '2026-11' },
        lines: [{ accountId: category.id, amount: 59_900 }, { accountId: wallet.id, amount: -59_900 }],
      },
    ],
    bills: [{ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, walletId: wallet.id, categoryId: category.id, lastPaidMonth: '2026-11', startMonth: '2026-10' }],
    settings: { payDay: 25, monthlyBudget: 1_000_000 },
  };
};
const parse = (value: unknown) => parseBackup(typeof value === 'string' ? value : JSON.stringify(value), TODAY);
const problems = (value: unknown) => {
  const r = parse(value);
  if (r.ok) throw new Error('ควรถูกปฏิเสธ');
  return r.problems.join(' | ');
};

describe('ตรวจไฟล์สำรอง (ไม่เชื่อข้อมูล · ปฏิเสธทั้งก้อน)', () => {
  it('ไฟล์ดีผ่าน ได้ข้อมูลครบพร้อมสรุป', () => {
    const r = parse(good());
    if (!r.ok) throw new Error(r.problems.join('\n'));
    const d: BackupData = r.data;
    expect(d.accounts.length).toBeGreaterThan(5);
    expect(d.entries).toHaveLength(4);
    expect(d.bills).toEqual([{ id: 'bill-1', name: 'ค่าเน็ต', amount: 59_900, dueDay: 5, walletId: expect.any(String), categoryId: expect.any(String), lastPaidMonth: '2026-11', startMonth: '2026-10' }]);
    expect(d.settings).toEqual({ payDay: 25, monthlyBudget: 1_000_000 });
    expect(r.summary).toMatchObject({ accounts: d.accounts.length, entries: 4, bills: 1 });
  });

  it('ไฟล์เก่าที่ไม่มี bills/settings ผ่านได้ (ว่าง)', () => {
    const f = good();
    delete f.bills;
    delete f.settings;
    f.entries = (f.entries as { id: string }[]).filter((e) => e.id !== 'pay-1');
    const r = parse(f);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.bills).toEqual([]);
    expect(r.data.settings).toEqual({});
  });

  it('ไม่ใช่ JSON / ไม่ใช่วัตถุ / ใหญ่เกิน / เวอร์ชันใหม่กว่าแอป ถูกปฏิเสธ', () => {
    expect(problems('{not json')).toMatch(/JSON/);
    expect(problems('[]')).toMatch(/วัตถุ/);
    expect(problems('null')).toMatch(/วัตถุ/);
    expect(parseBackup('x'.repeat(MAX_IMPORT_BYTES + 1), TODAY)).toMatchObject({ ok: false });
    expect(problems({ ...good(), schemaVersion: 99 })).toMatch(/เวอร์ชัน/);
    expect(problems({ ...good(), accounts: 'x' })).toMatch(/accounts/);
    expect(problems({ ...good(), entries: {} })).toMatch(/entries/);
  });

  it('ยอดต้องเป็นจำนวนเต็มปลอดภัย: ทศนิยม ข้อความ NaN เกินช่วง ถูกปฏิเสธ (R1)', () => {
    for (const bad of [1.5, '100', null, 9007199254740993, 1e300]) {
      const f = good();
      const e = (f.entries as { id: string; lines: { amount: unknown }[] }[]).find((x) => x.id === 'e1')!;
      e.lines[0]!.amount = bad;
      expect(problems(f), String(bad)).toMatch(/e1/);
    }
  });

  it('รายการไม่สมดุล/บรรทัดเดียว/ยอด 0/บัญชีไม่มี/วันที่ผิด/id ซ้ำ ถูกปฏิเสธทั้งไฟล์ (R16)', () => {
    const mutate = (fn: (e: { id: string; date: string; lines: { accountId: string; amount: number }[] }) => void) => {
      const f = good();
      fn((f.entries as never[]).find((x: { id: string }) => x.id === 'e1')!);
      return problems(f);
    };
    expect(mutate((e) => { e.lines[0]!.amount = 5001; })).toMatch(/ไม่สมดุล/);
    expect(mutate((e) => { e.lines.pop(); })).toMatch(/e1/);
    expect(mutate((e) => { e.lines[0]!.amount = 0; })).toMatch(/e1/);
    expect(mutate((e) => { e.lines[0]!.accountId = 'ไม่มี'; })).toMatch(/ไม่พบบัญชี/);
    expect(mutate((e) => { e.date = '2026-02-30'; })).toMatch(/วันที่/);
    const dup = good();
    (dup.entries as unknown[]).push((dup.entries as unknown[])[0]);
    expect(problems(dup)).toMatch(/ซ้ำ/);
    const dupAcc = good();
    (dupAcc.accounts as unknown[]).push((dupAcc.accounts as unknown[])[0]);
    expect(problems(dupAcc)).toMatch(/ซ้ำ/);
  });

  it('บัญชีผิดรูป: ชนิด/สกุลเงิน/ชื่อว่าง ถูกปฏิเสธ', () => {
    for (const patch of [{ type: 'bank' }, { currency: 'thb' }, { name: '' }, { id: '' }]) {
      const f = good();
      Object.assign((f.accounts as object[])[3]!, patch);
      expect(parse(f).ok, JSON.stringify(patch)).toBe(false);
    }
  });

  it('บิลผิดรูป: ยอด 0 / วันครบกำหนดผิด / lastPaidMonth อนาคต (R15) / อ้างกระเป๋าไม่มี / รหัสซ้ำ ถูกปฏิเสธ', () => {
    const mutate = (patch: object) => {
      const f = good();
      Object.assign((f.bills as object[])[0]!, patch);
      return problems(f);
    };
    expect(mutate({ amount: 0 })).toMatch(/bill-1/);
    expect(mutate({ dueDay: 32 })).toMatch(/bill-1/);
    expect(mutate({ lastPaidMonth: '2026-12' })).toMatch(/อนาคต/);
    expect(mutate({ walletId: 'ไม่มี' })).toMatch(/กระเป๋า/);
    expect(mutate({ categoryId: (good().accounts as { id: string; type: string }[]).find((a) => a.type === 'asset')!.id })).toMatch(/หมวด/);
    const dup = good();
    (dup.bills as unknown[]).push({ ...(dup.bills as object[])[0] });
    expect(problems(dup)).toMatch(/ซ้ำ/);
    expect(parse({ ...good(), bills: [{ id: 'b', name: 'x', amount: 1, dueDay: 1, lastPaidMonth: '2026-11' }] }).ok).toBe(true);
  });

  it('ค่าตั้งค่าผิดรูปถูกปฏิเสธ (ไม่ทิ้งเงียบ)', () => {
    expect(problems({ ...good(), settings: { payDay: 99 } })).toMatch(/ตั้งค่า/);
    expect(problems({ ...good(), settings: 'x' })).toMatch(/settings/);
  });

  it('ไม่คัดลอกฟิลด์แปลก/__proto__ เข้าข้อมูล (กัน prototype pollution)', () => {
    const text = JSON.stringify(good()).replace('"memo":"ข้าว"', '"memo":"ข้าว","__proto__":{"polluted":true},"extra":1');
    const r = parseBackup(text, TODAY);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    const e1 = r.data.entries.find((e) => e.id === 'e1')!;
    expect('extra' in e1).toBe(false);
    expect(Object.keys(e1).sort()).toEqual(['createdAt', 'date', 'id', 'lines', 'memo', 'source']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('จำกัดจำนวน: รายการเกินเพดานถูกปฏิเสธก่อนตรวจรายตัว', () => {
    const f = good();
    f.entries = Array.from({ length: 20_001 }, (_, i) => ({ id: `x${i}`, date: '2026-11-01', memo: '', lines: [] }));
    expect(problems(f)).toMatch(/มากเกิน|เกิน/);
  });

  it('รายงานปัญหาไม่เกิน 30 ข้อและไม่รั่วข้อความภายใน', () => {
    const f = good();
    f.entries = Array.from({ length: 200 }, (_, i) => ({ id: `x${i}`, date: 'bad', memo: '', lines: [] }));
    const r = parse(f);
    if (r.ok) throw new Error('ควรถูกปฏิเสธ');
    expect(r.problems.length).toBeLessThanOrEqual(31);
    expect(r.problems.at(-1)).toMatch(/อีก/);
  });

  it('source ที่ไม่รู้จัก และลิงก์บิลในรายการที่ไม่ใช่ recurring ถูกปฏิเสธ', () => {
    const a = good();
    (a.entries as { id: string; source?: string }[]).find((e) => e.id === 'e1')!.source = 'hacker';
    expect(parse(a).ok).toBe(false);
    const b = good();
    (b.entries as { id: string; bill?: unknown }[]).find((e) => e.id === 'e1')!.bill = { id: 'bill-1', cycle: '2026-11' };
    expect(parse(b).ok).toBe(false);
  });
});

describe('ค่าคงที่ที่ต้องตรงกัน', () => {
  it('เวอร์ชันไฟล์สำรองที่รองรับ = SCHEMA_VERSION ของฐานข้อมูลในเครื่อง', async () => {
    const { SCHEMA_VERSION } = await import('../../src/storage/db');
    const { MAX_SUPPORTED_SCHEMA } = await import('../../src/domain/backup/parseBackup');
    expect(MAX_SUPPORTED_SCHEMA).toBe(SCHEMA_VERSION);
  });
});

describe('ตรวจเพิ่มจากผู้ตรวจ M2-D1', () => {
  const entry = (f: Record<string, unknown>, id: string) => (f.entries as { id: string; [k: string]: unknown }[]).find((e) => e.id === id)!;

  it('ยอดสะสมต่อบัญชีเกินช่วงปลอดภัยข้ามหลายรายการถูกปฏิเสธ (ไม่ใช่แค่รายการเดียว R1)', () => {
    const f = good();
    const cat = (f.accounts as { id: string; type: string }[]).find((a) => a.type === 'expense')!.id;
    const wal = (f.accounts as { id: string; type: string }[]).find((a) => a.type === 'asset')!.id;
    const big = 6_000_000_000_000_000;
    (f.entries as unknown[]).push(
      { id: 'big1', date: '2026-11-03', memo: '', source: 'manual', lines: [{ accountId: cat, amount: big }, { accountId: wal, amount: -big }] },
      { id: 'big2', date: '2026-11-03', memo: '', source: 'manual', lines: [{ accountId: cat, amount: big }, { accountId: wal, amount: -big }] },
    );
    expect(problems(f)).toMatch(/ยอดสะสม/);
  });

  it('R15: รอบบิลอนาคต / (บิล,รอบ) ซ้ำ / lastPaidMonth เก่ากว่ารอบที่ผูก ถูกปฏิเสธ', () => {
    const a = good();
    entry(a, 'pay-1').bill = { id: 'bill-1', cycle: '2026-12' };
    expect(problems(a)).toMatch(/อนาคต/);

    const b = good();
    const p1 = entry(b, 'pay-1');
    (b.entries as unknown[]).push({ ...p1, id: 'pay-dup' });
    expect(problems(b)).toMatch(/จ่ายซ้ำ/);

    const c = good();
    (c.bills as { lastPaidMonth: string }[])[0]!.lastPaidMonth = '2026-09';
    expect(problems(c)).toMatch(/เก่ากว่า/);
  });

  it('R15: ข้อมูลจริงที่เกิดได้ผ่านพร้อมคำเตือน (บิลที่ถูกลบ, lastPaidMonth ไม่มีรายการรองรับ, recurring ไม่ผูกบิล)', () => {
    const f = good();
    f.bills = [];
    const r = parse(f);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.warnings.join('|')).toMatch(/ไม่อยู่ในไฟล์/);

    const g = good();
    g.entries = (g.entries as { id: string }[]).filter((e) => e.id !== 'pay-1');
    const r2 = parse(g);
    if (!r2.ok) throw new Error(r2.problems.join('\n'));
    expect(r2.warnings.join('|')).toMatch(/ไม่มีรายการจ่าย/);

    const h = good();
    delete entry(h, 'pay-1').bill;
    const r3 = parse(h);
    if (!r3.ok) throw new Error(r3.problems.join('\n'));
    expect(r3.warnings.join('|')).toMatch(/ไม่ผูกกับบิล/);

    const clean = parse(good());
    if (!clean.ok) throw new Error('ไฟล์ดีต้องผ่าน');
    expect(clean.warnings).toEqual([]);
  });

  it('รหัสบิลในลิงก์ยาวเกิน/มี NUL ถูกปฏิเสธด้วยข้อความไทย', () => {
    const a = good();
    entry(a, 'pay-1').bill = { id: 'x'.repeat(101), cycle: '2026-11' };
    expect(problems(a)).toMatch(/รหัสบิลในลิงก์/);
    const b = good();
    entry(b, 'pay-1').bill = { id: 'a\u0000b', cycle: '2026-11' };
    expect(problems(b)).toMatch(/รหัสบิลในลิงก์/);
  });

  it('อักขระควบคุม/ตัวกลับทิศใน id ชื่อ หมายเหตุ ถูกปฏิเสธ · ขึ้นบรรทัดใหม่ในหมายเหตุได้ · ข้อความผิดพลาดตัด id ให้สั้น', () => {
    const a = good();
    entry(a, 'e1').memo = 'ข้าว\u202Eevil';
    expect(problems(a)).toMatch(/อักขระควบคุม/);
    const b = good();
    (b.accounts as { name: string }[])[3]!.name = 'a\u0007b';
    expect(problems(b)).toMatch(/อักขระควบคุม/);
    const c = good();
    entry(c, 'e1').memo = 'บรรทัด 1\nบรรทัด 2\tแท็บ';
    expect(parse(c).ok).toBe(true);
    const d = good();
    entry(d, 'e1').id = 'y'.repeat(300) + '\u202E';
    const msg = problems(d);
    expect(msg.length).toBeLessThan(400);
    expect(msg).not.toMatch(/\u202E/);
  });

  it('จำกัดบรรทัดต่อรายการ (200) และบรรทัดรวม (20,000) ให้ตรงกับฐานข้อมูล', () => {
    const f = good();
    const cat = (f.accounts as { id: string; type: string }[]).find((a) => a.type === 'expense')!.id;
    const wal = (f.accounts as { id: string; type: string }[]).find((a) => a.type === 'asset')!.id;
    entry(f, 'e1').lines = Array.from({ length: 202 }, (_, i) => ({ accountId: i % 2 ? wal : cat, amount: i % 2 ? -1 : 1 }));
    expect(problems(f)).toMatch(/บรรทัดมากเกินไป/);
    const g = good();
    g.entries = Array.from({ length: 150 }, (_, i) => ({
      id: 'm' + i, date: '2026-11-02', memo: '', source: 'manual',
      lines: Array.from({ length: 200 }, (_, j) => ({ accountId: j % 2 ? wal : cat, amount: j % 2 ? -1 : 1 })),
    }));
    expect(problems(g)).toMatch(/บรรทัดรวม/);
  });

  it('เพดานรายการ 1,500 ตรงกับ import_ledger', async () => {
    const { MAX_IMPORT_ENTRIES } = await import('../../src/domain/backup/parseBackup');
    expect(MAX_IMPORT_ENTRIES).toBe(1500);
  });
});
