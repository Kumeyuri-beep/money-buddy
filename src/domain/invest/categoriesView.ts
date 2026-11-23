/**
 * หน้า Portfolio → Categories (R2 · docs/proposals/R2-categories.md ข้อ 2, 4, 5) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * - เป้าเก็บเป็น bps จำนวนเต็ม (45% = 4,500) ข้อความเปอร์เซ็นต์ ↔ bps แปลงด้วยจำนวนเต็มล้วน ไม่มี float (R1)
 * - ร่างที่ผู้ใช้กำลังแก้ (CategoryState) → ตรวจด้วย categoriesProblem ตัวเดียวกับฐานข้อมูลก่อนส่ง saveCategories
 * - ตารางสรุปต่อหมวดใช้ totalsOf (holdingsView) และ allocateBps (allocation) ที่มีอยู่ ไม่คิดสูตรเงินใหม่ · แถวที่ไม่มีราคา = null ("—" ไม่เดา R20.7)
 * - ทุกแถวอยู่ในสกุลที่แสดงสกุลเดียว (แปลงต่อแถวใน buildHoldingsView แล้ว) จึงไม่บวกข้ามสกุล (R20)
 */

import { allocateBps } from './allocation';
import { categoriesProblem, validSector, type CategoryProblem } from './categories';
import type { DisplayCurrency } from './displayCurrency';
import { totalsOf, type HoldingRow } from './holdingsView';
import { CATEGORY_TARGET_TOTAL_BPS, MAX_CATEGORIES, type Asset, type AssetCategory } from './types';

/** 11 กลุ่มของ GICS ให้เลือกตอนเพิ่มหุ้น (พิมพ์เองได้) */
export const GICS_SECTORS: readonly string[] = [
  'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Energy', 'Financials', 'Health Care',
  'Industrials', 'Information Technology', 'Materials', 'Real Estate', 'Utilities',
];

export const UNCATEGORIZED_ID = '__uncategorized__';
export const UNCATEGORIZED_NAME = 'Uncategorized';

/** สัดส่วนจริงห่างเป้าไม่เกินค่านี้ (bps) = "on target" · ใช้ป้ายแสดงผลอย่างเดียว ไม่นำไปคำนวณยอดเงิน */
export const ON_TARGET_BPS = 150;

const fmtBps = (bps: number): string => {
  const frac = bps % 100;
  const whole = (bps - frac) / 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
};

/** 4500 → "45" · 750 → "7.5" · 9999 → "99.99" (จำนวนเต็มล้วน) */
export function bpsToPercentText(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > CATEGORY_TARGET_TOTAL_BPS) throw new RangeError(`bps ไม่ถูกต้อง: ${String(bps)}`);
  return fmtBps(bps);
}

export type PercentParse = { kind: 'empty' } | { kind: 'ok'; bps: number } | { kind: 'invalid' };

/** "7.5" → 750 bps · ว่าง = ไม่ตั้งเป้า · รับเลขไม่ติดลบทศนิยมไม่เกิน 2 ตำแหน่ง ช่วง 0-100 เท่านั้น */
export function percentTextToBps(text: string): PercentParse {
  const t = text.trim();
  if (t === '') return { kind: 'empty' };
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { kind: 'invalid' };
  const bps = Number(m[1]) * 100 + (m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0')));
  return bps > CATEGORY_TARGET_TOTAL_BPS ? { kind: 'invalid' } : { kind: 'ok', bps };
}

/** หมวดที่กำลังแก้ (เป้าเป็นข้อความที่ผู้ใช้พิมพ์ · ว่าง = ไม่ตั้ง) */
export interface CategoryDraft {
  id: string;
  name: string;
  targetText: string;
}

/** ร่างทั้งหน้า: หมวดตามลำดับ + สินทรัพย์ → หมวด (ไม่มีคีย์ = Uncategorized) */
export interface CategoryState {
  drafts: CategoryDraft[];
  assign: Record<string, string>;
}

export type TargetStatus = 'none' | 'invalid' | 'partial' | 'under' | 'over' | 'ok';

export interface DraftTotals {
  status: TargetStatus;
  setCount: number;
  totalBps: number;
  /** ผลรวม − 100% (bps) · ลบ = ขาด บวก = เกิน · ไม่ตั้งเป้าเลย = 0 */
  diffBps: number;
}

/** สรุปเป้ารวมของร่าง: none = ไม่ตั้งเลย (บันทึกได้) · ok = 100% พอดี · อื่นๆ บันทึกไม่ได้ */
export function draftTotals(drafts: readonly CategoryDraft[]): DraftTotals {
  let set = 0;
  let total = 0;
  let invalid = false;
  for (const d of drafts) {
    const p = percentTextToBps(d.targetText);
    if (p.kind === 'invalid') invalid = true;
    else if (p.kind === 'ok') {
      set += 1;
      total += p.bps;
    }
  }
  const diff = set === 0 ? 0 : total - CATEGORY_TARGET_TOTAL_BPS;
  const status: TargetStatus = invalid ? 'invalid' : set === 0 ? 'none' : set !== drafts.length ? 'partial' : diff < 0 ? 'under' : diff > 0 ? 'over' : 'ok';
  return { status, setCount: set, totalBps: total, diffBps: diff };
}

export type DraftProblem = CategoryProblem;

export type DraftsResult = { ok: true; categories: AssetCategory[] } | { ok: false; problem: DraftProblem };

/** ร่าง → หมวดที่ส่งได้ (ลำดับ = ตำแหน่ง) · ตรวจด้วย categoriesProblem ตัวเดียวกับฐานข้อมูล */
export function draftsToCategories(drafts: readonly CategoryDraft[]): DraftsResult {
  const categories: AssetCategory[] = [];
  for (const [i, d] of drafts.entries()) {
    const p = percentTextToBps(d.targetText);
    if (p.kind === 'invalid') return { ok: false, problem: 'target' };
    categories.push({ id: d.id, name: d.name.trim(), targetBps: p.kind === 'ok' ? p.bps : null, sortOrder: i });
  }
  const problem = categoriesProblem(categories);
  return problem === null ? { ok: true, categories } : { ok: false, problem };
}

const idsOf = (drafts: readonly CategoryDraft[]): Set<string> => new Set(drafts.map((d) => d.id));

export function addDraftCategory(s: CategoryState, id: string, name: string): CategoryState {
  if (s.drafts.length >= MAX_CATEGORIES || idsOf(s.drafts).has(id)) return s;
  return { ...s, drafts: [...s.drafts, { id, name, targetText: '' }] };
}

/** ลบหมวด: สินทรัพย์ในหมวดนั้นกลับเป็น Uncategorized */
export function removeCategory(s: CategoryState, id: string): CategoryState {
  const assign: Record<string, string> = {};
  for (const [a, c] of Object.entries(s.assign)) if (c !== id) assign[a] = c;
  return { drafts: s.drafts.filter((d) => d.id !== id), assign };
}

/** เลื่อนหมวดขึ้น (-1) หรือลง (+1) · ชนขอบ = ไม่เปลี่ยน */
export function moveCategory(s: CategoryState, id: string, dir: -1 | 1): CategoryState {
  const i = s.drafts.findIndex((d) => d.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= s.drafts.length) return s;
  const drafts = [...s.drafts];
  [drafts[i], drafts[j]] = [drafts[j]!, drafts[i]!];
  return { ...s, drafts };
}

/** รวมหมวด: ย้ายสินทรัพย์ทั้งหมดของ from ไป into · เป้ารวมกัน (ทั้งคู่ตั้ง) หรือใช้ฝั่งที่ตั้ง · แล้วลบ from */
export function mergeCategories(s: CategoryState, fromId: string, intoId: string): CategoryState {
  const from = s.drafts.find((d) => d.id === fromId);
  const into = s.drafts.find((d) => d.id === intoId);
  if (!from || !into || fromId === intoId) return s;
  const a = percentTextToBps(from.targetText);
  const b = percentTextToBps(into.targetText);
  let targetText = into.targetText;
  if (a.kind === 'ok' && b.kind === 'ok') targetText = fmtBps(a.bps + b.bps);
  else if (a.kind === 'ok' && b.kind === 'empty') targetText = from.targetText;
  const assign: Record<string, string> = {};
  for (const [asset, c] of Object.entries(s.assign)) assign[asset] = c === fromId ? intoId : c;
  return { drafts: s.drafts.filter((d) => d.id !== fromId).map((d) => (d.id === intoId ? { ...d, targetText } : d)), assign };
}

/**
 * สร้างหมวดจาก sector ของสินทรัพย์ที่ถืออยู่ (ปุ่ม "Create categories from sectors")
 * จัดกลุ่มไม่สนตัวพิมพ์ (ใช้ตัวสะกดของตัวแรก) · ใช้หมวดเดิมที่ชื่อตรงกัน (คงเป้าเดิม) · หมวดใหม่เรียงตามชื่อ เป้าว่าง · ไม่มี sector = ไม่เปลี่ยนหมวดของสินทรัพย์นั้น
 * ไม่เกิน MAX_CATEGORIES (ส่วนเกินถูกตัด) · ผลเป็นร่าง ผู้ใช้ตั้งเป้าครบ 100% แล้วจึง Save
 */
export function fromSectors(s: CategoryState, assets: readonly Asset[], heldIds: ReadonlySet<string>, makeId: () => string): CategoryState {
  const byKey = new Map<string, { name: string; assetIds: string[] }>();
  for (const a of assets) {
    if (!heldIds.has(a.id) || !validSector(a.sector)) continue;
    const key = a.sector.toLowerCase();
    const g = byKey.get(key);
    if (g) g.assetIds.push(a.id);
    else byKey.set(key, { name: a.sector, assetIds: [a.id] });
  }
  if (byKey.size === 0) return s;
  const drafts = [...s.drafts];
  const assign = { ...s.assign };
  const existing = new Map(drafts.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const groups = [...byKey.entries()].sort((x, y) => (x[1].name < y[1].name ? -1 : x[1].name > y[1].name ? 1 : 0));
  for (const [key, g] of groups) {
    let id = existing.get(key);
    if (id === undefined) {
      if (drafts.length >= MAX_CATEGORIES) continue;
      id = makeId();
      drafts.push({ id, name: g.name, targetText: '' });
      existing.set(key, id);
    }
    for (const assetId of g.assetIds) assign[assetId] = id;
  }
  return { drafts, assign };
}

/** ร่างเริ่มต้นจากข้อมูลที่บันทึกไว้ */
export function stateFromData(assets: readonly Asset[], categories: readonly AssetCategory[]): CategoryState {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = new Set(sorted.map((c) => c.id));
  const assign: Record<string, string> = {};
  for (const a of assets) if (a.categoryId !== undefined && ids.has(a.categoryId)) assign[a.id] = a.categoryId;
  return { drafts: sorted.map((c) => ({ id: c.id, name: c.name, targetText: c.targetBps === null ? '' : bpsToPercentText(c.targetBps) })), assign };
}

export interface SaveAssignment {
  assetId: string;
  categoryId: string | null;
}

export type SavePlan = { ok: true; categories: AssetCategory[]; assignments: SaveAssignment[] } | { ok: false; problem: DraftProblem };

/** ร่าง → ข้อมูลที่ส่ง saveCategories · assignments เฉพาะสินทรัพย์ที่หมวดเปลี่ยนจากที่บันทึกไว้ (null = ล้างหมวด) */
export function stateToSave(s: CategoryState, assets: readonly Asset[]): SavePlan {
  const r = draftsToCategories(s.drafts);
  if (!r.ok) return r;
  const assignments: SaveAssignment[] = [];
  for (const a of assets) {
    const next = s.assign[a.id] ?? null;
    if (next !== (a.categoryId ?? null)) assignments.push({ assetId: a.id, categoryId: next });
  }
  return { ok: true, categories: r.categories, assignments };
}

export type TargetCompare = 'none' | 'on' | 'over' | 'under';

export interface CategoryTableRow {
  /** UNCATEGORIZED_ID = สินทรัพย์ที่ไม่มีหมวด */
  id: string;
  name: string;
  /** จำนวนสินทรัพย์ที่ยังถืออยู่ (ไม่นับที่ขายหมดแล้ว) */
  count: number;
  /** null = มีสินทรัพย์ในหมวดที่ไม่มีราคา/เรต (รวมไม่ครบ ไม่นับเป็น 0) */
  value: number | null;
  cost: number | null;
  unrealized: number | null;
  unrealizedBps: number | null;
  /** สัดส่วนมูลค่า (bps รวม 10,000 ทั้งตาราง) · null = มูลค่าบางหมวดไม่ครบหรือรวม 0 */
  weightBps: number | null;
  targetBps: number | null;
  /** สัดส่วนจริง − เป้า (bps) · null = ไม่มีเป้าหรือไม่มีสัดส่วน */
  diffBps: number | null;
  status: TargetCompare;
  complete: boolean;
  /** ความยาวแถบ vs. target (หน่วย 1/10,000 ของความกว้างราง) · สเกลเดียวกันทั้งตาราง = ค่ามากสุดของสัดส่วน/เป้า · สัดส่วน > 0 แต่เล็กมากได้ไม่ต่ำกว่า MIN_BAR_BPS · null = ไม่มีสัดส่วน */
  barBps: number | null;
  /** ตำแหน่งขีดเป้าบนรางเดียวกัน · null = ไม่มีเป้า */
  markBps: number | null;
}

/** แถบที่มีสัดส่วนจริงแต่เล็กมากยังต้องมองเห็น (2.5% ของราง) */
export const MIN_BAR_BPS = 250;
const divInt = (a: number, b: number): number => (a - (a % b)) / b;

/** ตารางสรุปต่อหมวด (ข้อมูลที่บันทึกแล้ว) · rows = แถวถือครองจาก buildHoldingsView ในสกุลที่แสดง */
export function buildCategoryTable(rows: readonly HoldingRow[], assets: readonly Asset[], categories: readonly AssetCategory[], currency: DisplayCurrency): CategoryTableRow[] {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const known = new Set(sorted.map((c) => c.id));
  const catOf = new Map(assets.map((a) => [a.id, a.categoryId !== undefined && known.has(a.categoryId) ? a.categoryId : UNCATEGORIZED_ID]));
  const groups: { id: string; name: string; targetBps: number | null; rows: HoldingRow[] }[] = sorted.map((c) => ({ id: c.id, name: c.name, targetBps: c.targetBps, rows: [] }));
  const none: HoldingRow[] = [];
  for (const r of rows) {
    if (r.sold) continue;
    const id = catOf.get(r.assetId) ?? UNCATEGORIZED_ID;
    (groups.find((g) => g.id === id)?.rows ?? none).push(r);
  }
  if (none.length > 0) groups.push({ id: UNCATEGORIZED_ID, name: UNCATEGORIZED_NAME, targetBps: null, rows: none });

  const totals = groups.map((g) => totalsOf(g.rows, currency));
  const values = totals.map((t) => t.value);
  let weights: Map<string, number> | null = null;
  if (values.every((v) => v !== null)) {
    const shares = allocateBps(groups.map((g, i) => ({ key: g.id, weight: values[i] as number })));
    weights = new Map(shares.map((s) => [s.key, s.bps]));
    if (shares.length === 0) weights = null;
  }
  let scale = 1;
  for (const g of groups) {
    const w = weights?.get(g.id) ?? 0;
    scale = Math.max(scale, w, g.targetBps ?? 0);
  }
  return groups.map((g, i) => {
    const t = totals[i]!;
    const weightBps = weights === null ? null : (weights.get(g.id) ?? 0);
    const diffBps = weightBps === null || g.targetBps === null ? null : weightBps - g.targetBps;
    const status: TargetCompare = diffBps === null ? 'none' : Math.abs(diffBps) <= ON_TARGET_BPS ? 'on' : diffBps > 0 ? 'over' : 'under';
    return {
      id: g.id, name: g.name, count: g.rows.length, value: t.value, cost: t.cost, unrealized: t.unrealized, unrealizedBps: t.unrealizedBps,
      weightBps, targetBps: g.targetBps, diffBps, status, complete: t.complete,
      barBps: weightBps === null ? null : weightBps === 0 ? 0 : Math.max(MIN_BAR_BPS, divInt(weightBps * CATEGORY_TARGET_TOTAL_BPS, scale)),
      markBps: g.targetBps === null ? null : divInt(g.targetBps * CATEGORY_TARGET_TOTAL_BPS, scale),
    };
  });
}
