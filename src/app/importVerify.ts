import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { balanceOf } from '../domain/ledger/balance';
import type { Account, Entry } from '../domain/ledger/types';

/**
 * เทียบข้อมูลต้นทาง (ไฟล์/Dexie) กับข้อมูลที่อ่านกลับจากบัญชีออนไลน์หลังนำเข้า (M2-D)
 * ใช้ให้ผู้ใช้ "เห็นด้วยตาว่ายอดตรง" ก่อนยืนยัน · ไม่แก้ข้อมูลใด · ไม่แตะ DOM หรือฐานข้อมูล
 * ตรวจ: จำนวน, รหัสทุกตัวตรงกัน, ยอดคงเหลือต่อบัญชี (R16: ยอดคำนวณจากบรรทัดเสมอ), เนื้อหารายการ (วันที่/บรรทัด), สถานะบิล
 */
export interface VerifyInput {
  accounts: readonly Account[];
  entries: readonly Entry[];
  bills: readonly Bill[];
  /** ค่าตั้งค่า (ถ้าไม่ส่งมาทั้งสองฝั่ง = ไม่เทียบ) */
  settings?: FinanceSettings;
}

export interface AccountBalanceRow {
  accountId: string;
  name: string;
  currency: string;
  source: number;
  imported: number;
  match: boolean;
}

export interface VerifyReport {
  ok: boolean;
  counts: { accounts: [number, number]; entries: [number, number]; bills: [number, number] };
  balances: AccountBalanceRow[];
  /** ปัญหาที่เป็นข้อความอ่านง่าย (ว่าง = ตรงทุกข้อ) */
  problems: string[];
}

const linesKey = (e: Entry): string => JSON.stringify(e.lines.map((l) => [l.accountId, l.amount]));
const linkKey = (e: Entry): string => (e.bill ? JSON.stringify([e.bill.id, e.bill.cycle, e.bill.before ?? null]) : '');

/** ยอดคงเหลือ ถ้าเกินช่วงปลอดภัยคืน null (รายงานเป็นปัญหา ไม่ให้หน้าตรวจยอดพัง) */
function safeBalance(accountId: string, entries: readonly Entry[]): number | null {
  try {
    return balanceOf(accountId, entries);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

const sortKeys = (o: object): object => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

export function verifyImport(source: VerifyInput, imported: VerifyInput): VerifyReport {
  const problems: string[] = [];
  const counts: VerifyReport['counts'] = {
    accounts: [source.accounts.length, imported.accounts.length],
    entries: [source.entries.length, imported.entries.length],
    bills: [source.bills.length, imported.bills.length],
  };
  if (counts.accounts[0] !== counts.accounts[1]) problems.push(`จำนวนบัญชีไม่ตรง (ต้นทาง ${counts.accounts[0]} / ออนไลน์ ${counts.accounts[1]})`);
  if (counts.entries[0] !== counts.entries[1]) problems.push(`จำนวนรายการไม่ตรง (ต้นทาง ${counts.entries[0]} / ออนไลน์ ${counts.entries[1]})`);
  if (counts.bills[0] !== counts.bills[1]) problems.push(`จำนวนบิลไม่ตรง (ต้นทาง ${counts.bills[0]} / ออนไลน์ ${counts.bills[1]})`);

  const importedAccounts = new Map(imported.accounts.map((a) => [a.id, a] as const));
  const balances: AccountBalanceRow[] = [];
  for (const a of source.accounts) {
    const other = importedAccounts.get(a.id);
    if (!other) {
      problems.push(`ไม่พบบัญชี ${a.name} (${a.id}) ในข้อมูลออนไลน์`);
      continue;
    }
    if (other.type !== a.type || other.currency !== a.currency || other.name !== a.name || (other.archived === true) !== (a.archived === true) || other.sortOrder !== a.sortOrder) {
      problems.push(`บัญชี ${a.name} (${a.id}) ชนิด/สกุลเงิน/ชื่อ/ลำดับ/สถานะเก็บถาวรไม่ตรง`);
    }
    const s = safeBalance(a.id, source.entries);
    const i = safeBalance(a.id, imported.entries);
    if (s === null || i === null) {
      problems.push(`ยอดบัญชี ${a.name} ใหญ่เกินช่วงที่คำนวณได้อย่างปลอดภัย ตรวจยอดไม่ได้`);
      continue;
    }
    balances.push({ accountId: a.id, name: a.name, currency: a.currency, source: s, imported: i, match: s === i });
    if (s !== i) problems.push(`ยอดบัญชี ${a.name} ไม่ตรง (ต้นทาง ${s} / ออนไลน์ ${i})`);
  }

  const importedEntries = new Map(imported.entries.map((e) => [e.id, e] as const));
  for (const e of source.entries) {
    const other = importedEntries.get(e.id);
    if (!other) {
      problems.push(`ไม่พบรายการ ${e.id} ในข้อมูลออนไลน์`);
      continue;
    }
    const sameTime = e.createdAt === undefined || (other.createdAt !== undefined && Date.parse(other.createdAt) === Date.parse(e.createdAt));
    if (
      other.date !== e.date ||
      other.memo !== e.memo ||
      other.source !== e.source ||
      (other.groupId ?? null) !== (e.groupId ?? null) ||
      linkKey(other) !== linkKey(e) ||
      !sameTime ||
      linesKey(other) !== linesKey(e)
    ) {
      problems.push(`รายการ ${e.id} เนื้อหาไม่ตรง (วันที่/หมายเหตุ/ชนิด/กลุ่ม/ลิงก์บิล/เวลาบันทึก/บรรทัด)`);
    }
  }

  const importedBills = new Map(imported.bills.map((b) => [b.id, b] as const));
  for (const b of source.bills) {
    const other = importedBills.get(b.id);
    if (!other) {
      problems.push(`ไม่พบบิล ${b.id} ในข้อมูลออนไลน์`);
      continue;
    }
    if (
      other.name !== b.name ||
      other.amount !== b.amount ||
      other.dueDay !== b.dueDay ||
      other.lastPaidMonth !== b.lastPaidMonth ||
      other.startMonth !== b.startMonth ||
      other.walletId !== b.walletId ||
      other.categoryId !== b.categoryId ||
      (other.archived === true) !== (b.archived === true)
    ) {
      problems.push(`บิล ${b.name} (${b.id}) ชื่อ/ยอด/วันครบกำหนด/สถานะจ่าย/กระเป๋า/หมวดไม่ตรง`);
    }
  }

  // ของที่เกินมาฝั่งออนไลน์ (ไม่ควรมีหลังนำเข้า)
  const sourceAccounts = new Set(source.accounts.map((a) => a.id));
  const sourceEntries = new Set(source.entries.map((e) => e.id));
  const sourceBills = new Set(source.bills.map((b) => b.id));
  for (const a of imported.accounts) if (!sourceAccounts.has(a.id)) problems.push(`พบบัญชี ${a.id} ฝั่งออนไลน์ที่ไม่มีในต้นทาง`);
  for (const e of imported.entries) if (!sourceEntries.has(e.id)) problems.push(`พบรายการ ${e.id} ฝั่งออนไลน์ที่ไม่มีในต้นทาง`);
  for (const b of imported.bills) if (!sourceBills.has(b.id)) problems.push(`พบบิล ${b.id} ฝั่งออนไลน์ที่ไม่มีในต้นทาง`);

  if (source.settings !== undefined && imported.settings !== undefined && JSON.stringify(sortKeys(source.settings)) !== JSON.stringify(sortKeys(imported.settings))) {
    problems.push("ค่าตั้งค่าไม่ตรง");
  }

  return { ok: problems.length === 0, counts, balances, problems };
}
