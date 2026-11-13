import { createEntry } from '../domain/ledger/entry';
import { accountProblem } from '../domain/ledger/limits';
import type { Account, Entry } from '../domain/ledger/types';
import { parseBahtToSatang } from '../domain/money/satang';
import type { Ledger } from '../storage/repository';

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

export interface WalletInput {
  name: string;
  /** ยอดเงินที่มีอยู่วันนี้ เป็นข้อความหน่วยบาท เช่น "5408.41" ว่าง = 0 */
  opening: string;
}

export const DEFAULT_WALLETS: readonly WalletInput[] = [
  { name: 'เงินสด', opening: '' },
  { name: 'บัญชีธนาคาร', opening: '' },
  { name: 'เงินออม', opening: '' },
];

const OPENING_ACCOUNT_ID = 'opening';

/** บัญชีรายรับ/รายจ่าย/ยอดยกมาที่สร้างให้ทุกคนตอนเริ่มต้น */
const BASE_ACCOUNTS: readonly Account[] = [
  { id: OPENING_ACCOUNT_ID, type: 'equity', name: 'ยอดยกมา', currency: 'THB' },
  { id: 'income-salary', type: 'income', name: 'เงินเดือน', currency: 'THB' },
  { id: 'income-other', type: 'income', name: 'รายรับอื่นๆ', currency: 'THB' },
  { id: 'expense-food', type: 'expense', name: 'อาหาร', currency: 'THB' },
  { id: 'expense-transport', type: 'expense', name: 'เดินทาง', currency: 'THB' },
  { id: 'expense-housing', type: 'expense', name: 'ที่อยู่อาศัย', currency: 'THB' },
  { id: 'expense-shopping', type: 'expense', name: 'ช้อปปิ้ง', currency: 'THB' },
  { id: 'expense-fun', type: 'expense', name: 'บันเทิง', currency: 'THB' },
  { id: 'expense-interest', type: 'expense', name: 'ดอกเบี้ย', currency: 'THB' },
  { id: 'expense-other', type: 'expense', name: 'อื่นๆ', currency: 'THB' },
];

/**
 * สร้างสมุดบัญชีตั้งต้นจากรายชื่อกระเป๋าและยอดวันนี้ (เริ่มใหม่ ไม่ย้ายประวัติ)
 * ยอดที่มีอยู่บันทึกเป็น Entry "ยอดยกมา" (เดบิตกระเป๋า เครดิตบัญชียอดยกมา) จึงสมดุลเสมอ
 */
export function buildInitialLedger(wallets: readonly WalletInput[], date: string): Ledger {
  const cleaned = wallets.map((w) => ({ name: w.name.trim(), opening: w.opening.trim() }));

  if (cleaned.length === 0) throw new SetupError('ต้องมีกระเป๋าอย่างน้อย 1 ใบ');
  const seen = new Set<string>();
  for (const w of cleaned) {
    if (w.name === '') throw new SetupError('กระเป๋าทุกใบต้องมีชื่อ');
    const key = w.name.toLowerCase();
    if (seen.has(key)) throw new SetupError(`ชื่อกระเป๋าซ้ำ: ${w.name}`);
    seen.add(key);
  }

  const walletAccounts: Account[] = cleaned.map((w, i) => ({
    id: `wallet-${i + 1}`,
    type: 'asset',
    name: w.name,
    currency: 'THB',
  }));
  // กำหนดลำดับแสดงผลตามที่สร้าง (ฐานข้อมูลคืนค่าเรียงตามรหัส ซึ่งไม่ใช่ลำดับที่ต้องการ)
  const accounts: Account[] = [...walletAccounts, ...BASE_ACCOUNTS].map((a, i) => ({ ...a, sortOrder: i }));
  for (const account of accounts) {
    const problem = accountProblem(account);
    if (problem) throw new SetupError(`${problem} (${account.name.slice(0, 30)})`);
  }

  const entries: Entry[] = [];
  cleaned.forEach((w, i) => {
    const wallet = walletAccounts[i];
    if (!wallet) return;
    let amount: number;
    try {
      amount = w.opening === '' ? 0 : parseBahtToSatang(w.opening);
    } catch {
      throw new SetupError(`อ่านยอดของ "${w.name}" ไม่ได้ ใส่เป็นตัวเลข เช่น 5408.41`);
    }
    if (amount < 0) throw new SetupError(`ยอดของ "${w.name}" ติดลบไม่ได้`);
    if (amount === 0) return; // ไม่มีเงิน ไม่ต้องสร้างรายการ
    entries.push(
      createEntry(accounts, {
        id: `opening-${wallet.id}`,
        date,
        memo: `ยอดยกมา ${w.name}`,
        source: 'system',
        lines: [
          { accountId: wallet.id, amount },
          { accountId: OPENING_ACCOUNT_ID, amount: -amount },
        ],
      }),
    );
  });

  return { accounts, entries };
}
