/**
 * อ่านข้อความสั้นๆ เช่น "กาแฟ 65" เป็นร่างรายการ (ยังไม่บันทึก)
 *
 * รูปแบบที่เข้าใจ:
 *   กาแฟ 65                          รายจ่าย (หมวดเดาจากคำ หรือจากที่เคยบันทึก)
 *   เงินเดือน 17000 เข้า Mainframe   รายรับ เข้ากระเป๋าที่ระบุ
 *   โอน 2500 ไป Vault                โอนเงิน (ต้นทางเป็นกระเป๋าที่ใช้ล่าสุด)
 *   โอน Mainframe Vault 2500         กระเป๋าที่เขียนก่อนคือต้นทาง
 *   เมื่อวาน กาแฟ 45                 ระบุวัน (วันนี้ เมื่อวาน เมื่อวานซืน)
 *   +500 ขายของ / -65 ข้าว           เครื่องหมายหน้าจำนวนบอกว่ารายรับ/รายจ่าย
 *
 * ผลลัพธ์ผ่านตัวสร้างรายการ buildEntry อีกชั้นก่อนบันทึกเสมอ ที่นี่เดาแล้วให้ผู้ใช้ตรวจ
 * ถ้าเดาไม่ได้จะบอกใน missing แทนการเดามั่ว
 */

import { addDays } from './dates';
import { counterOptions, entryToForm, walletOptions, type EntryForm, type FormKind } from './entryForm';
import type { Account, Entry } from '../domain/ledger/types';
import { parseBahtToSatang, toBahtString } from '../domain/money/satang';

export interface Learned {
  /** `${kind}:${คำ}` -> รหัสหมวด (ครั้งล่าสุดที่ใช้) */
  tokens: Map<string, string>;
  /** กระเป๋าที่ใช้ล่าสุดของแต่ละประเภท (โอน = ต้นทาง) */
  lastWallet: Partial<Record<FormKind, string>>;
}

export interface QuickContext {
  accounts: readonly Account[];
  /** YYYY-MM-DD ของวันนี้ (ส่งเข้ามาเพื่อให้เทสต์ได้) */
  today: string;
  learned?: Learned;
}

export type Missing = 'category' | 'destination';

export interface QuickDraft {
  form: EntryForm;
  /** สิ่งที่เดาไม่ได้ ผู้ใช้ต้องเลือกก่อนบันทึก (counterId จะเป็น '') */
  missing: Missing[];
}

export type QuickResult = { ok: true; draft: QuickDraft } | { ok: false; message: string; empty: boolean };

const AMOUNT = /^([+-])?฿?(\d[\d,]*(?:\.\d+)?|\.\d+)(?:฿|บาท)?$/;

const DATE_WORDS: Record<string, number> = { วันนี้: 0, เมื่อวาน: -1, เมื่อวานนี้: -1, เมื่อวานซืน: -2 };
const FROM_MARKERS = new Set(['จาก']);
const TO_MARKERS = new Set(['ไป', 'ไปที่', 'เข้า', 'เข้าที่', 'ใส่']);
const INCOME_WORDS = ['เงินเดือน', 'โบนัส', 'ปันผล', 'รายรับ', 'ค่าจ้าง', 'รับเงิน', 'เงินคืน', 'ขายของ'];

/** คำที่ขึ้นต้นด้วยคำเหล่านี้ใช้เดาหมวดได้ ค่าเป็นรหัสหมวดตามที่หน้าตั้งต้นสร้างให้ (ไม่มีรหัสนั้นก็ข้าม) */
const PREFIX_HINTS: [string, string[]][] = [
  ['expense-food', ['กาแฟ', 'ข้าว', 'อาหาร', 'ขนม', 'ก๋วยเตี๋ยว', 'ชานม', 'เครื่องดื่ม', 'ส้มตำ', 'หมูกระทะ']],
  ['expense-transport', ['แท็กซี่', 'taxi', 'grab', 'bolt', 'น้ำมัน', 'รถไฟฟ้า', 'เดินทาง', 'ทางด่วน', 'จอดรถ']],
  ['expense-housing', ['ค่าเช่า', 'ค่าห้อง', 'ค่าไฟ', 'ค่าน้ำ', 'ค่าเน็ต', 'ค่าคอนโด', 'ค่าส่วนกลาง']],
  ['expense-shopping', ['ช้อปปิ้ง', 'shopee', 'lazada', 'รองเท้า', 'ซื้อของ', 'ของใช้']],
  ['expense-fun', ['netflix', 'youtube', 'spotify', 'คอนเสิร์ต', 'บันเทิง']],
  ['expense-interest', ['ดอกเบี้ย']],
  ['income-salary', ['เงินเดือน', 'โบนัส']],
  ['income-other', ['ปันผล', 'ขายของ', 'เงินคืน', 'ค่าจ้าง']],
];
/** คำสั้นที่ต้องตรงทั้งคำ (ไม่ใช้ขึ้นต้น เพราะจะชนกับคำอื่น) */
const EXACT_HINTS: [string, string[]][] = [
  ['expense-food', ['ชา', 'น้ำ', 'กิน']],
  ['expense-transport', ['bts', 'mrt', 'วิน', 'รถเมล์']],
  ['expense-fun', ['หนัง', 'เกม']],
];

const lower = (s: string) => s.toLowerCase();

/** เรียนรู้จากรายการที่เคยบันทึก (เก่าไปใหม่ ค่าล่าสุดชนะ) ใช้เดาหมวดและกระเป๋าเริ่มต้น */
export function learnFromHistory(accounts: readonly Account[], entries: readonly Entry[]): Learned {
  const tokens = new Map<string, string>();
  const lastWallet: Partial<Record<FormKind, string>> = {};
  for (const entry of entries) {
    if (entry.source === 'system') continue;
    const form = entryToForm(accounts, entry);
    if (!form) continue;
    lastWallet[form.kind] = form.walletId;
    if (form.kind === 'transfer') continue;
    for (const word of form.memo.split(/\s+/)) {
      if (word.length >= 2 && !AMOUNT.test(word)) tokens.set(`${form.kind}:${lower(word)}`, form.counterId);
    }
  }
  return { tokens, lastWallet };
}

interface WalletMention {
  walletId: string;
  role: 'from' | 'to' | 'none';
}

/** หาชื่อกระเป๋าในข้อความ (ชื่อเต็ม หรือคำแรกของชื่อ ถ้าไม่ซ้ำ) แล้วตัดออกพร้อมคำนำหน้า (จาก/ไป/เข้า) */
function extractWallets(
  tokens: string[],
  wallets: readonly Account[],
): { rest: string[]; mentions: WalletMention[] } {
  const firstWords = wallets.map((w) => lower(w.name.split(/\s+/)[0] ?? ''));
  const candidates: { name: string; walletId: string }[] = [];
  wallets.forEach((w, i) => {
    candidates.push({ name: lower(w.name), walletId: w.id });
    const first = firstWords[i] ?? '';
    if (first.length >= 3 && first !== lower(w.name) && firstWords.filter((f) => f === first).length === 1) {
      candidates.push({ name: first, walletId: w.id });
    }
  });
  candidates.sort((a, b) => b.name.split(' ').length - a.name.split(' ').length || b.name.length - a.name.length);

  let words = [...tokens];
  const mentions: WalletMention[] = [];
  const used = new Set<string>();

  for (const c of candidates) {
    if (used.has(c.walletId)) continue;
    const parts = c.name.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
      if (!parts.every((p, j) => lower(words[i + j] ?? '') === p)) continue;
      const prev = lower(words[i - 1] ?? '');
      const role: WalletMention['role'] = FROM_MARKERS.has(prev) ? 'from' : TO_MARKERS.has(prev) ? 'to' : 'none';
      const start = role === 'none' ? i : i - 1;
      mentions.push({ walletId: c.walletId, role });
      used.add(c.walletId);
      words = [...words.slice(0, start), ...words.slice(i + parts.length)];
      break;
    }
  }
  // เรียงตามลำดับที่เขียนในข้อความไม่ได้เก็บไว้ จึงเก็บลำดับการค้นพบ (ชื่อยาวก่อน) ไม่เหมาะกับ "โอน A B"
  return { rest: words, mentions };
}

/** ตำแหน่งของคำที่ถูกพบ ใช้จัดลำดับกระเป๋าที่ไม่มีคำนำหน้าให้ตรงกับลำดับที่ผู้ใช้เขียน */
function orderMentions(tokens: string[], mentions: WalletMention[], wallets: readonly Account[]): WalletMention[] {
  const joined = ` ${tokens.map(lower).join(' ')} `;
  const position = (m: WalletMention) => {
    const w = wallets.find((x) => x.id === m.walletId);
    if (!w) return Number.MAX_SAFE_INTEGER;
    const full = joined.indexOf(` ${lower(w.name)} `);
    if (full >= 0) return full;
    const first = joined.indexOf(` ${lower(w.name.split(/\s+/)[0] ?? '')} `);
    return first >= 0 ? first : Number.MAX_SAFE_INTEGER;
  };
  return [...mentions].sort((a, b) => position(a) - position(b));
}

function guessCategory(
  kind: FormKind,
  options: readonly Account[],
  memoTokens: string[],
  learned: Learned | undefined,
): string {
  const has = (id: string) => options.some((o) => o.id === id);
  const words = memoTokens.map(lower).filter(Boolean);

  // 1) พิมพ์ชื่อหมวดมาเอง (หรือคำที่ลงท้ายด้วยชื่อหมวด เช่น "ค่าอาหาร")
  for (const word of words) {
    const hit = options.find((o) => word === lower(o.name) || word.includes(lower(o.name)));
    if (hit) return hit.id;
  }
  // 2) เคยบันทึกคำนี้มาก่อน
  for (const word of words) {
    const id = learned?.tokens.get(`${kind}:${word}`);
    if (id && has(id)) return id;
  }
  // 3) คำที่รู้จักทั่วไป
  for (const word of words) {
    for (const [id, list] of PREFIX_HINTS) {
      if (has(id) && list.some((k) => word.startsWith(k))) return id;
    }
    for (const [id, list] of EXACT_HINTS) {
      if (has(id) && list.includes(word)) return id;
    }
  }
  return '';
}

export function parseQuickText(input: string, ctx: QuickContext): QuickResult {
  const text = input.trim();
  if (text === '') return { ok: false, message: '', empty: true };
  const fail = (message: string): QuickResult => ({ ok: false, message, empty: false });

  const tokens = text.split(/\s+/);

  // จำนวนเงิน: ต้องมีตัวเดียว
  const amountIdx = tokens.flatMap((t, i) => (AMOUNT.test(t) ? [i] : []));
  if (amountIdx.length === 0) return fail('ไม่พบจำนวนเงิน ลองพิมพ์ เช่น กาแฟ 65');
  if (amountIdx.length > 1) return fail('พบตัวเลขมากกว่าหนึ่งตัว ให้เหลือเฉพาะจำนวนเงิน');
  const amountToken = tokens[amountIdx[0] ?? 0] ?? '';
  const match = AMOUNT.exec(amountToken);
  const sign = match?.[1];
  let amountSatang: number;
  try {
    amountSatang = parseBahtToSatang(match?.[2] ?? '');
  } catch (error) {
    return fail(error instanceof RangeError ? 'จำนวนเงินใหญ่เกินไป' : 'อ่านจำนวนเงินไม่ได้');
  }
  if (amountSatang <= 0) return fail('จำนวนเงินต้องมากกว่า 0');

  let rest = tokens.filter((_, i) => i !== amountIdx[0]);
  if (lower(rest[amountIdx[0] ?? 0] ?? '') === 'บาท') rest.splice(amountIdx[0] ?? 0, 1); // "65 บาท"

  // วันที่
  let date = ctx.today;
  rest = rest.filter((t) => {
    const offset = DATE_WORDS[t];
    if (offset === undefined) return true;
    date = addDays(ctx.today, offset);
    return false;
  });

  // ประเภท
  let kind: FormKind = 'expense';
  const transferIdx = rest.findIndex((t) => t.startsWith('โอน'));
  if (transferIdx >= 0) {
    kind = 'transfer';
    rest.splice(transferIdx, 1);
  } else if (sign === '+') {
    kind = 'income';
  } else if (sign === '-') {
    kind = 'expense';
  } else if (rest.some((t) => INCOME_WORDS.some((w) => lower(t).includes(w)))) {
    kind = 'income';
  }

  // กระเป๋า
  const wallets = walletOptions(ctx.accounts);
  if (wallets.length === 0) return fail('ยังไม่มีกระเป๋าเงิน');
  const { rest: afterWallets, mentions: found } = extractWallets(rest, wallets);
  const mentions = orderMentions(rest, found, wallets);
  const defaultWalletId =
    (ctx.learned?.lastWallet[kind] && wallets.some((w) => w.id === ctx.learned?.lastWallet[kind])
      ? ctx.learned?.lastWallet[kind]
      : undefined) ?? wallets[0]?.id ?? '';

  const missing: Missing[] = [];
  let walletId = defaultWalletId;
  let counterId = '';
  const memoTokens = afterWallets;

  if (kind === 'transfer') {
    let from = mentions.find((m) => m.role === 'from')?.walletId;
    let to = mentions.find((m) => m.role === 'to')?.walletId;
    const unmarked = mentions.filter((m) => m.role === 'none').map((m) => m.walletId);
    if (!from && !to) {
      if (unmarked.length >= 2) [from, to] = [unmarked[0], unmarked[1]];
      else if (unmarked.length === 1) to = unmarked[0];
    } else if (!from) from = unmarked[0];
    else if (!to) to = unmarked[0];
    walletId = from ?? defaultWalletId;
    const options = counterOptions(ctx.accounts, 'transfer', walletId);
    // ถ้าปลายทางเป็นกระเป๋าเดียวกับต้นทาง (หรือไม่ได้ระบุ) ให้ผู้ใช้เลือกเอง
    counterId = to && options.some((o) => o.id === to) ? to : '';
    if (!counterId) missing.push('destination');
  } else {
    walletId = mentions[0]?.walletId ?? defaultWalletId;
    counterId = guessCategory(kind, counterOptions(ctx.accounts, kind, walletId), memoTokens, ctx.learned);
    if (!counterId) missing.push('category');
  }

  return {
    ok: true,
    draft: {
      form: {
        kind,
        date,
        amount: toBahtString(parseBahtToSatang(match?.[2] ?? '')),
        walletId,
        counterId,
        memo: memoTokens.join(' '),
      },
      missing,
    },
  };
}
