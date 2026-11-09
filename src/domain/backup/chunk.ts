import type { Entry } from '../ledger/types';

/**
 * แบ่งรายการเป็นก้อนสำหรับนำเข้าหลายคำสั่ง (ไฟล์เกิน SINGLE_IMPORT_MAX_ENTRIES) · ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
 * ก้อนต้องไม่เกินเพดานต่อคำสั่งของฐานข้อมูล (1,500 รายการ / 20,000 บรรทัด) และใช้เวลาไม่เกินเพดานเวลา ~8 วินาที
 * (วัดจริง 2,000 รายการ = 5.2 วินาที จึงใช้ก้อนละ ≤ 500 รายการ) · ลำดับรายการคงเดิม ไม่ทิ้งไม่ซ้ำ
 */
export const IMPORT_CHUNK_MAX_ENTRIES = 500;
export const IMPORT_CHUNK_MAX_LINES = 15_000;

export function chunkEntries(entries: readonly Entry[]): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  let lines = 0;
  for (const entry of entries) {
    const n = entry.lines.length;
    if (current.length > 0 && (current.length >= IMPORT_CHUNK_MAX_ENTRIES || lines + n > IMPORT_CHUNK_MAX_LINES)) {
      chunks.push(current);
      current = [];
      lines = 0;
    }
    current.push(entry);
    lines += n;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
