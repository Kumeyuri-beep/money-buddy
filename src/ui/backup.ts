import { thaiIsoDate } from '../app/dates';
import { db } from '../storage/instance';
import { exportSnapshot } from '../storage/repository';

/** ดาวน์โหลดไฟล์สำรองข้อมูล (JSON) อ่านจากฐานข้อมูลในเครื่องตรงๆ ไม่ผ่านสูตรเงิน จึงใช้ได้แม้หน้าจอล้ม */
export async function downloadBackup(): Promise<void> {
  const snapshot = await exportSnapshot(db);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `money-buddy-backup-${thaiIsoDate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
