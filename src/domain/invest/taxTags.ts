/**
 * ป้ายภาษีของสินทรัพย์ในพอร์ต (ภาษี เฟส 3 · กฎ R19): ผู้ใช้เลือกเองว่าสินทรัพย์ไหนเป็น RMF หรือ Thai ESG (ค่าเริ่มต้นไม่ติดป้าย)
 * เก็บเฉพาะ "รหัสสินทรัพย์" (ข้อมูลเข้า) ใน settings.taxRmfAssetIds / settings.taxThaiEsgAssetIds แบบเดียวกับ retirementAssetIds
 *   - อยู่ในไฟล์สำรองและถูกลบพร้อมข้อมูลผู้ใช้โดยอัตโนมัติ ไม่มี migration (settings เป็น jsonb ก้อนเดียว)
 *   - รหัสของสินทรัพย์ที่ถูกลบแล้วไม่ใช่ข้อผิดพลาด: ตอนใช้งานข้ามเงียบๆ (นับเป็น missing)
 *   - สินทรัพย์หนึ่งติดป้ายได้ประเภทเดียว (ซ้อน RMF กับ Thai ESG ไม่ได้)
 *   - เพดานต่อประเภทเท่ากับ MAX_RETIREMENT_ASSETS เพราะ settings ทั้งก้อนต้องไม่เกิน 16 KB (ตัวตรวจขนาดรวมอยู่ใน settingsProblem)
 */

import { MAX_RETIREMENT_ASSETS, sanitizeRetirementAssetIds } from './retirementSelection';
import { hasDbInvalidChars, lengthWithin, MAX_ID_LENGTH } from '../ledger/limits';

export const MAX_TAX_TAGGED_ASSETS = MAX_RETIREMENT_ASSETS;

export type TaxTag = 'rmf' | 'thaiEsg';

const validId = (v: unknown): v is string => typeof v === 'string' && !hasDbInvalidChars(v) && lengthWithin(v, 1, MAX_ID_LENGTH);

/** อ่านค่าจากภายนอกแบบไม่เชื่อ: เก็บเฉพาะรหัสที่ถูกต้อง ไม่ซ้ำ ไม่เกินเพดาน */
export function sanitizeTaxTagIds(raw: unknown): string[] {
  return sanitizeRetirementAssetIds(raw);
}

function listProblem(ids: unknown, label: string): string | null {
  if (!Array.isArray(ids)) return `ป้าย ${label} ต้องเป็นอาร์เรย์`;
  if (ids.length > MAX_TAX_TAGGED_ASSETS) return `ติดป้าย ${label} ได้ไม่เกิน ${MAX_TAX_TAGGED_ASSETS} สินทรัพย์`;
  const seen = new Set<string>();
  for (const id of ids) {
    if (!validId(id)) return `ป้าย ${label} มีรหัสที่ไม่ถูกต้อง`;
    if (seen.has(id)) return `ป้าย ${label} มีรหัสซ้ำ`;
    seen.add(id);
  }
  return null;
}

/** เหตุผลที่ป้ายผิดรูป (null = ใช้ได้) · ใช้ก่อนบันทึก/ตรวจไฟล์นำเข้า */
export function taxTagsProblem(rmf: unknown, thaiEsg: unknown): string | null {
  const a = listProblem(rmf, 'RMF');
  if (a) return a;
  const b = listProblem(thaiEsg, 'Thai ESG');
  if (b) return b;
  const rmfIds = new Set(rmf as string[]);
  for (const id of thaiEsg as string[]) {
    if (rmfIds.has(id)) return 'สินทรัพย์หนึ่งติดป้ายได้ประเภทเดียว มีสินทรัพย์ที่ติดทั้ง RMF และ Thai ESG';
  }
  return null;
}
