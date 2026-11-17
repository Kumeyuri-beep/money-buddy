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

  const canShareFiles = useMemo((): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
    try {
      return navigator.canShare({ files: [new File([], FILE_NAME, { type: 'image/png' })] });
    } catch {
      return false;
    }
  }, []);

  const share = async () => {
    setNote('');
    const blob = await toBlob();
    if (!blob) return setNote('Could not create the image. Try again.');
    try {
      await navigator.share({ files: [new File([blob], FILE_NAME, { type: 'image/png' })], title: 'My portfolio allocation' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // ผู้ใช้ปิดหน้าต่างแชร์เอง
      setNote('Sharing failed. Try saving the image and sharing it from another app.');
    }
  };

  const save = async () => {
    setNote('');
    const blob = await toBlob();
    if (!blob) return setNote('Could not create the image. Try again.');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = FILE_NAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setNote('Image saved (the file is on your device).');
  };

  return (
    <section className="solid card" aria-labelledby="share-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <h2 id="share-title" ref={headingRef} tabIndex={-1}>
        Portfolio allocation share card
      </h2>
      <p className="muted small">The image shows percentages only, with no amounts or unit counts. It is created on your device only and is never sent to a server. You choose whether to share or save it.</p>
      {model === null ? (
        <p className="muted">No held assets to show an allocation for yet.</p>
      ) : (
        <>
          <div className="field">
            <label className="check-row" htmlFor="share-names">
              <input id="share-names" type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} />
              Show fund/stock names in the image
            </label>
            <p className="muted small">Off = the image uses "Asset 1, 2, …". If on, anyone who sees the image will know what you hold.</p>
          </div>
          {model.basis === 'cost' && (
            <p className="muted small" role="note">
              This allocation is based on cost because not every asset has a price yet (once all prices are entered it is based on value).
            </p>
          )}
          <p className="muted small" role="note">
            Caution: if you have told others the amount of any asset elsewhere, they may be able to work out the other amounts from the percentages · with a single asset the image shows 100% · if you share on several days, viewers will see the allocation change
          </p>
          {model.excluded > 0 && (
            <p className="muted small" role="note">
              {model.excluded} {model.excluded === 1 ? 'asset is' : 'assets are'} not counted in the allocation (inconsistent trade data or a value of 0), so the percentages in the image add up to 100% of the counted part only.
            </p>
          )}
          {model.stalePrices && (
            <p className="muted small" role="note">
              Some prices were entered more than 7 days ago, so the figures may be out of date. You can update prices before sharing.
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
              Close
            </button>
            <button type="button" className="btn btn-small" onClick={() => void save()}>
              Save as image
            </button>
            {canShareFiles && (
              <button type="button" className="btn btn-primary btn-small" onClick={() => void share()}>
                Share image
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
