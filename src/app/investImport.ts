import { emptyInvestments, isEmptyInvestments, type InvestmentData } from '../domain/invest/types';
import type { LedgerRepository } from '../storage/ledgerRepository';

/**
 * สถานะข้อมูลลงทุนออนไลน์เทียบกับไฟล์สำรอง ก่อนลองนำเข้าขั้นนี้ใหม่ (แผน 2026-11-27-import-invest-retry)
 * match = เข้าครบแล้ว · not_imported = ยังไม่เข้า (มีได้แค่หมวดค้าง ซึ่งต้องให้ผู้ใช้ยืนยันก่อนลบ) · different = มีข้อมูลที่ไม่ตรง ห้ามลบหรือทับ
 */
export type InvestImportState = 'match' | 'not_imported' | 'different';

/** แถวทั้งชุดเป็นข้อความคงที่: ไม่ขึ้นกับลำดับแถวหรือลำดับคีย์ · ฟิลด์ที่ไม่มีค่าถูกตัดทิ้ง · เทียบค่าตรงตัว (จำนวนเต็มและข้อความ) */
const canonical = (rows: readonly object[] = []): string =>
  JSON.stringify(rows.map((row) => JSON.stringify(Object.entries(row).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)))).sort());

const KEYS = ['assets', 'trades', 'prices', 'fxRates', 'fxExchanges', 'categories'] as const;

export function investImportState(file: InvestmentData | undefined, online: InvestmentData): InvestImportState {
  const source = file ?? emptyInvestments();
  if (KEYS.every((k) => canonical(source[k]) === canonical(online[k]))) return 'match';
  return isEmptyInvestments({ ...online, categories: [] }) ? 'not_imported' : 'different';
}

/** อ่านออนไลน์แล้วเทียบ · ผลว่าต่างจะอ่านซ้ำหนึ่งครั้ง (อ่านหลายตารางไม่อะตอมมิก อาจคร่อมช่วงที่ฐานข้อมูลกำลังบันทึก) · อ่านไม่ได้ = โยนต่อ */
export async function checkInvestImport(file: InvestmentData | undefined, repo: LedgerRepository): Promise<InvestImportState> {
  let state = investImportState(file, await repo.loadInvestments());
  if (state === 'different') state = investImportState(file, await repo.loadInvestments());
  // ตรวจหลังอ่าน: สลับบัญชีระหว่างอ่านทำให้ผลเทียบใช้ไม่ได้
  await repo.confirmSameAccount();
  return state;
}
