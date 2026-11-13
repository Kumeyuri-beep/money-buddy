/**
 * เตือนสำรองข้อมูล (เจ้าของสั่ง 13 พ.ย. 2569): ไม่ได้ดาวน์โหลดเกิน 7 วัน หรือไม่เคยเลยแต่มีรายการแล้ว → แสดงแถบเตือน
 * ปิดชั่วคราวได้ 3 วัน · เก็บวันที่ใน settings (lastBackupAt / backupSnoozeUntil) ผ่าน updateSettings
 * ฟังก์ชันล้วน ไม่แตะ DOM · ไม่แตะเงิน
 */
import type { FinanceSettings } from '../domain/bills/settings';
import type { Entry } from '../domain/ledger/types';
import type { LedgerRepository } from '../storage/ledgerRepository';
import { addDays } from './dates';

/** เตือนเมื่อดาวน์โหลดล่าสุดเกินกี่วัน (เกิน = มากกว่า 7) */
export const BACKUP_STALE_DAYS = 7;
/** ปิดแถบเตือนชั่วคราวกี่วัน */
export const BACKUP_SNOOZE_DAYS = 3;

export type BackupReminderState = { show: false } | { show: true; reason: 'never' } | { show: true; reason: 'stale'; daysSince: number };

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = toIso.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

export function backupReminder(input: { entries: readonly Entry[]; settings: FinanceSettings; today: string }): BackupReminderState {
  const { entries, settings, today } = input;
  if (settings.backupSnoozeUntil !== undefined && today < settings.backupSnoozeUntil) return { show: false };
  if (settings.lastBackupAt === undefined) {
    // ยังไม่เคยดาวน์โหลด: เตือนเฉพาะเมื่อมีรายการจริงแล้ว (ยอดยกมาตอนตั้งต้นไม่นับ)
    return entries.some((e) => e.source !== 'system') ? { show: true, reason: 'never' } : { show: false };
  }
  const daysSince = daysBetween(settings.lastBackupAt, today);
  // วันที่ในอนาคต (นาฬิกาเครื่องเพี้ยน) ให้ถือว่าเพิ่งสำรอง ไม่เตือน
  return daysSince > BACKUP_STALE_DAYS ? { show: true, reason: 'stale', daysSince } : { show: false };
}

/** วันสุดท้ายที่ซ่อนแถบ: วันนี้ + 3 วัน (ถึงวันนั้นแล้วกลับมาเตือน) */
export function snoozeUntilFor(today: string): string {
  return addDays(today, BACKUP_SNOOZE_DAYS);
}

type SettingsWriter = Pick<LedgerRepository, 'updateSettings'>;

/** ดาวน์โหลดสำเร็จแล้ว: จดวันที่ล่าสุด และล้างการปิดชั่วคราว (เขียนเฉพาะสองคีย์ แบบ compare-and-set) */
export async function markBackupDone(repo: SettingsWriter, today: string): Promise<void> {
  await repo.updateSettings(['lastBackupAt', 'backupSnoozeUntil'], () => ({ lastBackupAt: today, backupSnoozeUntil: null }));
}

/** ปิดแถบเตือนชั่วคราว 3 วัน */
export async function snoozeBackupReminder(repo: SettingsWriter, today: string): Promise<void> {
  await repo.updateSettings(['backupSnoozeUntil'], () => ({ backupSnoozeUntil: snoozeUntilFor(today) }));
}
