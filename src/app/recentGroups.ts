import type { Entry } from '../domain/ledger/types';
import { addDays, thaiDayLabel } from './dates';

export interface DayGroup {
  kind: 'today' | 'yesterday' | 'other';
  /** YYYY-MM-DD */
  date: string;
  /** "วันนี้" / "เมื่อวาน" / "พ. 29 ต.ค." */
  label: string;
  /** ใหม่สุดก่อน */
  entries: Entry[];
}

/**
 * จัดกลุ่มรายการล่าสุดตามวัน (ไม่รวมยอดยกมา source system)
 * ข้อมูลเข้าเรียงเก่า -> ใหม่ (ตาม compareEntries) ผลลัพธ์เรียงใหม่ -> เก่า รวมทุกกลุ่มไม่เกิน limit รายการ
 * วันนี้/เมื่อวานคำนวณจากวันที่ปฏิทินด้วย addDays จึงถูกต้องข้ามเดือน ข้ามปี และ 29 ก.พ.
 */
export function groupRecentByDay(entries: readonly Entry[], today: string, limit: number): DayGroup[] {
  if (limit <= 0) return [];
  const yesterday = addDays(today, -1);

  // reverse ก่อน แล้ว sort แบบเสถียรตามวัน: วันเดียวกันคงลำดับ "ท้ายสุดก่อน"
  const ordered = entries
    .filter((e) => e.source !== 'system')
    .slice()
    .reverse()
    .sort((a, b) => (a.date === b.date ? 0 : a.date > b.date ? -1 : 1))
    .slice(0, limit);

  const groups: DayGroup[] = [];
  for (const entry of ordered) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) {
      last.entries.push(entry);
      continue;
    }
    const kind = entry.date === today ? 'today' : entry.date === yesterday ? 'yesterday' : 'other';
    const label = kind === 'today' ? 'วันนี้' : kind === 'yesterday' ? 'เมื่อวาน' : thaiDayLabel(entry.date);
    groups.push({ kind, date: entry.date, label, entries: [entry] });
  }
  return groups;
}
