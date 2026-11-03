/**
 * อ่านข้อความที่ OCR ได้จากสลิป K PLUS เป็นร่างรายจ่าย (ยังไม่บันทึก)
 *
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/ตัวอ่านรูป รับเฉพาะ "ข้อความ" ที่ OCR ได้
 * ยอดเงินผ่าน parseBahtToSatang ที่นี่ (ขอบรับข้อมูลเข้าตามกฎ R2) แล้วคืนเป็นข้อความบาทให้ฟอร์ม
 * อ่านไม่ได้ให้ปล่อยว่าง ไม่เดามั่ว ผู้ใช้ตรวจและกรอกเองในฟอร์มก่อนบันทึกเสมอ
 */

import { addDays } from './dates';
import { counterOptions, walletOptions, type EntryForm } from './entryForm';
import { guessCategory, type QuickContext } from './quickText';
import { isValidIsoDate } from '../domain/ledger/entry';
import { parseBahtToSatang, toBahtString } from '../domain/money/satang';

export interface SlipFields {
  /** ข้อความบาท เช่น "1,234.50" */
  amount?: string;
  /** YYYY-MM-DD (ค.ศ.) */
  date?: string;
  /** HH:MM */
  time?: string;
  recipient?: string;
}

export type SlipMissing = 'amount' | 'date' | 'category';

export interface SlipWarning {
  code: 'amount-too-large' | 'date-out-of-range';
  /** ข้อความภาษาไทยสำหรับแสดงในฟอร์ม */
  message: string;
}

export interface SlipDraft {
  form: EntryForm;
  /** สิ่งที่อ่าน/เดาไม่ได้ ผู้ใช้ต้องกรอกหรือเลือกเอง */
  missing: SlipMissing[];
  /** ค่าที่อ่านได้แต่ไม่สมเหตุสมผลจึงถูกทิ้ง (แสดงเตือนในฟอร์ม) */
  warnings: SlipWarning[];
}

/** ชื่อเดือนที่ตัดจุดและช่องว่างออกแล้ว -> เลขเดือน */
const MONTHS: Record<string, number> = {};
[
  ['มค', 'มกราคม', 'jan', 'january'],
  ['กพ', 'กุมภาพันธ์', 'feb', 'february'],
  ['มีค', 'มีนาคม', 'mar', 'march'],
  ['เมย', 'เมษายน', 'apr', 'april'],
  ['พค', 'พฤษภาคม', 'may'],
  ['มิย', 'มิถุนายน', 'jun', 'june'],
  ['กค', 'กรกฎาคม', 'jul', 'july'],
  ['สค', 'สิงหาคม', 'aug', 'august'],
  ['กย', 'กันยายน', 'sep', 'sept', 'september'],
  ['ตค', 'ตุลาคม', 'oct', 'october'],
  ['พย', 'พฤศจิกายน', 'nov', 'november'],
  ['ธค', 'ธันวาคม', 'dec', 'december'],
].forEach((names, i) => {
  for (const n of names) MONTHS[n] = i + 1;
});

/**
 * สลิปแสดงยอดเป็นทศนิยม 2 หลักเสมอ และยอดต้องเป็นทั้งบรรทัด (มี ":" นำหน้าและ "บาท" ตามหลังได้เท่านั้น)
 * รูปแบบที่เพี้ยนจาก OCR (จุดหาย, ช่องว่างแทนจุลภาค, จุลภาคแทนจุด, ติดลบ) จึงไม่ผ่าน -> ปล่อยว่างให้ผู้ใช้กรอก
 */
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+|\d+)\s?\.\s?(\d{2})`;
const AMOUNT_LINE = new RegExp(String.raw`^\s*[:：]?\s*฿?\s*${AMOUNT}\s*(?:บาท)?\s*$`);
const AMOUNT_LINE_BAHT = new RegExp(String.raw`^\s*฿?\s*${AMOUNT}\s*บาท\s*$`);

/** OCR มักอ่านสระ ำ เป็น ํ + า และใส่ \r */
function normalize(text: string): string {
  return text.replace(/\r/g, '').replace(/ํา/g, 'ำ');
}

/** แปลงตัวเลขที่จับได้เป็นข้อความบาท ถ้าอ่านไม่ได้หรือ <= 0 คืน undefined */
function toAmountText(whole: string | undefined, frac: string | undefined): string | undefined {
  if (!whole) return undefined;
  try {
    const value = parseBahtToSatang(frac ? `${whole}.${frac}` : whole);
    return value > 0 ? toBahtString(value) : undefined;
  } catch {
    return undefined;
  }
}

function findAmount(lines: string[]): string | undefined {
  const labelIdx = lines.findIndex((l) => /จำนวน/.test(l));
  if (labelIdx >= 0) {
    const line = lines[labelIdx] ?? '';
    const afterLabel = line.slice(line.search(/จำนวน/) + 'จำนวน'.length).replace(/^เงิน/, '');
    // ไม่มีอะไรหลังป้าย: ยอดอยู่บรรทัดถัดไป ซึ่งต้องเป็นยอดล้วนๆ (ไม่ใช่ป้ายอื่นที่มีตัวเลข)
    const target = /^[\s:：]*$/.test(afterLabel)
      ? (lines.slice(labelIdx + 1).find((l) => l.trim() !== '') ?? '')
      : afterLabel;
    const m = AMOUNT_LINE.exec(target);
    return m ? toAmountText(m[1], m[2]) : undefined;
  }
  // ไม่มีป้าย: ใช้บรรทัดที่เป็น "ยอด บาท" ล้วนๆ ถ้ามีตัวเดียวพอดี (ไม่นับยอดที่ตามหลังป้ายค่าธรรมเนียม)
  const found = new Set<string>();
  let prev = '';
  for (const line of lines) {
    if (line.trim() === '') continue;
    const afterFeeLabel = /ค่าธรรมเนียม\s*[:：]?\s*$/.test(prev);
    prev = line;
    if (afterFeeLabel) continue;
    const m = AMOUNT_LINE_BAHT.exec(line);
    const text = m ? toAmountText(m[1], m[2]) : undefined;
    if (text) found.add(text);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

function toYear(raw: string): number {
  const n = Number(raw);
  if (raw.length <= 2) return 1957 + n; // 69 -> พ.ศ. 2569 -> ค.ศ. 2026
  return n >= 2400 ? n - 543 : n;
}

function toIso(year: number, month: number, day: number): string | undefined {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidIsoDate(iso) ? iso : undefined;
}

function findDate(text: string): string | undefined {
  // [ \t] ไม่ใช่ \s เพื่อไม่ให้ข้ามบรรทัดไปกินตัวเลขของวันที่จริง
  const wordy = /(\d{1,2})[ \t]+([ก-๙A-Za-z][ก-๙A-Za-z.]*)[ \t]*(\d{4}|\d{2})(?!\d)/g;
  for (const m of text.matchAll(wordy)) {
    const month = MONTHS[(m[2] ?? '').replace(/\./g, '').toLowerCase()];
    if (!month) continue;
    const iso = toIso(toYear(m[3] ?? ''), month, Number(m[1]));
    if (iso) return iso;
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/g)) {
    const iso = toIso(toYear(m[3] ?? ''), Number(m[2]), Number(m[1]));
    if (iso) return iso;
  }
  return undefined;
}

function findTime(text: string): string | undefined {
  for (const m of text.matchAll(/(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 24 && min < 60) return `${String(h).padStart(2, '0')}:${m[2]}`;
  }
  return undefined;
}

const RECIPIENT_LABEL = /^\s*(?:ไปยัง|ไปที่|ผู้รับ|ถึง)\s*:?\s*(.*)$/;
const OTHER_LABEL = /^\s*(?:จำนวน|ค่าธรรมเนียม|เลขที่|จาก)/;
const ONLY_ACCOUNT_LIKE = /^[\dxX*\-\s]+$/;

function findRecipient(lines: string[]): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const m = RECIPIENT_LABEL.exec(lines[i] ?? '');
    if (!m) continue;
    let value = (m[1] ?? '').trim();
    if (value === '') {
      const next = (lines[i + 1] ?? '').trim();
      if (next === '' || OTHER_LABEL.test(next)) return undefined;
      value = next;
    }
    value = value.replace(/\s+/g, ' ').slice(0, 60);
    return ONLY_ACCOUNT_LIKE.test(value) ? undefined : value;
  }
  return undefined;
}

export function parseSlipText(raw: string): SlipFields {
  const text = normalize(raw);
  const lines = text.split('\n');
  const fields: SlipFields = {};
  const amount = findAmount(lines);
  const date = findDate(text);
  const time = findTime(text);
  const recipient = findRecipient(lines);
  if (amount) fields.amount = amount;
  if (date) fields.date = date;
  if (time) fields.time = time;
  if (recipient) fields.recipient = recipient;
  return fields;
}

/** เพดานยอดต่อสลิป (เจ้าของกำหนด 3 พ.ย. 2569) เกินนี้ถือว่า OCR อ่านผิด */
export const SLIP_MAX_SATANG = 10_000_000 * 100;
/** สลิปที่เก่ากว่านี้ (วัน นับจากวันนี้) หรืออยู่ในอนาคตถือว่าอ่านผิด */
export const SLIP_MAX_AGE_DAYS = 365;

/** สลิปคือรายจ่าย: เติมฟอร์มเท่าที่อ่านได้ เวลาใส่ใน memo เพราะฟอร์มไม่มีช่องเวลา */
export function slipToDraft(rawFields: SlipFields, ctx: QuickContext): SlipDraft {
  const warnings: SlipWarning[] = [];
  const fields = { ...rawFields };

  if (fields.amount && parseBahtToSatang(fields.amount) > SLIP_MAX_SATANG) {
    warnings.push({
      code: 'amount-too-large',
      message: 'ยอดเงินในสลิปสูงเกิน 10,000,000 บาท น่าจะอ่านผิด จึงไม่เติมให้ กรุณากรอกยอดเอง',
    });
    delete fields.amount;
  }
  if (fields.date && (fields.date > ctx.today || fields.date < addDays(ctx.today, -SLIP_MAX_AGE_DAYS))) {
    warnings.push({
      code: 'date-out-of-range',
      message: `วันที่ในสลิป (${fields.date}) อยู่ในอนาคตหรือเก่ากว่า 1 ปี น่าจะอ่านผิด จึงใช้วันนี้แทน กรุณาตรวจวันที่`,
    });
    delete fields.date;
  }

  const wallets = walletOptions(ctx.accounts);
  const last = ctx.learned?.lastWallet.expense;
  const walletId = (last && wallets.some((w) => w.id === last) ? last : wallets[0]?.id) ?? '';

  const memoTokens = fields.recipient ? fields.recipient.split(/\s+/) : [];
  const counterId = guessCategory('expense', counterOptions(ctx.accounts, 'expense', walletId), memoTokens, ctx.learned);

  const memo = [fields.recipient, fields.time ? `${fields.time} น.` : undefined].filter(Boolean).join(' ');

  const missing: SlipMissing[] = [];
  if (!fields.amount) missing.push('amount');
  if (!fields.date) missing.push('date');
  if (!counterId) missing.push('category');

  return {
    form: {
      kind: 'expense',
      date: fields.date ?? ctx.today,
      amount: fields.amount ?? '',
      walletId,
      counterId,
      memo,
    },
    missing,
    warnings,
  };
}
