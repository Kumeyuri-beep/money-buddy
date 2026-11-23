/**
 * ส่งออก/นำเข้าหมวดและเป้า % (R2 Categories · ข้อ 5) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * - ส่งออก CSV (อ่านด้วยตา/Excel · ข้อความผ่าน csvText กัน formula injection) และ JSON (นำกลับเข้ามาได้)
 * - นำเข้า JSON: ตรวจรูปแบบเข้มก่อน (ชนิด · ขนาด · จำนวน) แล้วสร้างเป็นร่างให้ผู้ใช้ตรวจ/แก้/Save เอง (ไม่เขียนฐานข้อมูลตรงๆ)
 *   ผ่าน draftsToCategories → categoriesProblem ตัวเดียวกับฐานข้อมูล · หุ้นจับคู่ด้วย ticker (ไม่สนตัวพิมพ์) · ไม่พบ = ข้ามและนับให้
 * - เป้าในไฟล์เป็นข้อความเปอร์เซ็นต์ ("7.5") ไม่ใช้ float (R1) · ข้อความผิดพลาดไม่ใส่เนื้อหาไฟล์
 */

import { bpsToPercentText, draftsToCategories, percentTextToBps, UNCATEGORIZED_NAME, type CategoryDraft, type CategoryState, type DraftProblem } from './categoriesView';
import { CATEGORY_TEXT_UNSAFE } from './categories';
import { csvText } from './reportRows';
import { MAX_CATEGORIES, type Asset, type AssetCategory } from './types';

export const CATEGORIES_FILE_FORMAT = 'money-buddy-categories';
export const CATEGORIES_FILE_VERSION = 1;
/** เพดานของไฟล์ที่นำเข้า (ตัวอักษร) และจำนวนการจับคู่หุ้น */
export const CATEGORIES_FILE_MAX_CHARS = 200_000;
export const CATEGORIES_FILE_MAX_ASSIGNMENTS = 500;

const label = (a: Asset): string => (a.ticker !== undefined && a.ticker !== '' ? a.ticker : a.name);

/** CSV: Category, Target (%), Stocks · หมวดว่างเป้า = ช่องว่าง · หุ้นไม่มีหมวดไม่ถูกส่งออก (ไม่ใช่หมวด) */
export function buildCategoriesCsv(categories: readonly AssetCategory[], assets: readonly Asset[]): string {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = [['Category', 'Target (%)', 'Stocks'].map(csvText).join(',')];
  for (const c of sorted) {
    const stocks = assets.filter((a) => a.categoryId === c.id).map(label).join('; ');
    lines.push([csvText(c.name), c.targetBps === null ? '' : bpsToPercentText(c.targetBps), csvText(stocks)].join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const categoriesCsvFilename = (asOf: string): string => `categories-${asOf}.csv`;
export const categoriesJsonFilename = (asOf: string): string => `categories-${asOf}.json`;

/** JSON ที่นำกลับเข้ามาได้ (เรียงตามลำดับหมวด) · หุ้นที่อยู่ในหมวดเท่านั้น */
export function buildCategoriesJson(categories: readonly AssetCategory[], assets: readonly Asset[]): string {
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const names = new Map(sorted.map((c) => [c.id, c.name]));
  const assignments = assets
    .filter((a) => a.categoryId !== undefined && names.has(a.categoryId) && a.ticker !== undefined && a.ticker !== '')
    .map((a) => ({ ticker: a.ticker as string, category: names.get(a.categoryId as string) as string }));
  return `${JSON.stringify({
    format: CATEGORIES_FILE_FORMAT,
    version: CATEGORIES_FILE_VERSION,
    categories: sorted.map((c) => ({ name: c.name, target: c.targetBps === null ? null : bpsToPercentText(c.targetBps) })),
    assignments,
  }, null, 2)}\n`;
}

export type ImportProblem = 'size' | 'json' | 'format' | 'version' | 'shape' | 'tooMany' | DraftProblem;

export const IMPORT_PROBLEM_TEXT: Record<'size' | 'json' | 'format' | 'version' | 'shape' | 'tooMany', string> = {
  size: 'The file is too large.',
  json: 'The file is not valid JSON.',
  format: 'This is not a Money Buddy categories file.',
  version: 'This file was made by a newer version and cannot be imported.',
  shape: 'The file has a missing or invalid field. Export a fresh file and try again.',
  tooMany: 'The file has too many categories or stocks.',
};

export type ImportResult =
  | { ok: true; state: CategoryState; skippedTickers: number }
  | { ok: false; problem: ImportProblem };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** นำเข้า JSON เป็นร่าง (ไม่เขียนฐานข้อมูล) · makeId สร้างรหัสหมวดใหม่ · assets = หุ้นของผู้ใช้ที่ใช้จับคู่ ticker */
export function parseCategoriesJson(text: string, assets: readonly Asset[], makeId: () => string): ImportResult {
  if (text.length > CATEGORIES_FILE_MAX_CHARS) return { ok: false, problem: 'size' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'json' };
  }
  if (!isRecord(raw) || raw['format'] !== CATEGORIES_FILE_FORMAT) return { ok: false, problem: 'format' };
  if (raw['version'] !== CATEGORIES_FILE_VERSION) return { ok: false, problem: 'version' };
  const cats = raw['categories'];
  const assigns = raw['assignments'];
  if (!Array.isArray(cats) || !Array.isArray(assigns)) return { ok: false, problem: 'shape' };
  if (cats.length > MAX_CATEGORIES || assigns.length > CATEGORIES_FILE_MAX_ASSIGNMENTS) return { ok: false, problem: 'tooMany' };

  const drafts: CategoryDraft[] = [];
  const idByName = new Map<string, string>();
  for (const c of cats) {
    if (!isRecord(c) || typeof c['name'] !== 'string') return { ok: false, problem: 'shape' };
    const t = c['target'];
    let targetText = '';
    if (t === null || t === undefined) targetText = '';
    else if (typeof t === 'string') targetText = t;
    else if (typeof t === 'number' && Number.isFinite(t)) targetText = String(t);
    else return { ok: false, problem: 'shape' };
    if (percentTextToBps(targetText).kind === 'invalid') return { ok: false, problem: 'target' };
    const name = c['name'].trim();
    const id = makeId();
    drafts.push({ id, name, targetText: targetText.trim() });
    idByName.set(name.toLowerCase(), id);
  }
  // ตรวจชุดหมวดทั้งก้อนด้วยกฎเดียวกับฐานข้อมูล (ชื่อ ซ้ำ เป้ารวม 100%)
  const checked = draftsToCategories(drafts);
  if (!checked.ok) return { ok: false, problem: checked.problem };

  const byTicker = new Map<string, string>();
  for (const a of assets) if (a.ticker !== undefined && a.ticker !== '') byTicker.set(a.ticker.toLowerCase(), a.id);
  const assign: Record<string, string> = {};
  let skipped = 0;
  for (const a of assigns) {
    if (!isRecord(a) || typeof a['ticker'] !== 'string' || typeof a['category'] !== 'string') return { ok: false, problem: 'shape' };
    if (CATEGORY_TEXT_UNSAFE.test(a['ticker'])) return { ok: false, problem: 'shape' };
    const assetId = byTicker.get(a['ticker'].trim().toLowerCase());
    const catId = idByName.get(a['category'].trim().toLowerCase());
    if (assetId === undefined || a['category'].trim().toLowerCase() === UNCATEGORIZED_NAME.toLowerCase()) {
      skipped += 1;
      continue;
    }
    if (catId === undefined) return { ok: false, problem: 'shape' };
    assign[assetId] = catId;
  }
  return { ok: true, state: { drafts, assign }, skippedTickers: skipped };
}
