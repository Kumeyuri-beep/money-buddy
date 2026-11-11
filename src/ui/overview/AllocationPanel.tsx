import { useEffect, useMemo, useState } from 'react';
import { buildAllocationModel, describeAllocation } from '../../app/allocationView';
import { friendlyError } from '../../app/errorText';
import { buildPortfolio } from '../../app/portfolio';
import { formatBps } from '../../domain/invest/allocation';
import type { InvestmentData } from '../../domain/invest/types';
import { useRepository } from '../RepositoryContext';
import { sliceColor } from '../shareCardCanvas';

interface Props {
  today: string;
  onOpenPortfolio: () => void;
}

/**
 * สัดส่วนพอร์ต (glass-lite) ในหน้าภาพรวม · แสดงเฉพาะสัดส่วน % (ไม่แสดงยอดเงินบนการ์ด) เป็นหน้าจอของผู้ใช้เอง จึงแสดงชื่อจริงได้
 * ใช้ข้อมูลลงทุนเดียวกับหน้าพอร์ต (R17) · ราคาไม่ครบ = คิดตามต้นทุนและบอกชัด · ไม่ผสมมูลค่ากับต้นทุน
 */
export function AllocationPanel({ today, onOpenPortfolio }: Props) {
  const repo = useRepository();
  const [data, setData] = useState<InvestmentData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    repo
      .loadInvestments()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(friendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const model = useMemo(() => (data === null ? null : buildAllocationModel(buildPortfolio(data, today), { showNames: true, maxVisible: 6 })), [data, today]);

  return (
    <section className="glass-lite card empty-panel" aria-labelledby="alloc-title">
      <h2 id="alloc-title">สัดส่วนพอร์ตลงทุน</h2>
      {error !== '' ? (
        <p role="status" className="small">
          โหลดข้อมูลลงทุนไม่สำเร็จ: {error}
        </p>
      ) : data === null ? (
        <p className="muted small" role="status">
          กำลังโหลด…
        </p>
      ) : model === null ? (
        <>
          <div className="summary-empty">ยังไม่มีสินทรัพย์ที่ถืออยู่</div>
          <button type="button" className="card-link" onClick={onOpenPortfolio}>
            เพิ่มกองทุน/หุ้น →
          </button>
        </>
      ) : (
        <>
          <div className="alloc-bar" role="img" aria-label={describeAllocation(model, formatBps)}>
            {model.slices.map((s, i) => (
              <span key={s.key} className="alloc-seg" style={{ width: `${s.bps / 100}%`, background: sliceColor(i, s.isOther) }} />
            ))}
          </div>
          <ul className="alloc-legend">
            {model.slices.map((s, i) => (
              <li key={s.key}>
                <span className="alloc-dot" style={{ background: sliceColor(i, s.isOther) }} aria-hidden="true" />
                <span className="alloc-name">{s.label}</span>
                <span className="alloc-pct num">{formatBps(s.bps)}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">{model.basis === 'value' ? 'คิดตามมูลค่า (ราคาที่คุณกรอก)' : 'คิดตามต้นทุน เพราะยังกรอกราคาไม่ครบ'}</p>
          {model.excluded > 0 && (
            <p role="status" className="small">
              ⚠ มี {model.excluded} สินทรัพย์ที่ไม่ถูกนับ (ข้อมูลผิดพลาดหรือมูลค่าเป็น 0) ตรวจที่หน้าพอร์ต
            </p>
          )}
          {model.stalePrices && (
            <p role="status" className="small">
              ⚠ มีราคาที่กรอกไว้นานกว่า 7 วัน
            </p>
          )}
          <button type="button" className="card-link" onClick={onOpenPortfolio}>
            ดูพอร์ตทั้งหมด →
          </button>
        </>
      )}
    </section>
  );
}
