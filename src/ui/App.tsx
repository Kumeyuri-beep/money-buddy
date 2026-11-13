import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thaiIsoDate, thaiMonthKeyLabel } from '../app/dates';
import { describeEntry } from '../app/describe';
import { walletOptions } from '../app/entryForm';
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
  clearMigrationSnapshot,
  migrationSnapshotInfo,
  type Ledger,
  type PayBillResult,
} from '../storage/repository';
import { friendlyError } from '../app/errorText';
import { useRepository } from './RepositoryContext';
import { AddEntryDialog } from './AddEntryDialog';
import { canRestoreDeletedBill } from '../domain/bills/restore';
import { BillDialog } from './BillDialog';
import { BillsView, type SnapshotInfo } from './BillsView';
import { PayBillDialog } from './PayBillDialog';
import { ErrorBoundary } from './ErrorBoundary';
import { Header } from './Header';
import { IntegrityBanner, IntegrityStatus } from './Integrity';
import { LedgerView } from './LedgerView';
import { Setup } from './Setup';
import { FORM_SETTINGS_KEYS, formSettingsPatch } from '../domain/bills/settingsPatch';
import { AccountView, AveragingView, PortfolioView, RetirementView, TaxPortfolioLink, TaxView, ViewLoading } from './lazyViews';
import { Shell, type ViewId } from './Shell';
import { ScanStatus } from './ScanStatus';
import { Toast } from './Toast';
import { useAccount } from './AuthContext';
import { Today } from './Today';
import { useSlipIntake } from './useSlipIntake';
import { useThaiToday } from './useThaiClock';

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
  /** ผิดพลาด: ใช้ role=alert และอยู่นานขึ้น */
  tone?: 'error';
  /** มีค่าเมื่อกดเลิกทำได้ */
  undo?: () => Promise<void>;
}

/** แถบแจ้งผลหายเองช้าลง (WCAG 2.2.1) และหยุดนับเมื่อเมาส์/โฟกัสอยู่บนแถบ · ข้อความผิดพลาดอยู่นานกว่า */
const TOAST_MS = 20_000;
const TOAST_ERROR_MS = 30_000;

/** ชื่อหน้า (ใช้เป็น document.title และให้โปรแกรมอ่านหน้าจอรู้ว่าหน้าเปลี่ยน) */
const VIEW_TITLE: Record<ViewId, string> = {
  today: 'ภาพรวม',
  ledger: 'รายรับ-รายจ่าย',
  bills: 'บิลและเป้า',
  account: 'โปรไฟล์',
  averaging: 'ถัวเฉลี่ยต้นทุน',
  portfolio: 'พอร์ตการลงทุน',
  retirement: 'วางแผนเกษียณ',
  tax: 'คำนวณภาษี',
};


export function App() {
  const repo = useRepository();
  const [state, setState] = useState<State>({ status: 'loading' });
  const { username, signOut } = useAccount();
  const [view, setView] = useState<ViewId>('today');
  // "วันนี้" ตามเวลาไทย อัปเดตเองเมื่อข้ามเที่ยงคืนหรือกลับมาเปิดแท็บ (ต้องเรียก hook ก่อน return ใดๆ)
  const today = useThaiToday();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [toastHeld, setToastHeld] = useState(false);
  // เลขลำดับของ toast: เปลี่ยนทุกครั้งที่ toast เปลี่ยน ให้ Toast ติดตั้งใหม่ (กัน held ค้าง และกัน role เปลี่ยนบน node เดิมจนโปรแกรมอ่านจอไม่อ่าน)
  const [toastSeq, setToastSeq] = useState(0);
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const scanLock = useRef(false);

  const refresh = useCallback(async () => {
    try {
      if (await repo.isEmpty()) setState({ status: 'setup' });
      else {
        const [ledger, bills, settings, snapshot] = await Promise.all([
          repo.loadLedger(),
          repo.loadBills(),
          repo.loadSettings(),
          migrationSnapshotInfo(db),
        ]);
        setState({ status: 'ready', ledger, bills, settings, snapshot });
      }
    } catch (e) {
      setState({ status: 'error', message: `เปิดที่เก็บข้อมูลไม่ได้ (${friendlyError(e, 'ลองโหลดหน้านี้ใหม่')})` });
    }
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ผลตรวจความถูกต้องของสมุดบัญชี คำนวณใหม่เมื่อข้อมูลเปลี่ยนเท่านั้น
  const integrity = useMemo(
    () => (state.status === 'ready' ? runIntegrityCheck(state.ledger.accounts, state.ledger.entries) : null),
    [state],
  );

  useEffect(() => {
    setToastHeld(false);
    setToastSeq((n) => n + 1);
  }, [toast]);

  useEffect(() => {
    if (!toast) return;
    if (toastHeld) return; // เมาส์/โฟกัสอยู่บนแถบ: ไม่นับเวลา
    const timer = window.setTimeout(() => setToast(null), toast.tone === 'error' ? TOAST_ERROR_MS : TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast, toastHeld]);

  // เปลี่ยนหน้า: ตั้งชื่อหน้า และย้ายโฟกัสไปหัวข้อหน้า (รอบแรกไม่ย้าย) เพื่อให้โปรแกรมอ่านหน้าจอรู้ว่าหน้าเปลี่ยน
  // รอ 60 ms: เมนูมือถือคืนโฟกัสให้ปุ่มลอยด้วย setTimeout 0 ต้องให้ย้ายโฟกัสของหน้าทำทีหลัง
  const firstView = useRef(true);
  useEffect(() => {
    document.title = `${VIEW_TITLE[view]} - Money Buddy`;
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    let attempt = 0;
    let timer = 0;
    const focusTitle = () => {
      // ถ้ามี dialog เปิดอยู่ หรือหน้าล้ม (กล่อง role=alert ย้ายโฟกัสของตัวเองแล้ว) ไม่แย่งโฟกัส
      if (document.querySelector('dialog[open]') || document.querySelector('main [role="alert"]')) return;
      const title = document.querySelector<HTMLElement>('main h2.page-title');
      // หน้าที่โหลดทีหลัง (lazy) ยังไม่มีหัวข้อ: รอแล้วลองใหม่ ครบเวลาแล้วค่อยไปที่เนื้อหาหลัก
      if (!title && attempt++ < 30) {
        timer = window.setTimeout(focusTitle, 100);
        return;
      }
      const target = title ?? document.getElementById('main');
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    timer = window.setTimeout(focusTitle, 60);
    return () => window.clearTimeout(timer);
  }, [view]);

  /** ทำงานหนึ่งอย่าง แล้วโหลดข้อมูลใหม่และแจ้งผล ถ้าพลาดแจ้งข้อความผิดพลาดแทน */
  const run = async (action: () => Promise<ToastState>) => {
    try {
      const next = await action();
      await refresh();
      setToast(next);
    } catch (e) {
      await refresh();
      setToast({ message: friendlyError(e), tone: 'error' });
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
      setToast({ message: friendlyError(e), tone: 'error' });
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
    // ออนไลน์: ฐานข้อมูลถามรหัสผ่านและจำกัดการลอง · ยกเลิก/รหัสผิดแจ้งทาง toast ไม่ล้างอะไร
    await run(async () => {
      await repo.resetAll();
      setView('today');
      return { message: 'ล้างข้อมูลทั้งหมดแล้ว' };
    });
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
        <p className="muted">ตรวจว่าอินเทอร์เน็ตใช้ได้ แล้วโหลดหน้านี้ใหม่ ข้อมูลของคุณยังอยู่ครบ ถ้ายังเป็นอีกให้แจ้งผู้ดูแล</p>
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
                await repo.updateEntry(before.id, before);
                return { message: 'ย้อนการแก้ไขแล้ว' };
              }),
          }
        : {
            message: `บันทึกแล้ว: ${label(entry)}`,
            undo: () =>
              run(async () => {
                await repo.deleteEntry(entry.id);
                return { message: 'เลิกทำแล้ว รายการถูกลบ' };
              }),
          },
    );
  };

  const remove = (entry: Entry) =>
    void run(async () => {
      const removed = await repo.deleteEntry(entry.id);
      return {
        message: `ลบแล้ว: ${label(removed)}`,
        undo: () =>
          run(async () => {
            await repo.appendEntry(removed);
            return { message: 'กู้คืนรายการแล้ว' };
          }),
      };
    });

  const billAmountText = (bill: Bill) => formatBaht(satang(bill.amount));

  const billSaved = (bill: Bill, before?: Bill) => {
    setDialog(null);
    void run(async () =>
      before
        ? {
            message: `แก้ไขบิลแล้ว: ${bill.name}`,
            undo: () =>
              run(async () => {
                await repo.updateBill(before);
                return { message: 'ย้อนการแก้ไขบิลแล้ว' };
              }),
          }
        : {
            message: `เพิ่มบิลแล้ว: ${bill.name} ${billAmountText(bill)}`,
            undo: () =>
              run(async () => {
                await repo.deleteBill(bill.id);
                return { message: 'เลิกทำแล้ว บิลถูกลบ' };
              }),
          },
    );
  };

  const removeBill = (bill: Bill) => {
    // บิลที่มีสถานะจ่ายซึ่งกู้คืนด้วยเลิกทำไม่ได้ (ไม่มีรายการจ่ายผูก เช่น จ่ายไว้ก่อนมีการผูกบิล): เก็บถาวรแทนลบ เพื่อไม่ให้บิลหายถาวร (M2-G)
    if (state.status === 'ready' && !canRestoreDeletedBill(bill, state.ledger.entries)) {
      if (!window.confirm(`เก็บถาวรบิล "${bill.name}"?\nบิลนี้บันทึกสถานะจ่ายไว้ก่อนมีการผูกรายการ ลบแล้วกู้คืนไม่ได้ จึงเก็บถาวร (ซ่อนจากรายการ ข้อมูลไม่หาย) แทน\nรายการเงินที่เคยจ่ายไปแล้วไม่ถูกลบ`)) return;
      void run(async () => {
        await repo.updateBill({ ...bill, archived: true });
        return {
          message: `เก็บถาวรบิลแล้ว: ${bill.name}`,
          undo: () =>
            run(async () => {
              await repo.updateBill({ ...bill, archived: false });
              return { message: 'นำบิลกลับมาแสดงแล้ว' };
            }),
        };
      });
      return;
    }
    if (!window.confirm(`ลบบิล "${bill.name}"?\nรายการเงินที่เคยจ่ายไปแล้วไม่ถูกลบ`)) return;
    void run(async () => {
      const removed = await repo.deleteBill(bill.id);
      return {
        message: `ลบบิลแล้ว: ${removed.name}`,
        undo: () =>
          run(async () => {
            await repo.addBill(removed, today);
            return { message: 'กู้คืนบิลแล้ว' };
          }),
      };
    });
  };

  /** นำบิลที่เก็บถาวรกลับมา (เลิกทำ = เก็บถาวรอีกครั้ง) · ไม่แตะรายการเงิน */
  const unarchiveBill = (bill: Bill) => {
    void run(async () => {
      await repo.updateBill({ ...bill, archived: false });
      return {
        message: `นำบิลกลับมาแสดงแล้ว: ${bill.name}`,
        undo: () =>
          run(async () => {
            await repo.updateBill({ ...bill, archived: true });
            return { message: `เก็บถาวรบิลอีกครั้งแล้ว: ${bill.name}` };
          }),
      };
    });
  };

  const billPaid = (row: BillRow, result: PayBillResult) => {
    setDialog(null);
    void run(async () => ({
      // แสดงยอดที่บันทึกจริง (อาจต่างจากยอดบิล) ไม่ใช่ยอดบิล
      message: `จ่ายบิลแล้ว: ${row.bill.name} ${formatBaht(satang(result.entry.lines[0]?.amount ?? row.bill.amount))} รอบ ${thaiMonthKeyLabel(result.cycle)}`,
      undo: () =>
        run(async () => {
          await repo.undoPayBill({ entryId: result.entry.id, billId: row.bill.id, cycle: result.cycle, before: result.before });
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
      await repo.cancelBillPayment(entry.id);
      return { message: `ยกเลิกการจ่ายแล้ว: ${entry.memo}` };
    });
  };

  const cancelPaymentOfBill = (bill: Bill) => {
    if (!confirmCancel(bill.name, bill.lastPaidMonth)) return;
    void run(async () => {
      await repo.cancelLatestBillPayment(bill.id);
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
      accountName={username}
      onSignOut={() => void signOut()}
      current={view}
      onNavigate={setView}
      onAdd={openAdd}
      status={integrity ? <IntegrityStatus report={integrity} /> : null}
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
      <Suspense fallback={<ViewLoading />}>
      {view === 'today' ? (
        <Today
          ledger={state.ledger}
          onAdd={openAdd}
          onOpenLedger={() => setView('ledger')}
          finance={{ bills: state.bills, settings: state.settings }}
          onOpenBills={() => setView('bills')}
          onOpenPortfolio={() => setView('portfolio')}
          onOpenRetirement={() => setView('retirement')}
          onOpenAveraging={() => setView('averaging')}
          onOpenTax={() => setView('tax')}
          today={today}
        />
      ) : view === 'account' ? (
        <AccountView onReset={() => void reset()} onWalletsChanged={() => void refresh()} />
      ) : view === 'averaging' ? (
        <AveragingView />
      ) : view === 'retirement' ? (
        <RetirementView today={today} />
      ) : view === 'tax' ? (
        <TaxView portfolio={(fill, current) => <TaxPortfolioLink onFill={fill} current={current} />} />
      ) : view === 'portfolio' ? (
        <PortfolioView today={today} wallets={walletOptions(accounts).map((a) => ({ id: a.id, name: a.name }))} onLedgerChanged={() => void refresh()} />
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
          onUnarchive={unarchiveBill}
          onSaveSettings={async (settings, baseline) => {
            try {
              // เขียนเฉพาะคีย์ของฟอร์ม (ไม่แตะแผน DCA/รายชื่อเกษียณ/ป้ายภาษี) แบบ compare-and-set กับค่าที่ฟอร์มแสดงอยู่
              await repo.updateSettings(FORM_SETTINGS_KEYS, () => formSettingsPatch(settings), { baseline });
            } finally {
              await refresh(); // ชนกับแท็บอื่นก็โหลดค่าล่าสุดมาแสดง
            }
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
      </Suspense>
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
          key={toastSeq}
          message={toast.message}
          actionLabel={toast.undo ? 'เลิกทำ' : undefined}
          onAction={toast.undo ? () => void toast.undo?.() : undefined}
          onDismiss={() => setToast(null)}
          tone={toast.tone}
          onHold={setToastHeld}
        />
      )}
    </Shell>
  );
}
