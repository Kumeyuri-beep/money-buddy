import { useCallback, useEffect, useState } from 'react';
import { localIsoDate } from '../app/dates';
import { describeEntry } from '../app/describe';
import type { Entry } from '../domain/ledger/types';
import { db } from '../storage/instance';
import {
  appendEntry,
  deleteEntry,
  exportSnapshot,
  isEmpty,
  loadLedger,
  resetAll,
  updateEntry,
  type Ledger,
} from '../storage/repository';
import { AddEntryDialog } from './AddEntryDialog';
import { LedgerView } from './LedgerView';
import { QuickAdd } from './QuickAdd';
import { Setup } from './Setup';
import { Shell, type ViewId } from './Shell';
import { Toast } from './Toast';
import { Today } from './Today';

type State =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'ready'; ledger: Ledger }
  | { status: 'error'; message: string };

type DialogState = { mode: 'add' } | { mode: 'edit'; entry: Entry } | null;

interface ToastState {
  message: string;
  /** มีค่าเมื่อกดเลิกทำได้ */
  undo?: () => Promise<void>;
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

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [view, setView] = useState<ViewId>('today');
  const [dialog, setDialog] = useState<DialogState>(null);
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

  /** ทำงานหนึ่งอย่าง แล้วโหลดข้อมูลใหม่และแจ้งผล ถ้าพลาดแจ้งข้อความผิดพลาดแทน */
  const run = async (action: () => Promise<ToastState>) => {
    try {
      const next = await action();
      await refresh();
      setToast(next);
    } catch (e) {
      await refresh();
      setToast({ message: errorText(e) });
    }
  };

  const reset = async () => {
    const ok = window.confirm('ล้างข้อมูลทั้งหมดและเริ่มใหม่?\nการกระทำนี้ย้อนกลับไม่ได้ ควรกด "สำรองข้อมูล" ก่อน');
    if (!ok) return;
    await resetAll(db);
    setToast(null);
    setView('today');
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

  const { accounts } = state.ledger;
  const label = (entry: Entry) => `${entry.memo} ${describeEntry(accounts, entry).amountText}`;

  const saved = (entry: Entry, before?: Entry) => {
    setDialog(null);
    void run(async () =>
      before
        ? {
            message: `แก้ไขแล้ว: ${label(entry)}`,
            undo: () =>
              run(async () => {
                await updateEntry(db, before.id, before);
                return { message: 'ย้อนการแก้ไขแล้ว' };
              }),
          }
        : {
            message: `บันทึกแล้ว: ${label(entry)}`,
            undo: () =>
              run(async () => {
                await deleteEntry(db, entry.id);
                return { message: 'เลิกทำแล้ว รายการถูกลบ' };
              }),
          },
    );
  };

  const remove = (entry: Entry) =>
    void run(async () => {
      const removed = await deleteEntry(db, entry.id);
      return {
        message: `ลบแล้ว: ${label(removed)}`,
        undo: () =>
          run(async () => {
            await appendEntry(db, removed);
            return { message: 'กู้คืนรายการแล้ว' };
          }),
      };
    });

  const openAdd = () => setDialog({ mode: 'add' });

  return (
    <Shell
      current={view}
      onNavigate={setView}
      footer={
        <>
          <button className="btn btn-primary" onClick={openAdd}>
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
      <QuickAdd ledger={state.ledger} onSaved={(entry) => saved(entry)} />

      {view === 'today' ? (
        <Today ledger={state.ledger} onAdd={openAdd} />
      ) : (
        <LedgerView
          ledger={state.ledger}
          onAdd={openAdd}
          onEdit={(entry) => setDialog({ mode: 'edit', entry })}
          onDelete={remove}
        />
      )}

      {dialog && (
        <AddEntryDialog
          key={dialog.mode === 'edit' ? dialog.entry.id : 'add'}
          accounts={accounts}
          editing={dialog.mode === 'edit' ? dialog.entry : undefined}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}

      {toast && (
        <Toast
          message={toast.message}
          actionLabel={toast.undo ? 'เลิกทำ' : undefined}
          onAction={toast.undo ? () => void toast.undo?.() : undefined}
          onDismiss={() => setToast(null)}
        />
      )}
    </Shell>
  );
}
