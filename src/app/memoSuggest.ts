/**
 * บันทึกช่วยจำแบบเดาคำ (ฟีดแบ็กใช้งานจริง 14 พ.ย. 2569)
 * พิมพ์ตั้งแต่ 1 ตัวอักษรในช่อง "บันทึกช่วยจำ" → แสดงข้อความเก่าที่ขึ้นต้นหรือมีคำนั้น จากรายการของผู้ใช้คนนั้นเท่านั้น (รายการที่โหลดมาแล้วของบัญชีนี้)
 * เรียง: "ขึ้นต้นด้วยคำที่พิมพ์" ก่อน "มีคำนั้นอยู่กลางข้อความ" แล้วตามจำนวนครั้งที่ใช้ → ล่าสุด · ไม่เกิน 5 รายการ
 * ถ้าข้อความนั้นเคยใช้กับหมวดเดียวกันทุกครั้ง (ประเภทเดียวกัน) ส่งหมวดนั้นมาให้ตั้งอัตโนมัติ · **ไม่มีจำนวนเงินในผลลัพธ์เลย** (ไม่เติมยอดให้)
 * คำนวณในเครื่องล้วน (ฟังก์ชันล้วน ไม่แตะเครือข่าย/DOM/ฐานข้อมูล) · ข้อความที่ผู้ใช้ลบเก็บเฉพาะใน localStorage ของเครื่อง แยกตามชื่อผู้ใช้
 */
import type { Account, Entry } from '../domain/ledger/types';
import { entryToForm, type FormKind } from './entryForm';

/** จำนวนคำแนะนำสูงสุดที่แสดง */
export const MAX_SUGGESTIONS = 5;
/** ข้อความที่ยาวกว่านี้ไม่เสนอเป็นคำแนะนำ (ที่เก็บรายการที่ลบมีเพดานความยาวต่อข้อความ) */
export const MAX_SUGGEST_LENGTH = 200;
/** จำนวนข้อความที่ผู้ใช้ลบไว้สูงสุดในเครื่อง (เก่าสุดหลุดก่อน) */
export const MAX_HIDDEN_MEMOS = 200;

export interface MemoStat {
  key: string;
  /** ข้อความตามที่ใช้ล่าสุด */
  text: string;
  count: number;
  /** วันที่+เวลาบันทึกล่าสุด (ใช้เรียง) */
  last: string;
  /** หมวดที่ใช้ทุกครั้ง (ไม่มี = เคยใช้หลายหมวด หรือประเภทย้ายเงิน) */
  counterId: string | null;
}

export interface MemoSuggestion {
  key: string;
  text: string;
  counterId: string | null;
}

export type MemoIndex = Record<FormKind, MemoStat[]>;

/** กุญแจเทียบข้อความ: ตัดช่องว่างหัวท้าย รวมช่องว่างซ้อน ตัวพิมพ์เล็ก */
export function memoKey(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('th');
}

interface Acc {
  stat: MemoStat;
  mixed: boolean;
}

/** สร้างดัชนีจากรายการที่โหลดแล้ว: ไม่รวมยอดยกมาของระบบ ข้อความว่าง และรายการที่ฟอร์มรู้จักไม่ได้ (ไม่มีหมวดให้เดา) */
export function buildMemoIndex(accounts: readonly Account[], entries: readonly Entry[]): MemoIndex {
  const byKind: Record<FormKind, Map<string, Acc>> = { expense: new Map(), income: new Map(), transfer: new Map() };
  for (const entry of entries) {
    if (entry.source === 'system') continue;
    const text = String(entry.memo ?? '').trim().replace(/\s+/g, ' ');
    if (text === '' || text.length > MAX_SUGGEST_LENGTH) continue;
    const form = entryToForm(accounts, entry);
    if (!form) continue;
    const key = memoKey(text);
    const last = `${entry.date}|${entry.createdAt ?? ''}`;
    const map = byKind[form.kind];
    const found = map.get(key);
    if (!found) {
      map.set(key, { stat: { key, text, count: 1, last, counterId: form.kind === 'transfer' ? null : form.counterId }, mixed: form.kind === 'transfer' });
      continue;
    }
    found.stat.count += 1;
    if (found.stat.counterId !== form.counterId) found.mixed = true;
    if (last >= found.stat.last) {
      found.stat.last = last;
      found.stat.text = text;
    }
  }
  const finish = (map: Map<string, Acc>): MemoStat[] => [...map.values()].map(({ stat, mixed }) => ({ ...stat, counterId: mixed ? null : stat.counterId }));
  return { expense: finish(byKind.expense), income: finish(byKind.income), transfer: finish(byKind.transfer) };
}

/** คำแนะนำสำหรับข้อความที่พิมพ์อยู่ (ว่าง/ช่องว่างล้วน = ไม่มี) */
export function suggestMemos(stats: readonly MemoStat[], query: string, hidden: ReadonlySet<string>, limit: number = MAX_SUGGESTIONS): MemoSuggestion[] {
  const q = memoKey(query);
  if (q === '') return [];
  const scored: { stat: MemoStat; prefix: boolean }[] = [];
  for (const stat of stats) {
    if (hidden.has(stat.key) || stat.key === q) continue;
    const at = stat.key.indexOf(q);
    if (at < 0) continue;
    scored.push({ stat, prefix: at === 0 });
  }
  scored.sort((a, b) => Number(b.prefix) - Number(a.prefix) || b.stat.count - a.stat.count || (a.stat.last < b.stat.last ? 1 : a.stat.last > b.stat.last ? -1 : 0) || a.stat.key.localeCompare(b.stat.key, 'th'));
  return scored.slice(0, limit).map(({ stat }) => ({ key: stat.key, text: stat.text, counterId: stat.counterId }));
}

// ---- ข้อความที่ผู้ใช้ลบ (เก็บในเครื่องเท่านั้น ไม่ส่งขึ้นเซิร์ฟเวอร์) ----

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

const hiddenKey = (user: string): string => `mb.hiddenMemos.${user}`;

export function loadHiddenMemos(user: string, storage?: ReadStorage): Set<string> {
  try {
    const raw = (storage ?? window.localStorage).getItem(hiddenKey(user));
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_SUGGEST_LENGTH).slice(-MAX_HIDDEN_MEMOS));
  } catch {
    return new Set();
  }
}

export function saveHiddenMemos(user: string, hidden: ReadonlySet<string>, storage?: WriteStorage): void {
  try {
    (storage ?? window.localStorage).setItem(hiddenKey(user), JSON.stringify([...hidden].slice(-MAX_HIDDEN_MEMOS)));
  } catch {
    /* เก็บไม่ได้ (โหมดส่วนตัว/ปิดการเก็บ) ก็ใช้ในหน้านี้ต่อได้ */
  }
}

/** เพิ่มข้อความที่ลบ (ผลลัพธ์ใหม่ ไม่แก้ชุดเดิม) · เกินเพดาน เก่าสุดหลุดก่อน */
export function hideMemo(hidden: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(hidden);
  next.delete(key); // ให้ตัวที่เพิ่งลบอยู่ท้ายสุด (ใหม่สุด)
  next.add(key);
  return new Set([...next].slice(-MAX_HIDDEN_MEMOS));
}
