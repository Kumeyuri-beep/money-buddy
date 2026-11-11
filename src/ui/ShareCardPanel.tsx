import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAllocationModel, describeAllocation } from '../app/allocationView';
import { thaiDayLabel } from '../app/dates';
import type { Portfolio } from '../app/portfolio';
import { formatBps } from '../domain/invest/allocation';
import { drawShareCard, SHARE_CARD_HEIGHT, SHARE_CARD_WIDTH } from './shareCardCanvas';

interface Props {
  portfolio: Portfolio;
  today: string;
  onClose: () => void;
}

const FILE_NAME = 'portfolio-share.png';

/**
 * การ์ดแชร์สัดส่วนพอร์ต: สร้างรูป PNG ในเครื่องเท่านั้น (canvas) ผู้ใช้กดแชร์/บันทึกเอง · ไม่ส่งอะไรขึ้นเซิร์ฟเวอร์
 * รูปมีเฉพาะสัดส่วน % ไม่มียอดเงิน · ชื่อกองทุน/หุ้นซ่อนเป็นค่าเริ่มต้น (เปิดเองได้)
 */
export function ShareCardPanel({ portfolio, today, onClose }: Props) {
  const [showNames, setShowNames] = useState(false);
  const [note, setNote] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const model = useMemo(() => buildAllocationModel(portfolio, { showNames, maxVisible: 7 }), [portfolio, showNames]);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // วาดใหม่ทุกครั้งที่ตัวเลือกเปลี่ยน (รอฟอนต์เว็บโหลดก่อน ไม่งั้นอักษรไทยในรูปเป็นฟอนต์สำรอง)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !model) return;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const ctx = canvas.getContext('2d');
      if (ctx) drawShareCard(ctx, model, `ณ ${thaiDayLabel(today)}`);
    };
    paint();
    void document.fonts?.ready.then(paint);
    return () => {
      cancelled = true;
    };
  }, [model, today]);

  const toBlob = (): Promise<Blob | null> =>
    new Promise((resolve) => {
      const canvas = canvasRef.current;
      if (!canvas) return resolve(null);
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

  const canShareFiles = (): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
    try {
      return navigator.canShare({ files: [new File([], FILE_NAME, { type: 'image/png' })] });
    } catch {
      return false;
    }
  };

  const share = async () => {
    setNote('');
    const blob = await toBlob();
    if (!blob) return setNote('สร้างรูปไม่สำเร็จ ลองอีกครั้ง');
    try {
      await navigator.share({ files: [new File([blob], FILE_NAME, { type: 'image/png' })], title: 'สัดส่วนพอร์ตของฉัน' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // ผู้ใช้ปิดหน้าต่างแชร์เอง
      setNote('แชร์ไม่สำเร็จ ลองบันทึกรูปแล้วแชร์จากแอปอื่นแทน');
    }
  };

  const save = async () => {
    setNote('');
    const blob = await toBlob();
    if (!blob) return setNote('สร้างรูปไม่สำเร็จ ลองอีกครั้ง');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = FILE_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setNote('บันทึกรูปแล้ว (ไฟล์อยู่ในเครื่องของคุณ)');
  };

  return (
    <section className="solid card" aria-labelledby="share-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h2 id="share-title" ref={headingRef} tabIndex={-1}>
        การ์ดแชร์สัดส่วนพอร์ต
      </h2>
      <p className="muted small">รูปนี้มีเฉพาะสัดส่วน (%) ไม่มียอดเงินหรือจำนวนหน่วย สร้างในเครื่องคุณเท่านั้น ไม่ถูกส่งขึ้นเซิร์ฟเวอร์ คุณเป็นคนกดแชร์หรือบันทึกเอง</p>
      {model === null ? (
        <p className="muted">ยังไม่มีสินทรัพย์ที่ถืออยู่ให้แสดงสัดส่วน</p>
      ) : (
        <>
          <div className="field">
            <label className="check-row" htmlFor="share-names">
              <input id="share-names" type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              แสดงชื่อกองทุน/หุ้นในรูป
            </label>
            <p className="muted small">ปิดอยู่ = รูปใช้ "สินทรัพย์ 1, 2, …" ถ้าเปิด ใครเห็นรูปจะรู้ว่าคุณถืออะไรอยู่</p>
          </div>
          {model.basis === 'cost' && (
            <p className="muted small" role="note">
              สัดส่วนนี้คิดตามต้นทุน เพราะยังกรอกราคาไม่ครบทุกสินทรัพย์ (กรอกราคาครบแล้วจะคิดตามมูลค่า)
            </p>
          )}
          <canvas
            ref={canvasRef}
            className="share-canvas"
            width={SHARE_CARD_WIDTH}
            height={SHARE_CARD_HEIGHT}
            role="img"
            aria-label={describeAllocation(model, formatBps)}
          />
          <div className="form-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
              ปิด
            </button>
            <button type="button" className="btn btn-small" onClick={() => void save()}>
              บันทึกรูป (PNG)
            </button>
            {canShareFiles() && (
              <button type="button" className="btn btn-primary btn-small" onClick={() => void share()}>
                แชร์รูป
              </button>
            )}
          </div>
          <div role="status" aria-live="polite">
            {note !== '' && <p className="muted">{note}</p>}
          </div>
        </>
      )}
    </section>
  );
}
