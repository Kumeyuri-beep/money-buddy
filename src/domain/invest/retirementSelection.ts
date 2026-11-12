/**
 * การเลือกสินทรัพย์ที่นับเป็นเงินเกษียณ (เกษียณ เฟส 2b · กฎ R18 ข้อ 18.8) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 *   - เก็บเฉพาะ "รหัสสินทรัพย์ที่ผู้ใช้เลือก" (ข้อมูลเข้า) ใน settings.retirementAssetIds · ไม่เก็บมูลค่า/ความคืบหน้า/ผลลัพธ์ (R16)
 *   - รวมในไฟล์สำรองและถูกลบพร้อมข้อมูลของผู้ใช้โดยอัตโนมัติ (เหมือน settings.dcaPlans) · ข้อมูลแยกต่อผู้ใช้ด้วย RLS ของตาราง settings
 *   - รหัสที่สินทรัพย์ถูกลบไปแล้วไม่ใช่ข้อผิดพลาด: ตอนใช้งานข้ามไปเงียบๆ (ดู initialRetirementSelection)
 *   - เพดานน้อยกว่า MAX_DCA_PLANS เพราะ settings ทั้งก้อนต้องไม่เกิน 16 KB (check ของตาราง) และใช้ร่วมกับแผน DCA
 */

import { hasDbInvalidChars, lengthWithin, MAX_ID_LENGTH } from '../ledger/limits';

export const MAX_RETIREMENT_ASSETS = 30;

const validId = (v: unknown): v is string => typeof v === 'string' && !hasDbInvalidChars(v) && lengthWithin(v, 1, MAX_ID_LENGTH);

/** อ่านค่าจากภายนอก (ฐานข้อมูล/ไฟล์) แบบไม่เชื่อ: เก็บเฉพาะรหัสที่ถูกต้อง ไม่ซ้ำ ไม่เกินเพดาน (เรียงตามเดิม) */
export function sanitizeRetirementAssetIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_RETIREMENT_ASSETS) break;
    if (!validId(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** เหตุผลที่รายการผิดรูป (null = ใช้ได้) · ใช้ก่อนบันทึก/ตรวจไฟล์นำเข้า: ปฏิเสธ ไม่ตัดเงียบ */
export function retirementAssetIdsProblem(ids: readonly unknown[]): string | null {
  if (!Array.isArray(ids)) return 'การเลือกสินทรัพย์เกษียณต้องเป็นอาร์เรย์';
  if (ids.length > MAX_RETIREMENT_ASSETS) return `การเลือกสินทรัพย์เกษียณมีได้ไม่เกิน ${MAX_RETIREMENT_ASSETS} รายการ`;
  const seen = new Set<string>();
  for (const id of ids) {
    if (!validId(id)) return 'การเลือกสินทรัพย์เกษียณมีรหัสที่ไม่ถูกต้อง';
    if (seen.has(id)) return 'การเลือกสินทรัพย์เกษียณมีรหัสซ้ำ';
    seen.add(id);
  }
  return null;
}
