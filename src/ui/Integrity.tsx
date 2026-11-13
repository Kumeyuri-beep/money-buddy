import type { IntegrityReport } from '../domain/ledger/integrity';
import { humanizeLedgerMessage } from '../app/errorText';

/** สถานะท้ายแถบเมนู: จุดเขียว = ผ่าน, จุดแดง = พบปัญหา (ผลตรวจจริงจาก runIntegrityCheck) */
export function IntegrityStatus({ report }: { report: IntegrityReport }) {
  return (
    <div className="integrity-status muted" role="status">
      <span className={report.ok ? 'dot' : 'dot dot-bad'} aria-hidden="true" />
      <span>
        {report.ok
          ? `ตรวจบัญชีผ่านทั้งหมด (${report.checkedEntries} รายการ)`
          : `ตรวจบัญชีพบ ${report.issues.length} ปัญหา`}
      </span>
    </div>
  );
}

/** แถบเตือนบนหน้า แสดงเฉพาะเมื่อตรวจพบปัญหา (กฎ R14: ผู้ใช้ต้องรู้เมื่อบัญชีเพี้ยน) */
export function IntegrityBanner({ report }: { report: IntegrityReport }) {
  if (report.ok) return null;
  return (
    <div role="alert" className="alert-banner">
      <strong>พบ {report.issues.length} ปัญหาในสมุดบัญชี</strong>
      <p>ยอดที่แสดงอาจไม่ถูกต้อง ควรกด "สำรองข้อมูล" ไว้ก่อน แล้วตรวจรายการด้านล่าง</p>
      <details>
        <summary>ดูรายละเอียด</summary>
        <ul>
          {report.issues.map((issue, i) => (
            <li key={`${issue.code}-${issue.entryId ?? issue.accountId ?? i}-${i}`}>{humanizeLedgerMessage(issue.message)}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
