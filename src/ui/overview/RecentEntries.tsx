import { useMemo } from 'react';
import { amountClass, describeEntry } from '../../app/describe';
import { groupRecentByDay } from '../../app/recentGroups';
import type { Account, Entry, EntryKind } from '../../domain/ledger/types';

const KIND_TEXT: Record<EntryKind, string> = { income: 'รายรับ', expense: 'รายจ่าย', transfer: 'โอน' };

/** ไอคอนเส้น: ลูกศรลง = รายรับ, ลูกศรขึ้น = รายจ่าย, ลูกศรสองทาง = โอน (รูปทรงต่างกัน ไม่พึ่งสีอย่างเดียว) */
function KindIcon({ kind }: { kind: EntryKind }) {
  const d =
    kind === 'income'
      ? 'M12 5v14M6 13l6 6 6-6'
      : kind === 'expense'
        ? 'M12 19V5M6 11l6-6 6 6'
        : 'M4 9h14M14 5l4 4-4 4M20 15H6M10 11l-4 4 4 4';
  return (
    <svg className={`tx-icon tx-${kind}`} viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface RecentEntriesProps {
  accounts: readonly Account[];
  entries: readonly Entry[];
  today: string;
  onAdd: () => void;
  onOpenLedger: () => void;
}

/** รายการล่าสุด (พื้นทึบ) จัดกลุ่ม วันนี้ / เมื่อวาน / วันที่ */
export function RecentEntries({ accounts, entries, today, onAdd, onOpenLedger }: RecentEntriesProps) {
  const groups = useMemo(
    () =>
      groupRecentByDay(entries, today, 8).map((g) => ({
        ...g,
        items: g.entries.map((entry) => ({ entry, ...describeEntry(accounts, entry) })),
      })),
    [accounts, entries, today],
  );

  return (
    <section className="solid card recent" aria-labelledby="recent-title">
      <h2 id="recent-title">รายการล่าสุด</h2>
      {groups.length === 0 ? (
        <div className="empty">
          <p className="muted">ยังไม่มีรายการ เริ่มจากรายจ่ายล่าสุดของคุณ เช่น ค่ากาแฟเมื่อเช้า</p>
          <button className="btn btn-ghost" onClick={onAdd}>
            บันทึกรายการแรก
          </button>
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <div className="tx-group" key={g.date}>
              <h3 className="tx-day">{g.label}</h3>
              <ul className="tx-list">
                {g.items.map(({ entry, kind, amountText }) => (
                  <li className="tx" key={entry.id}>
                    <KindIcon kind={kind} />
                    <div className="tx-main">
                      {entry.memo ? (
                        <>
                          <div>{entry.memo}</div>
                          <div className="muted small">{KIND_TEXT[kind]}</div>
                        </>
                      ) : (
                        <div>{KIND_TEXT[kind]}</div>
                      )}
                    </div>
                    <div className={amountClass(kind, amountText)}>{amountText}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button type="button" className="card-link" onClick={onOpenLedger}>
            ดูสมุดบัญชี <span aria-hidden="true">→</span>
          </button>
        </>
      )}
    </section>
  );
}
