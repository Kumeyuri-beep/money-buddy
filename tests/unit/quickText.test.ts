import { describe, expect, it } from 'vitest';
import { addDays } from '../../src/app/dates';
import { buildEntry } from '../../src/app/entryForm';
import { learnFromHistory, parseQuickText, type Learned, type QuickDraft } from '../../src/app/quickText';
import { buildInitialLedger } from '../../src/app/setup';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Entry } from '../../src/domain/ledger/types';

const { accounts } = buildInitialLedger(
  [
    { name: 'CashFlow', opening: '' },
    { name: 'Mainframe', opening: '' },
    { name: 'Vault Zero', opening: '' },
  ],
  '2026-11-01',
);
const TODAY = '2026-11-01';

const parse = (text: string, learned?: Learned) => parseQuickText(text, { accounts, today: TODAY, learned });
const draft = (text: string, learned?: Learned): QuickDraft => {
  const r = parse(text, learned);
  if (!r.ok) throw new Error(`ควรอ่านได้: "${text}" -> ${r.message}`);
  return r.draft;
};

describe('รายจ่าย', () => {
  it('"กาแฟ 65" เดาหมวดอาหารจากคำที่รู้จัก ใช้กระเป๋าแรกเป็นค่าเริ่มต้น', () => {
    expect(draft('กาแฟ 65')).toEqual({
      form: { kind: 'expense', date: TODAY, amount: '65.00', walletId: 'wallet-1', counterId: 'expense-food', memo: 'กาแฟ' },
      missing: [],
    });
  });

  it.each([
    ['ข้าวมันไก่ 50', 'expense-food'],
    ['65 กาแฟ', 'expense-food'],
    ['กาแฟ65', null],
    ['แท็กซี่ 120', 'expense-transport'],
    ['bts 44', 'expense-transport'],
    ['ค่าห้อง 4300', 'expense-housing'],
    ['netflix 219', 'expense-fun'],
    ['shopee 599', 'expense-shopping'],
    ['ค่าอาหาร 80', 'expense-food'], // พิมพ์ชื่อหมวดต่อท้ายคำ
    ['ดอกเบี้ย 680', 'expense-interest'],
  ])('%s -> %s', (text, category) => {
    const r = parse(text);
    if (category === null) {
      expect(r.ok).toBe(false); // "กาแฟ65" ไม่มีตัวเลขที่แยกเป็นคำ
      return;
    }
    expect(draft(text).form.counterId).toBe(category);
  });

  it('คำที่ไม่รู้จักให้เลือกหมวดเอง (ไม่เดามั่ว)', () => {
    const d = draft('ตัดผม 150');
    expect(d.form.counterId).toBe('');
    expect(d.missing).toEqual(['category']);
    expect(d.form.memo).toBe('ตัดผม');
  });

  it('เครื่องหมาย - นำหน้าจำนวนคือรายจ่าย', () => {
    expect(draft('-65 ข้าว').form).toMatchObject({ kind: 'expense', amount: '65.00' });
  });

  it('จำนวนมีลูกน้ำ ทศนิยม ฿ และ "บาท" ได้ และ "บาท" ไม่ติดไปในบันทึก', () => {
    expect(draft('ข้าว 1,234.50').form.amount).toBe('1,234.50');
    expect(draft('ข้าว ฿65').form.amount).toBe('65.00');
    expect(draft('ข้าว 65฿').form.amount).toBe('65.00');
    const d = draft('ข้าว 65 บาท');
    expect(d.form.amount).toBe('65.00');
    expect(d.form.memo).toBe('ข้าว');
  });

  it('ชื่อร้านที่มีตัวเลขปนกับขีดไม่นับเป็นจำนวนเงิน', () => {
    const d = draft('7-11 ข้าว 50');
    expect(d.form.amount).toBe('50.00');
    expect(d.form.memo).toBe('7-11 ข้าว');
  });
});

describe('รายรับ', () => {
  it('"เงินเดือน 17000 เข้า Mainframe" -> รายรับเงินเดือนเข้ากระเป๋าที่ระบุ', () => {
    expect(draft('เงินเดือน 17000 เข้า Mainframe')).toEqual({
      form: { kind: 'income', date: TODAY, amount: '17,000.00', walletId: 'wallet-2', counterId: 'income-salary', memo: 'เงินเดือน' },
      missing: [],
    });
  });
  it('เครื่องหมาย + นำหน้าจำนวนคือรายรับ และคำรายรับอื่นๆ ใช้หมวดรายรับอื่นๆ', () => {
    expect(draft('+500 ขายของ').form).toMatchObject({ kind: 'income', counterId: 'income-other', amount: '500.00' });
    expect(draft('ปันผล 120.50').form).toMatchObject({ kind: 'income', counterId: 'income-other' });
  });
  it('รายรับที่ไม่รู้หมวดให้เลือกเอง', () => {
    expect(draft('+500 ลุงให้').missing).toEqual(['category']);
  });
});

describe('โอนเงิน', () => {
  it('"โอน 2500 ไป Vault" -> ปลายทาง Vault Zero (เรียกด้วยคำแรกของชื่อ) ต้นทางเป็นกระเป๋าเริ่มต้น', () => {
    expect(draft('โอน 2500 ไป Vault')).toEqual({
      form: { kind: 'transfer', date: TODAY, amount: '2,500.00', walletId: 'wallet-1', counterId: 'wallet-3', memo: '' },
      missing: [],
    });
  });
  it('มีคำว่า จาก/ไป ครบ', () => {
    expect(draft('โอน จาก Mainframe ไป CashFlow 1000').form).toMatchObject({ walletId: 'wallet-2', counterId: 'wallet-1' });
  });
  it('ไม่มีคำนำหน้า: กระเป๋าที่เขียนก่อนคือต้นทาง', () => {
    expect(draft('โอน Mainframe Vault 2500').form).toMatchObject({ walletId: 'wallet-2', counterId: 'wallet-3' });
    expect(draft('โอน Vault Mainframe 2500').form).toMatchObject({ walletId: 'wallet-3', counterId: 'wallet-2' });
  });
  it('ชื่อกระเป๋าเต็มที่มีเว้นวรรคอ่านได้ และไม่ติดไปในบันทึก', () => {
    const d = draft('โอน 100 เข้า Vault Zero');
    expect(d.form).toMatchObject({ counterId: 'wallet-3', memo: '' });
  });
  it('ไม่ระบุปลายทาง หรือปลายทางซ้ำต้นทาง ให้เลือกเอง', () => {
    expect(draft('โอน 500').missing).toEqual(['destination']);
    const same = draft('โอน 500 จาก Vault ไป Vault');
    expect(same.missing).toEqual(['destination']);
    expect(draft('โอนเงิน 500 ไป Mainframe').form.counterId).toBe('wallet-2'); // "โอนเงิน" ก็ได้
  });
  it('ไม่ตีความคำอื่นที่ขึ้นต้นด้วย "โอน" ในกลางข้อความเป็นการโอน แต่คำแรกที่ขึ้นต้นด้วยโอนคือการโอน', () => {
    expect(draft('ค่าโอน 30').form.kind).toBe('expense');
  });
});

describe('วันที่', () => {
  it('วันนี้ เมื่อวาน เมื่อวานซืน และคำไม่ติดไปในบันทึก', () => {
    expect(draft('เมื่อวาน กาแฟ 45').form).toMatchObject({ date: '2026-10-31', memo: 'กาแฟ' });
    expect(draft('กาแฟ 45 เมื่อวานซืน').form.date).toBe('2026-10-30');
    expect(draft('วันนี้ กาแฟ 45').form.date).toBe(TODAY);
  });
  it('addDays ข้ามเดือน ปี และปีอธิกสุรทิน', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('ข้อผิดพลาดที่ผู้ใช้เข้าใจได้', () => {
  it.each([
    ['', '', true],
    ['   ', '', true],
    ['กาแฟ', 'ไม่พบจำนวนเงิน', false],
    ['กาแฟ 65 70', 'มากกว่าหนึ่งตัว', false],
    ['กาแฟ 0', 'มากกว่า 0', false],
    ['กาแฟ 0.004', 'มากกว่า 0', false],
    ['กาแฟ 999999999999999999', 'ใหญ่เกินไป', false],
    ['กาแฟ -', 'ไม่พบจำนวนเงิน', false],
  ])('"%s"', (text, message, empty) => {
    const r = parse(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.empty).toBe(empty);
      expect(r.message).toContain(message);
    }
  });
});

describe('เรียนรู้จากประวัติ', () => {
  const save = (id: string, text: string, form: Parameters<typeof buildEntry>[1]): Entry =>
    createEntry(accounts, { ...buildEntry(accounts, form, id), source: 'quick' });

  const history: Entry[] = [
    save('1', 'ตัดผม', { kind: 'expense', date: '2026-10-20', amount: '150', walletId: 'wallet-2', counterId: 'expense-other', memo: 'ตัดผม ร้านลุง' }),
    save('2', 'ตัดผม', { kind: 'expense', date: '2026-10-25', amount: '160', walletId: 'wallet-2', counterId: 'expense-fun', memo: 'ตัดผม' }),
    save('3', 'ลุง', { kind: 'income', date: '2026-10-26', amount: '500', walletId: 'wallet-1', counterId: 'income-other', memo: 'ลุงให้' }),
    save('4', 'โอน', { kind: 'transfer', date: '2026-10-27', amount: '100', walletId: 'wallet-3', counterId: 'wallet-1', memo: '' }),
  ];
  const learned = learnFromHistory(accounts, history);

  it('คำที่เคยบันทึกเดาหมวดได้ครั้งต่อไป (ค่าล่าสุดชนะ)', () => {
    expect(draft('ตัดผม 150').missing).toEqual(['category']); // ยังไม่ได้เรียนรู้
    expect(draft('ตัดผม 150', learned).form.counterId).toBe('expense-fun');
    expect(draft('ร้านลุง 80', learned).form.counterId).toBe('expense-other');
  });
  it('แยกตามประเภท: "ลุงให้" เป็นรายรับ ไม่ปนกับรายจ่าย', () => {
    expect(draft('+300 ลุงให้', learned).form.counterId).toBe('income-other');
    expect(draft('ลุงให้ 300', learned).form.counterId).toBe(''); // คำเดียวกันแต่เป็นรายจ่าย ไม่เคยเจอ
  });
  it('กระเป๋าเริ่มต้นคือกระเป๋าที่ใช้ล่าสุดของประเภทนั้น (โอน = ต้นทางล่าสุด)', () => {
    expect(draft('กาแฟ 65', learned).form.walletId).toBe('wallet-2');
    expect(draft('+100 ขายของ', learned).form.walletId).toBe('wallet-1');
    expect(draft('โอน 500 ไป CashFlow', learned).form.walletId).toBe('wallet-3');
  });
  it('ไม่เรียนรู้จากยอดยกมา และไม่พังเมื่อประวัติว่าง', () => {
    expect(learnFromHistory(accounts, []).tokens.size).toBe(0);
    const opening = buildInitialLedger([{ name: 'A', opening: '100' }], TODAY);
    expect(learnFromHistory(opening.accounts, opening.entries).tokens.size).toBe(0);
  });
  it('ชื่อหมวดที่พิมพ์เองชนะสิ่งที่เรียนรู้ไว้', () => {
    expect(draft('ตัดผม อาหาร 100', learned).form.counterId).toBe('expense-food');
  });
});

describe('ร่างที่ได้ใช้สร้างรายการจริงได้', () => {
  it('ร่างที่ไม่มีค่าที่ขาด ผ่าน buildEntry และ createEntry ได้ทุกประเภท', () => {
    for (const text of ['กาแฟ 65', 'เงินเดือน 17000 เข้า Mainframe', 'โอน 2500 ไป Vault', 'เมื่อวาน ข้าว 50']) {
      const d = draft(text);
      expect(d.missing).toEqual([]);
      const entry = createEntry(accounts, buildEntry(accounts, d.form, 'x'));
      expect(entry.lines).toHaveLength(2);
    }
  });
  it('ร่างที่ยังขาดหมวด buildEntry ปฏิเสธด้วยข้อความที่เข้าใจได้', () => {
    expect(() => buildEntry(accounts, draft('ตัดผม 150').form, 'x')).toThrow(/เลือกหมวดรายจ่าย/);
  });
});
