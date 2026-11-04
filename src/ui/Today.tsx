import { useMemo } from 'react';
import { localIsoDate } from '../app/dates';
import type { Ledger } from '../storage/repository';
import { CashFlowSankey } from './overview/CashFlowSankey';
import type { FinanceInput } from '../app/billsOverview';
import { RetirementPanel } from './overview/EmptyPanels';
import { UpcomingBillsPanel } from './overview/UpcomingBillsPanel';
import { RecentEntries } from './overview/RecentEntries';
import { SummaryCards } from './overview/SummaryCards';
import { Wallets } from './overview/Wallets';

interface TodayProps {
  ledger: Ledger;
  onAdd: () => void;
  onOpenLedger: () => void;
  finance: FinanceInput;
  onOpenBills: () => void;
}

export function Today({ ledger, onAdd, onOpenLedger, finance, onOpenBills }: TodayProps) {
  const { accounts, entries } = ledger;
  const today = useMemo(() => localIsoDate(new Date()), []);

  return (
    <>
      <SummaryCards accounts={accounts} entries={entries} today={today} finance={finance} onOpenLedger={onOpenLedger} onOpenBills={onOpenBills} />

      <CashFlowSankey accounts={accounts} entries={entries} today={today} />

      <div className="row">
        <Wallets accounts={accounts} entries={entries} />
        <UpcomingBillsPanel finance={finance} today={today} onOpenBills={onOpenBills} />
      </div>

      <div className="row">
        <RecentEntries accounts={accounts} entries={entries} today={today} onAdd={onAdd} onOpenLedger={onOpenLedger} />
        <RetirementPanel />
      </div>
    </>
  );
}
