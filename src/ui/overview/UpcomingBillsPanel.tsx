import { buildUpcomingPanel, type FinanceInput } from '../../app/billsOverview';
import { thaiDayLabel } from '../../app/dates';
import { formatBaht, satang } from '../../domain/money/satang';

interface Props {
  finance: FinanceInput;
  today: string;
  onOpenBills: () => void;
}

/** บิลที่จะถึง (glass-lite): ยังไม่จ่ายและครบกำหนดก่อนเงินเดือนถัดไป (หรือ 30 วันข้างหน้าถ้ายังไม่ตั้งวันเงินเดือน) */
export function UpcomingBillsPanel({ finance, today, onOpenBills }: Props) {
  const panel = buildUpcomingPanel(finance, today);
  return (
    <section className="glass-lite card empty-panel" aria-labelledby="bills-title">
      <h2 id="bills-title">บิลที่จะถึง</h2>
      {panel.kind === 'no-bills' ? (
        <>
          <div className="summary-empty">ยังไม่ได้ตั้งบิลประจำ</div>
          <button type="button" className="card-link" onClick={onOpenBills}>
            เพิ่มบิลประจำ →
          </button>
        </>
      ) : panel.kind === 'error' ? (
        <p role="alert" className="form-error">
          {panel.message}
        </p>
      ) : panel.kind === 'clear' ? (
        <>
          <div className="summary-empty">ไม่มีบิลค้างจ่ายในช่วงนี้</div>
          {panel.invalidBills > 0 && (
            <p role="alert" className="form-error small">
              มีบิล {panel.invalidBills} ใบข้อมูลผิด จึงยังไม่ถูกนับ
            </p>
          )}
        </>
      ) : (
        <>
          <ul className="upcoming-list">
            {panel.items.map((u) => (
              <li key={`${u.bill.id}-${u.cycleMonth}`} className="upcoming-row">
                <span>
                  {u.bill.name}
                  <span className={u.overdue ? 'slip-warn small' : 'muted small'}>
                    {' '}
                    · {u.overdue ? 'เลยกำหนด ' : ''}
                    {thaiDayLabel(u.dueDate)}
                  </span>
                </span>
                <span className="num">{formatBaht(satang(u.bill.amount))}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            รวม {formatBaht(satang(panel.total))} ถึง {thaiDayLabel(panel.until)}
            {panel.hidden > 0 ? ` · ยังมีอีก ${panel.hidden} ใบ` : ''}
          </p>
          {panel.invalidBills > 0 && (
            <p role="alert" className="form-error small">
              มีบิล {panel.invalidBills} ใบข้อมูลผิด จึงยังไม่ถูกนับ
            </p>
          )}
          <button type="button" className="card-link" onClick={onOpenBills}>
            จัดการบิล →
          </button>
        </>
      )}
    </section>
  );
}
