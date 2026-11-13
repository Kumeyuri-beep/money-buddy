import { startGuide, type StartStepId } from '../../app/startGuide';
import type { FinanceInput } from '../../app/billsOverview';
import type { Entry } from '../../domain/ledger/types';

interface Props {
  entries: readonly Entry[];
  finance: FinanceInput;
  onAdd: () => void;
  onOpenBills: () => void;
}

/** การ์ดพื้นทึบ (ไม่ใช่กระจกแท้ จึงไม่กินโควตา 8 ใบ) · หายเองเมื่อทำครบ 3 ขั้น */
export function StartGuide({ entries, finance, onAdd, onOpenBills }: Props) {
  const guide = startGuide(entries, finance);
  if (guide.complete) return null;
  const actionOf: Record<StartStepId, { label: string; run: () => void }> = {
    'first-entry': { label: 'บันทึกรายการ', run: onAdd },
    'pay-day': { label: 'ตั้งวันเงินเดือน', run: onOpenBills },
    'first-bill': { label: 'เพิ่มบิล', run: onOpenBills },
  };
  return (
    <section className="solid card start-guide" aria-labelledby="start-guide-title">
      <h2 id="start-guide-title">เริ่มต้น 3 ขั้น</h2>
      <p className="muted small" role="status">
        ทำแล้ว {guide.doneCount} จาก 3 ขั้น · การ์ดนี้จะหายไปเองเมื่อทำครบ
      </p>
      <ol className="start-steps">
        {guide.steps.map((step) => (
          <li key={step.id} className={step.done ? 'start-step start-step-done' : 'start-step'}>
            <span className="start-mark" aria-hidden="true">
              {step.done ? '✓' : '○'}
            </span>
            <div className="start-text">
              <strong>{step.title}</strong>
              <span className="sr-only">{step.done ? ' (ทำแล้ว)' : ' (ยังไม่ได้ทำ)'}</span>
              <p className="muted small">{step.hint}</p>
            </div>
            {!step.done && (
              <button type="button" className="btn btn-ghost btn-small" onClick={actionOf[step.id].run}>
                {actionOf[step.id].label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
