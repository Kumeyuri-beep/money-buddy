/**
 * อ่านข้อความที่ OCR ได้จากสลิป K PLUS เป็นร่างรายจ่าย (ยังไม่บันทึก)
 *
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล/ตัวอ่านรูป รับเฉพาะ "ข้อความ" ที่ OCR ได้
 * ยอดเงินผ่าน parseBahtToSatang ที่นี่ (ขอบรับข้อมูลเข้าตามกฎ R2) แล้วคืนเป็นข้อความบาทให้ฟอร์ม
 * อ่านไม่ได้ให้ปล่อยว่าง ไม่เดามั่ว ผู้ใช้ตรวจและกรอกเองในฟอร์มก่อนบันทึกเสมอ
 */

import { addDays } from './dates';
import { counterOptions, walletOptions, type EntryForm } from './entryForm';
import type { Account } from '../domain/ledger/types';
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
  code: 'amount-too-large' | 'date-out-of-range' | 'maybe-transfer' | 'ocr-disagree';
  /** ข้อความภาษาไทยสำหรับแสดงในฟอร์ม */
  message: string;
  /** เฉพาะ maybe-transfer: กระเป๋าปลายทางที่เดาได้ (ใช้กับปุ่มสลับเป็นโอนเงิน) */
  transferToWalletId?: string;
}

export interface SlipDraft {
  form: EntryForm;
  /** สิ่งที่อ่าน/เดาไม่ได้ ผู้ใช้ต้องกรอกหรือเลือกเอง */
  missing: SlipMissing[];
  /** ค่าที่อ่านได้แต่ไม่สมเหตุสมผลจึงถูกทิ้ง (แสดงเตือนในฟอร์ม) */
  warnings: SlipWarning[];
  /** ชื่อผู้รับที่อ่านได้ ใช้ตรวจสลิปซ้ำตอนผู้ใช้แก้ฟอร์ม */
  recipient?: string;
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

/** สระบน/ล่าง วรรณยุกต์ และตัวการันต์ ที่ OCR ชอบแทรกเกินมา (เช่น "พ.ย." -> "พ.ุย.") */
const THAI_MARKS = /[ัิ-ฺ็-๎]/g;
const MONTHS_NO_MARKS = new Map<string, Set<number>>();
for (const [name, month] of Object.entries(MONTHS)) {
  const key = name.replace(THAI_MARKS, '');
  MONTHS_NO_MARKS.set(key, (MONTHS_NO_MARKS.get(key) ?? new Set<number>()).add(month));
}

/**
 * เลขเดือนจากคำที่ OCR อ่านได้: ตรงเป๊ะก่อน ถ้าไม่ตรงลองตัดเครื่องหมายที่เกินมา
 * และยอมรับเฉพาะเมื่อชี้ไปเดือนเดียว (ม.ค. กับ มี.ค. เหลือ "มค" เหมือนกัน จึงกำกวม ไม่เดา)
 */
function monthOf(token: string): number | undefined {
  const key = token.replace(/\./g, '').toLowerCase();
  const exact = MONTHS[key];
  if (exact) return exact;
  const candidates = MONTHS_NO_MARKS.get(key.replace(THAI_MARKS, ''));
  return candidates?.size === 1 ? [...candidates][0] : undefined;
}

/**
 * ยอดต้องเป็นทศนิยม 2 หลักเสมอ (สลิปแสดงแบบนี้) และต้องไม่ติดกับตัวเลขอื่นทั้งหน้าและหลัง
 * รูปแบบที่เพี้ยนจาก OCR (จุดหาย, ช่องว่างแทนจุลภาค, จุลภาคแทนจุด, ติดลบ, ติดตัวเลขถัดไป) จึงไม่ผ่าน -> ปล่อยว่างให้ผู้ใช้กรอก
 * แต่ไม่บังคับว่าต้องเป็นทั้งบรรทัด: สลิปจริงมีลายน้ำ/โลโก้ด้านขวา ทำให้ OCR ต่อตัวอักษรมั่วท้ายบรรทัดเสมอ
 * ความปลอดภัยมาจากกฎตำแหน่งใน findAmount (ค้นเฉพาะหลังป้าย "จำนวน" ก่อนป้ายถัดไป) และการปล่อยว่างเมื่อกำกวม
 */
const AMOUNT_BODY = String.raw`(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)\s?\.\s?(\d{2})(?!\d|[.,]\d)`;
// ห้ามนำหน้าด้วยตัวเลข/จุลภาค/จุด/ขีด หรือ "ตัวเลข+ช่องว่างกี่ช่องก็ได้" (กัน "4  800.00" "65,50" "-65.00") และไม่ขึ้นต้นด้วยศูนย์ ("003,900.00")
const AMOUNT_ANYWHERE = new RegExp(String.raw`(?<![\d,.\-])(?<!\d\s*)${AMOUNT_BODY}`, 'g');
/** โหมดสำรอง: ยอดต้องอยู่ต้นบรรทัด (มีได้แค่สัญลักษณ์นำหน้า เช่น "| 137.00") */
const AMOUNT_AT_LINE_START = new RegExp(String.raw`^[^\p{L}\p{N}]*${AMOUNT_BODY}`, 'u');
/** ค้นยอดหลังป้าย "จำนวน" ไม่เกินกี่บรรทัด (ไม่นับบรรทัดว่าง) */
const SEARCH_LINES_AFTER_LABEL = 6;
/** ป้ายที่ขึ้นหลังยอดบนสลิป ค้นยอดถึงตรงนี้เท่านั้น (ตัวเลขหลังป้ายเหล่านี้ไม่ใช่ยอด) */
const STOP_LABEL = /ค่าธรรมเนียม|เลขที่รายการ|เลขที่อ้างอิง|หมายเลข|รหัส/;
/** บรรทัดยอดคงเหลือ/ยอดรวม ไม่ใช่ยอดของรายการนี้ */
const BALANCE_LINE = /คงเหลือ|ยอดรวม|balance/i;
/** เวลาที่ OCR อ่านทวิภาคเป็นจุด ("14.23 น.") หรือเวลาปกติ ("14:23") ไม่ใช่ยอด */
const TIME_LIKE = /\d{1,2}[:.]\d{2}\s*น\.?|\d{1,2}:\d{2}/i;

function amountCandidates(lines: readonly string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(AMOUNT_ANYWHERE)) {
      const text = toAmountText(m[1], m[2]);
      if (text) found.push(text);
    }
  }
  return found;
}

/** เลือกยอด: ต้องมีค่าเดียวพอดี ถ้ามีหลายค่าที่ต่างกัน (กำกวม) ปล่อยว่าง ไม่เดา ("บาท" ไม่ใช่หลักฐานพอให้เลือกเอง) */
function pickAmount(candidates: readonly string[]): string | undefined {
  const all = new Set(candidates);
  return all.size === 1 ? [...all][0] : undefined;
}

/** OCR มักอ่านสระ ำ เป็น ํ + า และใส่ \r · เลขไทย ๐-๙ แปลงเป็นเลขอารบิก */
function normalize(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/ํา/g, 'ำ')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50));
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

/** label = อ่านจากป้าย "จำนวน" โดยตรง · fallback = เดาจากตำแหน่งเมื่อหาป้ายไม่เจอ (ความเชื่อถือต่ำกว่า) */
type AmountMode = 'label' | 'fallback';

function findAmount(lines: string[]): { amount?: string; mode: AmountMode } {
  const labelIdx = lines.findIndex((l) => /จำนวน/.test(l));
  if (labelIdx >= 0) {
    // ช่วงค้น: ส่วนที่เหลือของบรรทัดป้าย + ไม่เกิน 6 บรรทัดที่ไม่ว่างถัดไป หยุดที่ป้ายค่าธรรมเนียม/เลขที่รายการ/ยอดคงเหลือ
    const label = lines[labelIdx] ?? '';
    const window = [label.slice(label.search(/จำนวน/) + 'จำนวน'.length).replace(/^เงิน/, '')];
    let counted = 0;
    for (let i = labelIdx + 1; i < lines.length && counted < SEARCH_LINES_AFTER_LABEL; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') continue;
      if (STOP_LABEL.test(line) || BALANCE_LINE.test(line)) break;
      window.push(line);
      counted += 1;
    }
    const amount = pickAmount(amountCandidates(window));
    return amount ? { amount, mode: 'label' } : { mode: 'label' };
  }
  // หาป้าย "จำนวน" ไม่เจอ (OCR มักอ่านป้ายหรือคำว่า "บาท" เพี้ยน) เป็นการเดาที่เสี่ยงที่สุด จึงเข้มงวด:
  // เฉพาะส่วนก่อนป้ายค่าธรรมเนียม ตัวเลขทศนิยมต้องอยู่ต้นบรรทัด ไม่ใช่บรรทัดคงเหลือ/ป้ายอ้างอิง/วันที่/เวลา
  // และต้องมีค่าเดียวพอดี (ถ้าหลายค่าต่างกันปล่อยว่าง)
  const feeIdx = lines.findIndex((l) => /ค่าธรรมเนียม/.test(l));
  const usable = (feeIdx >= 0 ? lines.slice(0, feeIdx) : lines).filter(
    (l) => !BALANCE_LINE.test(l) && !STOP_LABEL.test(l) && !DATE_LIKE.test(l) && !TIME_LIKE.test(l),
  );
  const found: string[] = [];
  for (const line of usable) {
    const m = AMOUNT_AT_LINE_START.exec(line);
    const text = m ? toAmountText(m[1], m[2]) : undefined;
    if (text) found.push(text);
  }
  const amount = pickAmount(found);
  return amount ? { amount, mode: 'fallback' } : { mode: 'fallback' };
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
  const wordy = /(?<!\d)(\d{1,2})[ \t]+([ก-๙A-Za-z][ก-๙A-Za-z.]*)[ \t]*(\d{4}|\d{2})(?!\d)/g;
  for (const m of text.matchAll(wordy)) {
    const month = monthOf(m[2] ?? '');
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

/** คำที่อยู่ในบรรทัดสถานะ/ป้าย/เลขอ้างอิงของสลิป ไม่ใช่ชื่อคน/ร้าน */
const NOT_NAME_WORDS = /สำเร็จ|จำนวน|ค่าธรรมเนียม|เลขที่|หมายเลข|รหัส|สแกน|ตรวจสอบ|บาท|พร้อมเพย์|promptpay|k\s?plus/i;
/** บรรทัดที่ขึ้นต้นด้วยชื่อธนาคาร/สาขา (อยู่ใต้ชื่อผู้รับ) ไม่ใช่ชื่อ */
const NOT_NAME_START = /^\s*(?:ธ\.|ธนาคาร|kbank|scb|ttb|bbl|ktb|branch|สาขา|จาก\b|จาก\s)/i;
const DATE_LIKE = /\d{1,2}\s+[ก-๙A-Za-z.]{1,12}\s*(?:\d{4}|\d{2})(?!\d)/;

/**
 * บรรทัดนี้ดูเป็นชื่อคน/ร้านไหม คืนชื่อที่ตัดขยะท้ายบรรทัดแล้ว (ขยะจากลายน้ำถูกคั่นด้วยช่องว่างกว้าง 3 ช่องขึ้นไป)
 * ต้องเป็นตัวอักษรเป็นส่วนใหญ่ ไม่มีเลขเกิน 4 ตัว และไม่ใช่ป้าย/วันที่/ธนาคาร/เลขบัญชี
 */
function nameLike(line: string): string | undefined {
  // ตัดขยะท้ายบรรทัด และตัวเลข/เครื่องหมายขยะนำหน้าชื่อ (วงเล็บเปิดยังเก็บไว้)
  const seg = (line.split(/\s{3,}/)[0] ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[^ก-๎A-Za-z(]+/, '');
  if (seg.length < 4 || seg.length > 60) return undefined;
  if (NOT_NAME_WORDS.test(seg) || NOT_NAME_START.test(seg) || DATE_LIKE.test(seg) || seg.includes(':')) return undefined;
  const letters = (seg.match(/[ก-๎A-Za-z]/g) ?? []).length;
  const digits = (seg.match(/[0-9๐-๙]/g) ?? []).length;
  const compact = seg.replace(/\s/g, '').length;
  if (letters < 3 || letters / compact < 0.7 || digits > 4) return undefined;
  return seg;
}

/**
 * สลิปจริงไม่มีป้าย "ไปยัง": ลำดับคือ [ผู้โอน] [ผู้รับ/ร้านค้า] จำนวน ค่าธรรมเนียม ...
 * จึงเลือกบรรทัดที่ดูเป็นชื่อ "สุดท้าย" ก่อนป้ายจำนวน (หาไม่เจอใช้บรรทัดยอดทศนิยมแรก หรือป้ายค่าธรรมเนียม)
 * ไม่นับบรรทัดหลังยอดและขยะระหว่างป้ายกับยอด ชื่ออาจผิดได้ จึงใช้เป็นบันทึกช่วยจำที่ผู้ใช้ตรวจเสมอ
 */
function findRecipientByLayout(lines: string[]): string | undefined {
  const bound = [
    lines.findIndex((l) => /จำนวน/.test(l)),
    lines.findIndex((l) => /\d\s?\.\s?\d{2}/.test(l)),
    lines.findIndex((l) => /ค่าธรรมเนียม/.test(l)),
  ].find((i) => i >= 0);
  if (bound === undefined) return undefined; // ไม่มีจุดยึดเลย ไม่ใช่สลิป ไม่เดาชื่อจากข้อความมั่ว
  for (let i = bound - 1; i >= 0; i--) {
    const name = nameLike(lines[i] ?? '');
    if (name) return name;
  }
  return undefined;
}

interface ParsedSlip {
  fields: SlipFields;
  /** วิธีที่ได้ยอด (มีเมื่ออ่านยอดได้) ใช้ตอนรวมผลหลายรอบ */
  amountMode?: AmountMode;
}

/** อ่านข้อความสลิปรอบเดียว (ตัวที่ production ใช้ผ่าน parseSlipTexts) · export ให้เทสต์ตรวจตรงๆ */
export function parseSlipTextDetailed(raw: string): ParsedSlip {
  const text = normalize(raw);
  const lines = text.split('\n');
  const fields: SlipFields = {};
  const reading = findAmount(lines);
  const date = findDate(text);
  const time = findTime(text);
  const recipient = findRecipient(lines) ?? findRecipientByLayout(lines);
  if (reading.amount) fields.amount = reading.amount;
  if (date) fields.date = date;
  if (time) fields.time = time;
  if (recipient) fields.recipient = recipient;
  return reading.amount ? { fields, amountMode: reading.mode } : { fields };
}


const lowerTrim = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const CREDIT_CARD = /บัตรเครดิต|credit\s*card/i;

/**
 * ผู้รับที่น่าจะไม่ใช่รายจ่าย: โอนเข้ากระเป๋าของผู้ใช้เอง หรือจ่ายบัตรเครดิต (กฎ R4 ต้องบันทึกเป็นโอน)
 * แค่เตือน ไม่สลับประเภทให้ ผู้ใช้เป็นคนตัดสินใจ (ชื่อกระเป๋าสั้นกว่า 3 ตัวอักษรไม่ใช้เทียบ กันเดามั่ว)
 */
function detectMaybeTransfer(
  recipient: string,
  wallets: readonly Account[],
  fromWalletId: string,
): SlipWarning | undefined {
  const r = lowerTrim(recipient);
  const matches = wallets.filter((w) => w.name.trim().length >= 3 && r.includes(lowerTrim(w.name)));
  if (matches.length > 0) {
    const target = matches.find((w) => w.id !== fromWalletId);
    const name = (target ?? matches[0])?.name ?? '';
    const warning: SlipWarning = {
      code: 'maybe-transfer',
      message: `ผู้รับ "${recipient}" ตรงกับกระเป๋า "${name}" ของคุณ ถ้าเป็นการโอนระหว่างกระเป๋า ให้สลับเป็น "โอนเงิน" (จะไม่นับเป็นรายจ่าย)`,
    };
    if (target) warning.transferToWalletId = target.id;
    return warning;
  }
  if (CREDIT_CARD.test(recipient)) {
    return {
      code: 'maybe-transfer',
      message: 'ผู้รับดูเหมือนบัตรเครดิต ถ้าเป็นการจ่ายยอดบัตร ให้สลับเป็น "โอนเงิน" (จะไม่นับเป็นรายจ่าย)',
    };
  }
  return undefined;
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

  const transfer = fields.recipient ? detectMaybeTransfer(fields.recipient, wallets, walletId) : undefined;
  if (transfer) warnings.push(transfer);

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
    ...(fields.recipient ? { recipient: fields.recipient } : {}),
  };
}

/**
 * รวมผลอ่านจากหลายรอบ (OCR คนละวิธี) ทีละช่อง
 * ยอดและวันที่: ใช้เมื่อรอบที่อ่านได้ให้ค่าตรงกันทั้งหมด ถ้าขัดกันปล่อยว่างและรายงานใน conflicts (ไม่เลือกเอง เพราะเป็นเรื่องเงิน)
 * ยอดที่ได้จากโหมดสำรอง (เดาจากตำแหน่ง ไม่เจอป้าย "จำนวน") ใช้ได้เมื่อมีอย่างน้อยสองรอบอ่านได้ค่าเดียวกัน
 * หรือมีรอบหนึ่งอ่านจากป้ายโดยตรง เพราะสองรอบมาจากรูปเดียวกัน ความผิดพลาดของรอบเดียวจึงไม่มีหลักฐานอิสระมายืนยัน
 * เวลา: ใช้ค่าแรกที่อ่านได้ ผู้รับ: ใช้ชื่อที่ยาวกว่า
 */
export function parseSlipTexts(texts: readonly string[]): { fields: SlipFields; conflicts: ('amount' | 'date')[] } {
  const detailed = texts.map(parseSlipTextDetailed);
  const parsed = detailed.map((d) => d.fields);
  const fields: SlipFields = {};
  const conflicts: ('amount' | 'date')[] = [];

  const amounts = detailed.filter((d) => d.fields.amount);
  const amountValues = new Set(amounts.map((d) => d.fields.amount as string));
  if (amountValues.size > 1) conflicts.push('amount');
  else if (amountValues.size === 1 && (amounts.some((d) => d.amountMode === 'label') || amounts.length >= 2)) {
    fields.amount = [...amountValues][0] as string;
  }

  const dateValues = new Set(parsed.map((p) => p.date).filter((v): v is string => !!v));
  if (dateValues.size === 1) fields.date = [...dateValues][0] as string;
  else if (dateValues.size > 1) conflicts.push('date');

  const firstTime = parsed.map((p) => p.time).find((v): v is string => !!v);
  if (firstTime) fields.time = firstTime;
  // ผู้รับ: รอบที่อ่านพลาดมักได้แค่เศษสั้นๆ จึงเลือกชื่อที่ยาวกว่า (ยาวเท่ากันใช้ของรอบแรก)
  const names = parsed.map((p) => p.recipient).filter((v): v is string => !!v);
  const longest = names.reduce<string | undefined>((best, n) => (best === undefined || n.length > best.length ? n : best), undefined);
  if (longest) fields.recipient = longest;
  return { fields, conflicts };
}

const CONFLICT_LABEL = { amount: 'ยอดเงิน', date: 'วันที่' } as const;

/**
 * จากข้อความ OCR หลายรอบเป็นร่างฟอร์ม คืน null เมื่ออ่านอะไรที่เป็นสลิปไม่ได้เลย
 * (ไม่พบทั้งยอด วันที่ และผู้รับ และไม่มีค่าที่ขัดกัน เวลาอย่างเดียวไม่นับ)
 */
export function draftFromOcrTexts(texts: readonly string[], ctx: QuickContext): SlipDraft | null {
  const { fields, conflicts } = parseSlipTexts(texts);
  if (!fields.amount && !fields.date && !fields.recipient && conflicts.length === 0) return null;
  const draft = slipToDraft(fields, ctx);
  if (conflicts.length > 0) {
    draft.warnings.push({
      code: 'ocr-disagree',
      message: `อ่านรูปด้วยสองวิธีได้${conflicts.map((c) => CONFLICT_LABEL[c]).join('และ')}ไม่ตรงกัน จึงไม่เติมให้ กรุณาดูจากสลิปแล้วกรอกเอง`,
    });
  }
  return draft;
}

