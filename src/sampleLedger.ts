/**
 * ข้อมูลตัวอย่างสำหรับ M0 เท่านั้น (ยังไม่มี storage จนถึง M1)
 * สร้างผ่าน createEntry ทั้งหมด จึงผ่านกฎสมดุลเหมือนข้อมูลจริง
 */
import { createEntry } from './domain/ledger/entry';
import type { Account, Entry } from './domain/ledger/types';
import { parseBahtToSatang as baht } from './domain/money/satang';

export const accounts: Account[] = [
  { id: 'cashflow', type: 'asset', name: 'CashFlow', currency: 'THB' },
  { id: 'mainframe', type: 'asset', name: 'Mainframe', currency: 'THB' },
  { id: 'vault', type: 'asset', name: 'Vault Zero', currency: 'THB' },
  { id: 'card', type: 'liability', name: 'บัตร KTC', currency: 'THB' },
  { id: 'car-loan', type: 'liability', name: 'สินเชื่อรถ', currency: 'THB' },
  { id: 'opening', type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'housing', type: 'expense', name: 'ที่อยู่อาศัย', currency: 'THB' },
  { id: 'interest', type: 'expense', name: 'ดอกเบี้ย', currency: 'THB' },
];

type L = [accountId: string, amount: string];

let n = 0;
function e(date: string, memo: string, lines: L[], source: Entry['source'] = 'manual'): Entry {
  n += 1;
  return createEntry(accounts, {
    id: `s${n}`,
    date,
    memo,
    source,
    lines: lines.map(([accountId, amount]) => ({ accountId, amount: baht(amount) })),
  });
}

export const entries: Entry[] = [
  e('2026-10-31', 'ยอดยกมา CashFlow', [['cashflow', '5473.41'], ['opening', '-5473.41']], 'system'),
  e('2026-10-31', 'ยอดยกมา Vault Zero', [['vault', '2500'], ['opening', '-2500']], 'system'),
  e('2026-10-31', 'ยอดยกมา สินเชื่อรถ', [['opening', '3820'], ['car-loan', '-3820']], 'system'),
  e('2026-11-01', 'เงินเดือน', [['mainframe', '17000'], ['salary', '-17000']]),
  e('2026-11-01', 'ค่าเช่าห้อง', [['housing', '4300'], ['mainframe', '-4300']]),
  e('2026-11-01', 'เข้า Vault Zero', [['vault', '2500'], ['mainframe', '-2500']]),
  e('2026-11-01', 'กาแฟ', [['food', '65'], ['cashflow', '-65']], 'quick'),
];
