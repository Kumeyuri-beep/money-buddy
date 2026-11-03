import { useMemo } from 'react';
import { localIsoDate } from '../app/dates';
import type { Ledger } from '../storage/repository';
import { CashFlowSankey } from './overview/CashFlowSankey';
import { RetirementPanel, UpcomingBills } from './overview/EmptyPanels';
import { RecentEntries } from './overview/RecentEntries';
import { SummaryCards } from './overview/SummaryCards';
import { Wallets } from './overview/Wallets';

interface TodayProps {
  ledger: Ledger;
  onAdd: () => void;
  onOpenLedger: () => void;
}

export function Today({ ledger, onAdd, onOpenLedger }: TodayProps) {
  const { accounts, entries } = ledger;
  const today = useMemo(() => localIsoDate(new Date()), []);

  return (
    <>
      <SummaryCards accounts={accounts} entries={entries} today={today} onOpenLedger={onOpenLedger} />

      <CashFlowSankey accounts={accounts} entries={entries} today={today} />

      <div className="row">
        <Wallets accounts={accounts} entries={entries} />
        <UpcomingBills />
      </div>

      <div className="row">
        <RecentEntries accounts={accounts} entries={entries} today={today} onAdd={onAdd} onOpenLedger={onOpenLedger} />
        <RetirementPanel />
      </div>
    </>
  );
}
