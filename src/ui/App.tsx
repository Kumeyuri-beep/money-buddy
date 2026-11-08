import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thaiIsoDate, thaiMonthKeyLabel } from '../app/dates';
import { describeEntry } from '../app/describe';
import { learnFromHistory } from '../app/quickText';
import { formatBaht, satang } from '../domain/money/satang';
import { draftFromOcrTexts, type SlipDraft } from '../app/slipParser';
import type { BillRow } from '../app/billsView';
import type { FinanceSettings } from '../domain/bills/settings';
import type { Bill } from '../domain/bills/types';
import { runIntegrityCheck } from '../domain/ledger/integrity';
import type { Entry } from '../domain/ledger/types';
import { readSlipImage, type SlipOcrPhase } from '../ocr/readSlip';
import { db } from '../storage/instance';
import {
  addBill,
  appendEntry,
  cancelBillPayment,
  cancelLatestBillPayment,
  clearMigrationSnapshot,
  deleteBill,
  deleteEntry,
  isEmpty,
  loadBills,
  loadLedger,
  loadSettings,
  migrationSnapshotInfo,
  resetAll,
  saveSettings,
  undoPayBill,
  updateBill,
  updateEntry,
  type Ledger,
  type PayBillResult,
} from '../storage/repository';
import { AddEntryDialog } from './AddEntryDialog';
import { BillDialog } from './BillDialog';
import { BillsView, type SnapshotInfo } from './BillsView';
import { PayBillDialog } from './PayBillDialog';
import { downloadBackup } from './backup';
import { ErrorBoundary } from './ErrorBoundary';
import { Header } from './Header';
import { IntegrityBanner, IntegrityStatus } from './Integrity';
import { LedgerView } from './LedgerView';
import { Setup } from './Setup';
import { Shell, type ViewId } from './Shell';
import { ScanStatus } from './ScanStatus';
import { Toast } from './Toast';
import { Today } from './Today';
import { useSlipIntake } from './useSlipIntake';

type State =
  | { status: 'loading' }
  | { status: 'setup' }
  | { status: 'ready'; ledger: Ledger; bills: Bill[]; settings: FinanceSettings; snapshot: SnapshotInfo | null }
  | { status: 'error'; message: string };

type DialogState =
  | { mode: 'add' }
  | { mode: 'edit'; entry: Entry }
  | { mode: 'scan'; draft: SlipDraft }
  | { mode: 'bill'; editing?: Bill }
  | { mode: 'pay'; row: BillRow }
  | null;

interface ScanProgress {
  progress: number;
  phase: SlipOcrPhase;
}

interface ToastState {
  message: string;
  /** มีค่าเมื่อกดเลิกทำได้ */
  undo?: () => Promise<void>;
}

const TOAST_MS = 10_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [view, setView] = useState<ViewId>('today');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const scanLock = useRef(false);

  const refresh = useCallback(async () => {
    try {
      if (await isEmpty(db)) setState({ status: 'setup' });
      else {
        const [ledger, bills, settings, snapshot] = await Promise.all([
          loadLedger(db),
          loadBills(db),
          loadSettings(db),
          migrationSnapshotInfo(db),
        ]);
        setState({ status: 'ready', ledger, bills, settings, snapshot });
      }
    } catch (e) {
      setState({ status: 'error', message: `เปิดที่เก็บข้อมูลไม่ได้: ${String(e)}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ผลตรวจความถูกต้องของสมุดบัญชี คำนวณใหม่เมื่อข้อมูลเปลี่ยนเท่านั้น
  const integrity = useMemo(
    () => (state.status === 'ready' ? runIntegrityCheck(state.ledger.accounts, state.ledger.entries) : null),
    [state],
  );

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

  /** สแกนสลิป: อ่านรูปบนเครื่อง -> เปิดฟอร์มพร้อมค่าที่เติมให้ตรวจ (ไม่บันทึกเอง รูปไม่ถูกเก็บ) */
  const scanSlip = async (file: File) => {
    if (state.status !== 'ready') return;
    // ล็อกด้วย ref (ไม่ใช่ state): วาง/ลากรูปสองครั้งติดกันก่อนหน้าจอ render ใหม่ จะไม่เปิด worker ซ้อน
    if (scanLock.current) {
      setToast({ message: 'กำลังอ่านสลิปอยู่ รอสักครู่' });
      return;
    }
    scanLock.current = true;
    const { accounts, entries } = state.ledger;
    setToast(null);
    setScanning({ progress: 0, phase: 'preparing' });
    try {
      const texts = await readSlipImage(file, { onProgress: (progress, phase) => setScanning({ progress, phase }) });
      const draft = draftFromOcrTexts(texts, { accounts, today: thaiIsoDate(), learned: learnFromHistory(accounts, entries) });
      if (draft) setDialog({ mode: 'scan', draft });
      else setToast({ message: 'อ่านข้อมูลจากสลิปไม่ได้ ลองรูปที่ชัดขึ้น หรือกด "เพิ่มรายการ" เพื่อกรอกเอง' });
    } catch (e) {
      setToast({ message: errorText(e) });
    } finally {
      scanLock.current = false;
      setScanning(null);
    }
  };

  // รับรูปจากการวาง (Ctrl+V) และการลากมาวาง เฉพาะตอนไม่ได้เปิดฟอร์มอยู่
  const { dragging } = useSlipIntake(state.status === 'ready' && !dialog, (file) => void scanSlip(file));

  const reset = async () => {
    const ok = window.confirm(
      'ล้างข้อมูลทั้งหมดและเริ่มใหม่?\nรวมบิลประจำ ค่าตั้งค่า และสำเนาก่อนอัปเกรด\nการกระทำนี้ย้อนกลับไม่ได้ ควรกด "สำรองข้อมูล" ก่อน',
    );
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

  const today = thaiIsoDate();
  const billAmountText = (bill: Bill) => formatBaht(satang(bill.amount));

  const billSaved = (bill: Bill, before?: Bill) => {
    setDialog(null);
    void run(async () =>
      before
        ? {
            message: `แก้ไขบิลแล้ว: ${bill.name}`,
            undo: () =>
              run(async () => {
                await updateBill(db, before);
                return { message: 'ย้อนการแก้ไขบิลแล้ว' };
              }),
          }
        : {
            message: `เพิ่มบิลแล้ว: ${bill.name} ${billAmountText(bill)}`,
            undo: () =>
              run(async () => {
                await deleteBill(db, bill.id);
                return { message: 'เลิกทำแล้ว บิลถูกลบ' };
              }),
          },
    );
  };

  const removeBill = (bill: Bill) => {
    if (!window.confirm(`ลบบิล "${bill.name}"?\nรายการเงินที่เคยจ่ายไปแล้วไม่ถูกลบ`)) return;
    void run(async () => {
      const removed = await deleteBill(db, bill.id);
      return {
        message: `ลบบิลแล้ว: ${removed.name}`,
        undo: () =>
          run(async () => {
            await addBill(db, removed, today);
            return { message: 'กู้คืนบิลแล้ว' };
          }),
      };
    });
  };

  const billPaid = (row: BillRow, result: PayBillResult) => {
    setDialog(null);
    void run(async () => ({
      message: `จ่ายบิลแล้ว: ${row.bill.name} ${billAmountText(row.bill)} รอบ ${thaiMonthKeyLabel(result.cycle)}`,
      undo: () =>
        run(async () => {
          await undoPayBill(db, { entryId: result.entry.id, billId: row.bill.id, cycle: result.cycle, before: result.before });
          return { message: 'เลิกทำแล้ว รายการจ่ายบิลถูกลบ' };
        }),
    }));
  };

  /** ยกเลิกการจ่ายบิล: ลบรายการและคืนสถานะบิลพร้อมกัน ไม่มี undo (จ่ายใหม่ได้จากหน้าบิล) */
  const confirmCancel = (name: string, cycle: string | undefined): boolean =>
    window.confirm(
      `ยกเลิกการจ่าย "${name}"${cycle ? ` รอบ ${thaiMonthKeyLabel(cycle)}` : ''}?\nรายการจ่ายจะถูกลบและเงินกลับเข้ากระเป๋า บิลจะกลับเป็นยังไม่จ่าย`,
    );

  const cancelPaymentOfEntry = (entry: Entry) => {
    if (!confirmCancel(entry.memo, entry.bill?.cycle)) return;
    void run(async () => {
      await cancelBillPayment(db, entry.id);
      return { message: `ยกเลิกการจ่ายแล้ว: ${entry.memo}` };
    });
  };

  const cancelPaymentOfBill = (bill: Bill) => {
    if (!confirmCancel(bill.name, bill.lastPaidMonth)) return;
    void run(async () => {
      await cancelLatestBillPayment(db, bill.id);
      return { message: `ยกเลิกการจ่ายแล้ว: ${bill.name}` };
    });
  };

  const clearSnapshot = () => {
    const ok = window.confirm(
      'ลบสำเนาข้อมูลก่อนอัปเกรด?\nข้อมูลที่ใช้งานอยู่ไม่ถูกแตะ แต่สำเนานี้จะกู้คืนไม่ได้อีก',
    );
    if (!ok) return;
    void run(async () => {
      await clearMigrationSnapshot(db);
      return { message: 'ลบสำเนาก่อนอัปเกรดแล้ว' };
    });
  };

  const openAdd = () => setDialog({ mode: 'add' });

  return (
    <Shell
      current={view}
      onNavigate={setView}
      status={integrity ? <IntegrityStatus report={integrity} /> : null}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => void downloadBackup()}>
            สำรองข้อมูล
          </button>
          <button className="btn btn-danger" onClick={() => void reset()}>
            ล้างข้อมูลและเริ่มใหม่
          </button>
        </>
      }
    >
      <Header
        ledger={state.ledger}
        onAdd={openAdd}
        onQuickSaved={(entry) => saved(entry)}
        onScan={(file) => void scanSlip(file)}
        scanning={scanning !== null}
      />

      {integrity && <IntegrityBanner report={integrity} />}

      <ErrorBoundary resetKey={view}>
      {view === 'today' ? (
        <Today
          ledger={state.ledger}
          onAdd={openAdd}
          onOpenLedger={() => setView('ledger')}
          finance={{ bills: state.bills, settings: state.settings }}
          onOpenBills={() => setView('bills')}
        />
      ) : view === 'bills' ? (
        <BillsView
          bills={state.bills}
          settings={state.settings}
          snapshot={state.snapshot}
          today={today}
          onAdd={() => setDialog({ mode: 'bill' })}
          onEdit={(bill) => setDialog({ mode: 'bill', editing: bill })}
          onDelete={removeBill}
          onPay={(row) => setDialog({ mode: 'pay', row })}
          onCancelPay={cancelPaymentOfBill}
          onSaveSettings={async (settings) => {
            await saveSettings(db, settings);
            await refresh();
          }}
          onClearSnapshot={clearSnapshot}
        />
      ) : (
        <LedgerView
          ledger={state.ledger}
          onAdd={openAdd}
          onEdit={(entry) => setDialog({ mode: 'edit', entry })}
          onDelete={remove}
          onCancelPayment={cancelPaymentOfEntry}
        />
      )}
      </ErrorBoundary>

      {dialog?.mode === 'bill' && (
        <BillDialog
          key={dialog.editing?.id ?? 'new-bill'}
          accounts={accounts}
          {...(dialog.editing ? { editing: dialog.editing } : {})}
          today={today}
          onClose={() => setDialog(null)}
          onSaved={billSaved}
        />
      )}

      {dialog?.mode === 'pay' && (
        <PayBillDialog
          key={dialog.row.bill.id}
          row={dialog.row}
          accounts={accounts}
          today={today}
          onClose={() => setDialog(null)}
          onPaid={billPaid}
        />
      )}

      {dialog && dialog.mode !== 'bill' && dialog.mode !== 'pay' && (
        <AddEntryDialog
          key={dialog.mode === 'edit' ? dialog.entry.id : dialog.mode === 'scan' ? 'scan' : 'add'}
          accounts={accounts}
          entries={state.ledger.entries}
          scan={dialog.mode === 'scan' ? dialog.draft : undefined}
          editing={dialog.mode === 'edit' ? dialog.entry : undefined}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}

      {scanning && <ScanStatus progress={scanning.progress} phase={scanning.phase} />}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <p>ปล่อยรูปสลิปที่นี่เพื่อสแกน</p>
        </div>
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
