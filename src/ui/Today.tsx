import type { Ledger } from '../storage/repository';
import { parseCashFlowView, type CashFlowView } from '../app/cashFlowView';
import { CashFlowSankey } from './overview/CashFlowSankey';
import type { FinanceInput } from '../app/billsOverview';
import { AllocationPanel } from './overview/AllocationPanel';
import { ToolsPanel } from './overview/ToolsPanel';
import { UpcomingBillsPanel } from './overview/UpcomingBillsPanel';
import { RecentEntries } from './overview/RecentEntries';
import { BackupReminder } from './overview/BackupReminder';
import { StartGuide } from './overview/StartGuide';
import { SummaryCards } from './overview/SummaryCards';
import { WealthPanel } from './overview/WealthPanel';
import { Wallets } from './overview/Wallets';

interface TodayProps {
  ledger: Ledger;
  onAdd: () => void;
  onOpenLedger: () => void;
  finance: FinanceInput;
  onOpenBills: () => void;
  onOpenPortfolio: () => void;
  onOpenRetirement: () => void;
  onOpenAveraging: () => void;
  onOpenTax: () => void;
  /** "วันนี้" ตามเวลาไทย (YYYY-MM-DD) จาก App ซึ่งอัปเดตเองเมื่อข้ามเที่ยงคืน */
  today: string;
  /** แถบเตือนสำรองข้อมูล (ไม่ส่ง = ไม่แสดง) */
  backup?: { onDownload: () => void; onSnooze: () => void; note?: string };
  /** บันทึกมุมมองการ์ดเงินเข้า-ออกบนมือถือ (ไม่ส่ง = สลับได้แต่ไม่จำ) */
  onCashFlowView?: (view: CashFlowView) => Promise<void>;
}

export function Today({ ledger, onAdd, onOpenLedger, finance, onOpenBills, onOpenPortfolio, onOpenRetirement, onOpenAveraging, onOpenTax, today, backup, onCashFlowView }: TodayProps) {
  const { accounts, entries } = ledger;

  return (
    <>
      <h2 className="page-title sr-only">ภาพรวม</h2>
      <StartGuide entries={entries} finance={finance} onAdd={onAdd} onOpenBills={onOpenBills} />
      {backup && <BackupReminder entries={entries} settings={finance.settings} today={today} onDownload={backup.onDownload} onSnooze={backup.onSnooze} note={backup.note} />}
      <SummaryCards accounts={accounts} entries={entries} today={today} finance={finance} onOpenLedger={onOpenLedger} onOpenBills={onOpenBills} onAdd={onAdd} />

      <WealthPanel accounts={accounts} entries={entries} today={today} />

      <CashFlowSankey accounts={accounts} entries={entries} today={today} view={parseCashFlowView(finance.settings.cashFlowView)} onViewChange={onCashFlowView} />

      <div className="row">
        <Wallets accounts={accounts} entries={entries} />
        <UpcomingBillsPanel finance={finance} today={today} onOpenBills={onOpenBills} />
      </div>

      <div className="row">
        <RecentEntries accounts={accounts} entries={entries} today={today} onAdd={onAdd} onOpenLedger={onOpenLedger} />
        <AllocationPanel today={today} onOpenPortfolio={onOpenPortfolio} />
      </div>

      <ToolsPanel onOpenPortfolio={onOpenPortfolio} onOpenAveraging={onOpenAveraging} onOpenRetirement={onOpenRetirement} onOpenTax={onOpenTax} />
    </>
  );
}
