import { useCallback, useEffect, useState } from 'react';
import { localIsoDate } from '../app/dates';
import { describeEntry } from '../app/describe';
import type { Entry } from '../domain/ledger/types';
import { db } from '../storage/instance';
import { deleteEntry, exportSnapshot, isEmpty, loadLedger, resetAll, type Ledger } from '../storage/repository';
import { AddEntryDialog } from './AddEntryDialog';
import { Setup } from './Setup';
import { Shell } from './Shell';
import { Toast } from './Toast';
import { Today } from './Today';

type State =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'ready'; ledger: Ledger }
  | { status: 'error'; message: string };

interface ToastState {
  message: string;
  /** มีค่าเมื่อเลิกทำได้ */
  undoEntryId?: string;
}

const TOAST_MS = 10_000;

async function downloadBackup(): Promise<void> {
  const snapshot = await exportSnapshot(db);
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `money-buddy-backup-${localIsoDate()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (await isEmpty(db)) setState({ status: 'setup' });
      else setState({ status: 'ready', ledger: await loadLedger(db) });
    } catch (e) {
      setState({ status: 'error', message: `เปิดที่เก็บข้อมูลไม่ได้: ${String(e)}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const reset = async () => {
    const ok = window.confirm('ล้างข้อมูลทั้งหมดและเริ่มใหม่?\nการกระทำนี้ย้อนกลับไม่ได้ ควรกด "สำรองข้อมูล" ก่อน');
    if (!ok) return;
    await resetAll(db);
    setToast(null);
    await refresh();
  };

  const saved = async (entry: Entry) => {
    setAdding(false);
    await refresh();
    if (state.status === 'ready') {
      const { amountText } = describeEntry(state.ledger.accounts, entry);
      setToast({ message: `บันทึกแล้ว: ${entry.memo} ${amountText}`, undoEntryId: entry.id });
    } else {
      setToast({ message: `บันทึกแล้ว: ${entry.memo}`, undoEntryId: entry.id });
    }
  };

  const undo = async (id: string) => {
    try {
      await deleteEntry(db, id);
      setToast({ message: 'เลิกทำแล้ว รายการถูกลบ' });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : String(e) });
    }
    await refresh();
  };

  if (state.status === 'loading') {
    return (
      <Shell showNav={false}>
        <p className="muted">กำลังเปิดข้อมูล…</p>
      </Shell>
    );
  }

  if (state.status === 'error') {
    return (
      <Shell showNav={false}>
        <h1>เปิดข้อมูลไม่ได้</h1>
        <p role="alert" className="form-error">
          {state.message}
        </p>
        <p className="muted">ลองปิดโหมดส่วนตัวของเบราว์เซอร์ หรือใช้เบราว์เซอร์อื่น แล้วโหลดหน้านี้ใหม่</p>
      </Shell>
    );
  }

  if (state.status === 'setup') {
    return (
      <Shell showNav={false}>
        <Setup onDone={() => void refresh()} />
      </Shell>
    );
  }

  const undoId = toast?.undoEntryId;

  return (
    <Shell
      footer={
        <>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            บันทึกรายการ
          </button>
          <button className="btn btn-ghost" onClick={() => void downloadBackup()}>
            สำรองข้อมูล
          </button>
          <button className="btn btn-danger" onClick={() => void reset()}>
            ล้างข้อมูลและเริ่มใหม่
          </button>
        </>
      }
    >
      <Today ledger={state.ledger} onAdd={() => setAdding(true)} />

      {adding && (
        <AddEntryDialog
          accounts={state.ledger.accounts}
          onClose={() => setAdding(false)}
          onSaved={(entry) => void saved(entry)}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          actionLabel={undoId ? 'เลิกทำ' : undefined}
          onAction={undoId ? () => void undo(undoId) : undefined}
          onDismiss={() => setToast(null)}
        />
      )}
    </Shell>
  );
}
