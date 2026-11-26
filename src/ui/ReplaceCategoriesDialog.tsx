import { useEffect, useRef, useState, type ReactNode } from 'react';
import { categoryReplaceWarning } from '../app/importCategories';
import type { ImportOptions, LedgerRepository } from '../storage/ledgerRepository';
import { restoreFocus } from './focus';

type Run = (options?: ImportOptions) => void;
type Pending = { existing: number; incoming: number; run: Run };

/**
 * ด่านก่อนนำเข้า: มีหมวดเดิม = ต้องให้ผู้ใช้ยืนยันการลบก่อน (ยกเลิก = ไม่นำเข้าอะไรเลย) · ไม่มี = นำเข้าทันที
 * นับไม่ได้ = ไม่นำเข้า (ส่งต่อให้ onError)
 */
export function useCategoryGuard(repo: LedgerRepository, onError: (e: unknown) => void): { guard: (incoming: number, run: Run) => Promise<void>; checking: boolean; dialog: ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; // ออกจากหน้าระหว่างนับ (เช่น ออกจากระบบ) = ไม่นำเข้าต่อ
    };
  }, []);

  const guard = async (incoming: number, run: Run) => {
    if (busy.current) return; // กดซ้ำระหว่างนับ
    busy.current = true;
    setChecking(true);
    try {
      const existing = await repo.countCategories();
      if (!alive.current) return;
      if (existing > 0) setPending({ existing, incoming, run });
      else run();
    } catch (e) {
      if (alive.current) onError(e);
    } finally {
      busy.current = false;
      if (alive.current) setChecking(false);
    }
  };

  const dialog = pending ? (
    <ReplaceCategoriesDialog
      message={categoryReplaceWarning(pending.existing, pending.incoming)}
      onCancel={() => setPending(null)}
      onConfirm={() => {
        setPending(null);
        pending.run({ replaceCategories: pending.existing });
      }}
    />
  ) : null;

  return { guard, checking, dialog };
}

function ReplaceCategoriesDialog({ message, onCancel, onConfirm }: { message: string; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // จำปุ่มเปิดตอนเรนเดอร์แรก (ก่อน dialog ดึงโฟกัส · effect อาจรันซ้ำใน StrictMode)
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus(); // ค่าเริ่มต้น = ยกเลิก
    return () => restoreFocus(opener);
  }, [opener]);

  return (
    <dialog ref={dialogRef} className="entry-dialog" aria-labelledby="replace-cat-title" aria-describedby="replace-cat-text replace-cat-note" onCancel={onCancel} onClose={onCancel}>
      <div className="entry-form">
        <h2 id="replace-cat-title">ลบหมวดเดิมก่อนนำเข้า?</h2>
        <p id="replace-cat-text">{message}</p>
        <p id="replace-cat-note" className="muted">หมายถึงหมวดในพอร์ตลงทุน หมวดรายรับรายจ่ายไม่ถูกลบ · กดยกเลิก จะไม่นำเข้าอะไรเลย</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost" onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            ลบหมวดเดิมแล้วนำเข้า
          </button>
        </div>
      </div>
    </dialog>
  );
}
