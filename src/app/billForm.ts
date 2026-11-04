import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { isValidIsoDate } from '../domain/ledger/entry';
import { parseBahtToSatang, toBahtString, satang } from '../domain/money/satang';

export class BillFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillFormError';
  }
}

export interface BillForm {
  name: string;
  /** บาท (ข้อความจากผู้ใช้) */
  amount: string;
  dueDay: string;
  walletId: string;
  categoryId: string;
}

export interface SettingsForm {
  payDay: string;
  monthlySavingsGoal: string;
  monthlyBudget: string;
  /** วันเงินเดือนถัดไปที่กำหนดเอง YYYY-MM-DD (ว่าง/ไม่มี = ไม่ใช้) */
  nextPaydayOverride?: string;
}

/** ยอดบาทจากข้อความ -> สตางค์ (R2: แปลงที่ขอบฟอร์มจุดเดียว) ไม่ติดลบ ข้อความผิดโยน BillFormError */
function parseAmount(text: string, label: string): number {
  try {
    const value = parseBahtToSatang(text);
    if (value < 0) throw new BillFormError(`${label}ต้องไม่ติดลบ`);
    return value;
  } catch (error) {
    if (error instanceof BillFormError) throw error;
    if (error instanceof RangeError) throw new BillFormError(`${label}ใหญ่เกินไป`);
    throw new BillFormError(`อ่าน${label}ไม่ได้ ใส่เป็นตัวเลข เช่น 599 หรือ 599.50`);
  }
}

function parseDay(text: string, label: string): number {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t) || Number(t) < 1 || Number(t) > 31) {
    throw new BillFormError(`${label}ต้องเป็นเลข 1-31`);
  }
  return Number(t);
}

/** ฟอร์มบิล -> บิล (ไม่ใส่ lastPaidMonth/startMonth: repository จัดการเอง) */
export function billFromForm(form: BillForm, id: string): Bill {
  const name = form.name.trim();
  if (name === '') throw new BillFormError('ใส่ชื่อบิล');
  const amount = parseAmount(form.amount, 'ยอดบิล');
  if (amount <= 0) throw new BillFormError('ยอดบิลต้องมากกว่า 0');
  const bill: Bill = { id, name, amount, dueDay: parseDay(form.dueDay, 'วันครบกำหนด') };
  if (form.walletId !== '') bill.walletId = form.walletId;
  if (form.categoryId !== '') bill.categoryId = form.categoryId;
  return bill;
}

export function billToForm(bill: Bill): BillForm {
  return {
    name: bill.name,
    amount: toBahtString(satang(bill.amount)),
    dueDay: String(bill.dueDay),
    walletId: bill.walletId ?? '',
    categoryId: bill.categoryId ?? '',
  };
}

/** ช่องว่าง = ไม่ตั้งค่านั้น */
export function settingsFromForm(form: SettingsForm): FinanceSettings {
  const out: FinanceSettings = {};
  if (form.payDay.trim() !== '') out.payDay = parseDay(form.payDay, 'วันเงินเดือนเข้า');
  if (form.monthlySavingsGoal.trim() !== '') out.monthlySavingsGoal = parseAmount(form.monthlySavingsGoal, 'เป้าออม');
  if (form.monthlyBudget.trim() !== '') out.monthlyBudget = parseAmount(form.monthlyBudget, 'เป้างบ');
  const override = form.nextPaydayOverride?.trim() ?? '';
  if (override !== '') {
    if (!isValidIsoDate(override)) throw new BillFormError('วันเงินเดือนถัดไปต้องเป็นวันที่ที่มีจริง');
    out.nextPaydayOverride = override;
  }
  return out;
}

export function settingsToForm(settings: FinanceSettings): SettingsForm {
  return {
    payDay: settings.payDay === undefined ? '' : String(settings.payDay),
    monthlySavingsGoal: settings.monthlySavingsGoal === undefined ? '' : toBahtString(satang(settings.monthlySavingsGoal)),
    monthlyBudget: settings.monthlyBudget === undefined ? '' : toBahtString(satang(settings.monthlyBudget)),
    ...(settings.nextPaydayOverride !== undefined ? { nextPaydayOverride: settings.nextPaydayOverride } : {}),
  };
}
