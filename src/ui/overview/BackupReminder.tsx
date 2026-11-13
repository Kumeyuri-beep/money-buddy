import { backupReminder, BACKUP_SNOOZE_DAYS } from '../../app/backupReminder';
import type { FinanceSettings } from '../../domain/bills/settings';
import type { Entry } from '../../domain/ledger/types';

interface Props {
  entries: readonly Entry[];
  settings: FinanceSettings;
  today: string;
  onDownload: () => void;
  onSnooze: () => void;
  /** ข้อความสถานะหลังกดปุ่ม (เช่น ดาวน์โหลดไม่สำเร็จ) */
  note?: string;
}

/** แถบเตือนเล็กๆ พื้นทึบ (ไม่ใช่กระจกแท้ จึงไม่กินโควตา 8 ใบ) · ไม่ถึงเกณฑ์ = ไม่แสดง */
export function BackupReminder({ entries, settings, today, onDownload, onSnooze, note }: Props) {
  const state = backupReminder({ entries, settings, today });
  if (!state.show) return null;
  const lead = state.reason === 'never' ? 'ยังไม่เคยดาวน์โหลดข้อมูลสำรอง' : `ดาวน์โหลดสำรองครั้งล่าสุดเมื่อ ${state.daysSince} วันที่แล้ว`;
  return (
    <section className="solid card backup-reminder" aria-labelledby="backup-reminder-title">
      <h2 id="backup-reminder-title">ควรสำรองข้อมูล</h2>
      <p>
        {lead} · ระบบ<strong>ไม่มีสำรองบนเซิร์ฟเวอร์</strong> ไฟล์ที่ดาวน์โหลดไว้คือสำเนาเดียวที่กู้คืนได้
      </p>
      <div className="actions">
        <button type="button" className="btn btn-primary btn-small" onClick={onDownload}>
          ดาวน์โหลดข้อมูลของฉัน
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onSnooze}>
          ปิดไว้ {BACKUP_SNOOZE_DAYS} วัน
        </button>
      </div>
      <div role="status" className="muted small">
        {note ?? ''}
      </div>
    </section>
  );
}
