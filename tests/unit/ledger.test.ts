import { describe, expect, it } from 'vitest';
import { classifyEntry, naturalBalance, periodTotals, balanceOf } from '../../src/domain/ledger/balance';
import { createEntry, isValidIsoDate, LedgerError } from '../../src/domain/ledger/entry';
import { runIntegrityCheck } from '../../src/domain/ledger/integrity';
import type { Account, Entry } from '../../src/domain/ledger/types';
import { parseBahtToSatang as baht } from '../../src/domain/money/satang';
import { convertToSatang, parseMicro } from '../../src/domain/money/micro';

const accounts: Account[] = [
  { id: 'cashflow', type: 'asset', name: 'CashFlow', currency: 'THB' },
  { id: 'mainframe', type: 'asset', name: 'Mainframe', currency: 'THB' },
  { id: 'vault', type: 'asset', name: 'Vault Zero', currency: 'THB' },
  { id: 'friend', type: 'asset', name: 'ลูกหนี้: เพื่อน', currency: 'THB' },
  { id: 'broker-usd', type: 'asset', name: 'Webull (USD)', currency: 'USD' },
  { id: 'card', type: 'liability', name: 'บัตร KTC', currency: 'THB' },
  { id: 'car-loan', type: 'liability', name: 'สินเชื่อรถ', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'shopping', type: 'expense', name: 'ช้อปปิ้ง', currency: 'THB' },
  { id: 'interest', type: 'expense', name: 'ดอกเบี้ย', currency: 'THB' },
  { id: 'fx-thb', type: 'equity', name: 'พักอัตราแลกเปลี่ยน THB', currency: 'THB' },
  { id: 'fx-usd', type: 'equity', name: 'พักอัตราแลกเปลี่ยน USD', currency: 'USD' },
];

let seq = 0;
function entry(date: string, memo: string, lines: [string, number][]): Entry {
  seq += 1;
  return createEntry(accounts, {
    id: `e${seq}`,
    date,
    memo,
    lines: lines.map(([accountId, amount]) => ({ accountId, amount })),
  });
}

const NOV = { from: '2026-11-01', to: '2026-11-30' };

describe('createEntry: Entry ที่ไม่สมดุลสร้างไม่ได้ (R16)', () => {
  it('สร้างรายการสมดุลได้', () => {
    const e = entry('2026-11-01', 'เงินเดือน', [
      ['mainframe', baht('17000')],
      ['salary', -baht('17000')],
    ]);
    expect(e.source).toBe('manual');
    expect(e.lines).toHaveLength(2);
  });

  it('ปฏิเสธรายการไม่สมดุล', () => {
    expect(() =>
      createEntry(accounts, {
        id: 'x',
        date: '2026-11-01',
        memo: '',
        lines: [
          { accountId: 'food', amount: 6500 },
          { accountId: 'cashflow', amount: -6400 },
        ],
      }),
    ).toThrow(/ไม่สมดุล/);
  });

  it.each([
    ['มี Line เดียว', [{ accountId: 'food', amount: 100 }]],
    ['ยอด 0', [{ accountId: 'food', amount: 0 }, { accountId: 'cashflow', amount: 0 }]],
    ['ยอดทศนิยม', [{ accountId: 'food', amount: 0.5 }, { accountId: 'cashflow', amount: -0.5 }]],
    ['ไม่มีบัญชี', [{ accountId: 'food', amount: 100 }, { accountId: 'nope', amount: -100 }]],
  ])('ปฏิเสธ: %s', (_name, lines) => {
    expect(() => createEntry(accounts, { id: 'x', date: '2026-11-01', memo: '', lines })).toThrow(
      LedgerError,
    );
  });

  it('ปฏิเสธบัญชีซ้ำ id และ Entry ไม่มี id', () => {
    const dup: Account[] = [...accounts, { id: 'food', type: 'expense', name: 'ซ้ำ', currency: 'THB' }];
    expect(() =>
      createEntry(dup, {
        id: 'x',
        date: '2026-11-01',
        memo: '',
        lines: [
          { accountId: 'food', amount: 1 },
          { accountId: 'cashflow', amount: -1 },
        ],
      }),
    ).toThrow(/บัญชีซ้ำ/);
    expect(() =>
      createEntry(accounts, {
        id: '',
        date: '2026-11-01',
        memo: '',
        lines: [
          { accountId: 'food', amount: 1 },
          { accountId: 'cashflow', amount: -1 },
        ],
      }),
    ).toThrow(/id/);
  });
});

describe('วันที่ (วันสิ้นเดือน, ปีอธิกสุรทิน)', () => {
  it.each([
    ['2026-11-30', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isValidIsoDate(value)).toBe(expected);
  });
});

describe('รายรับ/รายจ่ายไม่นับซ้ำ (R4, R7)', () => {
  const ledger: Entry[] = [];
  const add = (e: Entry) => ledger.push(e);

  add(entry('2026-11-01', 'เงินเดือน', [['mainframe', baht('17000')], ['salary', -baht('17000')]]));
  add(entry('2026-11-02', 'กาแฟ', [['food', baht('65')], ['cashflow', -baht('65')]]));
  add(entry('2026-11-03', 'โอนเข้า Vault', [['vault', baht('2500')], ['mainframe', -baht('2500')]]));
  add(entry('2026-11-04', 'รูดบัตรซื้อของ', [['shopping', baht('1200')], ['card', -baht('1200')]]));
  add(entry('2026-11-05', 'จ่ายบิลบัตร', [['card', baht('1200')], ['mainframe', -baht('1200')]]));
  add(
    entry('2026-11-06', 'งวดรถ (ต้น + ดอก)', [
      ['car-loan', baht('3820')],
      ['interest', baht('680')],
      ['mainframe', -baht('4500')],
    ]),
  );
  add(entry('2026-11-07', 'เพื่อนยืม', [['friend', baht('1500')], ['cashflow', -baht('1500')]]));
  add(entry('2026-11-20', 'เพื่อนคืน', [['cashflow', baht('1500')], ['friend', -baht('1500')]]));

  it('รายรับ = เงินเดือนเท่านั้น', () => {
    expect(periodTotals(accounts, ledger, NOV).income).toBe(baht('17000'));
  });

  it('รายจ่าย = กาแฟ + ซื้อของ + ดอกเบี้ย เท่านั้น (โอน/จ่ายบัตร/เงินต้น/ให้ยืม ไม่นับ)', () => {
    const expected = baht('65') + baht('1200') + baht('680');
    const totals = periodTotals(accounts, ledger, NOV);
    expect(totals.expense).toBe(expected);
    expect(totals.net).toBe(baht('17000') - expected);
  });

  it('จ่ายงวดหนี้ "ก้อนเดียว" ผิดกฎ: ถ้าบันทึกค่างวดทั้งก้อนเป็นรายจ่ายจะนับซ้ำ', () => {
    // พิสูจน์เหตุผลของ R7: ค่างวด 4,500 ทั้งก้อนเป็นรายจ่าย ทำให้ยอดสูงกว่าที่ถูกต้อง 3,820
    const wrong = createEntry(accounts, {
      id: 'wrong',
      date: '2026-11-08',
      memo: 'ผิดกฎ',
      lines: [
        { accountId: 'shopping', amount: baht('4500') },
        { accountId: 'mainframe', amount: -baht('4500') },
      ],
    });
    const withWrong = periodTotals(accounts, [...ledger, wrong], NOV).expense;
    const correct = periodTotals(accounts, ledger, NOV).expense;
    expect(withWrong - correct).toBe(baht('4500'));
  });

  it('ยอดหนี้เป็นบวกตามธรรมชาติ และลดลงเมื่อจ่ายต้น', () => {
    const card = accounts.find((a) => a.id === 'card')!;
    expect(naturalBalance(card, ledger)).toBe(0); // รูด 1,200 แล้วจ่าย 1,200 ครบ
    const unpaid = [entry('2026-11-09', 'รูดบัตรยังไม่จ่าย', [['food', baht('3200')], ['card', -baht('3200')]])];
    expect(naturalBalance(card, unpaid)).toBe(baht('3200')); // หนี้แสดงเป็นบวก ไม่ใช่ -3,200
    const food = accounts.find((a) => a.id === 'food')!;
    expect(naturalBalance(food, unpaid)).toBe(baht('3200'));
  });

  it('ยอดกระเป๋าคำนวณจากผลรวม Line เท่านั้น', () => {
    // mainframe: +17000 -2500 -1200 -4500 = 8800
    expect(balanceOf('mainframe', ledger)).toBe(baht('8800'));
    // cashflow: -65 -1500 +1500 = -65
    expect(balanceOf('cashflow', ledger)).toBe(-baht('65'));
  });

  it('ช่วงวันที่รวมวันสิ้นเดือน และไม่รวมวันที่ 1 เดือนถัดไป', () => {
    const edge = [
      entry('2026-11-30', 'สิ้นเดือน', [['food', 100], ['cashflow', -100]]),
      entry('2026-12-01', 'เดือนหน้า', [['food', 999], ['cashflow', -999]]),
      entry('2026-10-31', 'เดือนก่อน', [['food', 777], ['cashflow', -777]]),
    ];
    expect(periodTotals(accounts, edge, NOV).expense).toBe(100);
  });

  it('ไม่มีรายการ = ศูนย์ทั้งหมด', () => {
    expect(periodTotals(accounts, [], NOV)).toEqual({ currency: 'THB', income: 0, expense: 0, net: 0 });
  });

  it('classifyEntry', () => {
    const kinds = ledger.map((e) => classifyEntry(accounts, e));
    expect(kinds).toEqual([
      'income', // เงินเดือน
      'expense', // กาแฟ
      'transfer', // โอนเข้า Vault
      'expense', // รูดบัตร
      'transfer', // จ่ายบิลบัตร
      'expense', // งวดรถ (มีดอกเบี้ย)
      'transfer', // เพื่อนยืม
      'transfer', // เพื่อนคืน
    ]);
  });
});

describe('หลายสกุลเงิน (R3, R10)', () => {
  it('โอน THB -> USD ด้วยบัญชีพักอัตราแลกเปลี่ยนฝั่งละสกุลเงิน และไม่นับเป็นรายรับ/รายจ่าย', () => {
    const usd = parseMicro('100');
    const thb = convertToSatang(usd, parseMicro('32.834')); // 328,340 สตางค์
    const e = entry('2026-11-10', 'โอนเข้า Webull', [
      ['broker-usd', usd],
      ['fx-usd', -usd],
      ['fx-thb', thb],
      ['mainframe', -thb],
    ]);
    expect(periodTotals(accounts, [e], NOV)).toMatchObject({ income: 0, expense: 0 });
    expect(classifyEntry(accounts, e)).toBe('transfer');
    expect(balanceOf('broker-usd', [e])).toBe(100_000_000);
    expect(balanceOf('mainframe', [e])).toBe(-328_340);
  });

  it('ปฏิเสธรายการที่ข้ามสกุลเงินโดยไม่มีบัญชีพัก (ห้ามบวกต่างสกุลตรงๆ)', () => {
    expect(() =>
      createEntry(accounts, {
        id: 'bad-fx',
        date: '2026-11-10',
        memo: '',
        lines: [
          { accountId: 'broker-usd', amount: 100_000_000 },
          { accountId: 'mainframe', amount: -100_000_000 },
        ],
      }),
    ).toThrow(/ไม่สมดุลในสกุลเงิน/);
  });

  it('periodTotals แยกตามสกุลเงิน ไม่ปนกัน', () => {
    const e = entry('2026-11-11', 'รายรับบาท 1 บาท', [['mainframe', baht('1')], ['salary', -baht('1')]]);
    expect(periodTotals(accounts, [e], NOV, 'USD')).toMatchObject({ income: 0, expense: 0 });
    expect(periodTotals(accounts, [e], NOV, 'THB').income).toBe(baht('1'));
  });
});

describe('runIntegrityCheck (R14)', () => {
  const good: Entry[] = [
    entry('2026-11-01', 'เงินเดือน', [['mainframe', baht('17000')], ['salary', -baht('17000')]]),
    entry('2026-11-02', 'กาแฟ', [['food', baht('65')], ['cashflow', -baht('65')]]),
  ];

  it('สมุดบัญชีที่ถูกต้องผ่านทั้งหมด', () => {
    const report = runIntegrityCheck(accounts, good);
    expect(report).toEqual({ ok: true, checkedEntries: 2, issues: [] });
  });

  it('สมุดบัญชีว่างผ่าน', () => {
    expect(runIntegrityCheck(accounts, []).ok).toBe(true);
  });

  it('จับทุกประเภทปัญหา', () => {
    const broken: Entry[] = [
      { id: 'a', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 100 }, { accountId: 'cashflow', amount: -90 }] },
      { id: 'a', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 1 }, { accountId: 'cashflow', amount: -1 }] },
      { id: 'b', date: '2026-02-30', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 1 }, { accountId: 'cashflow', amount: -1 }] },
      { id: 'c', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 1 }] },
      { id: 'd', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'ghost', amount: 1 }, { accountId: 'cashflow', amount: -1 }] },
      { id: 'e', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 65.5 }, { accountId: 'cashflow', amount: -65.5 }] },
      { id: 'f', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 0 }, { accountId: 'cashflow', amount: 0 }] },
    ];
    const dupAccounts: Account[] = [...accounts, { id: 'food', type: 'expense', name: 'ซ้ำ', currency: 'THB' }];
    const report = runIntegrityCheck(dupAccounts, broken);
    const codes = new Set(report.issues.map((i) => i.code));
    expect(report.ok).toBe(false);
    expect(codes).toEqual(
      new Set(['duplicate-account', 'duplicate-entry', 'bad-date', 'too-few-lines', 'unknown-account', 'non-integer', 'zero-line', 'unbalanced']),
    );
    expect(report.issues.find((i) => i.code === 'unbalanced')?.entryId).toBe('a');
  });

  it('ยอดทศนิยมที่หลุดเข้ามาถูกรายงานเป็น non-integer ไม่ใช่ unbalanced ซ้ำ', () => {
    const report = runIntegrityCheck(accounts, [
      { id: 'f', date: '2026-11-01', memo: '', source: 'manual', lines: [{ accountId: 'food', amount: 0.1 + 0.2 }, { accountId: 'cashflow', amount: -0.3 }] },
    ]);
    expect(report.issues.map((i) => i.code)).toEqual(['non-integer', 'non-integer']);
  });
});
