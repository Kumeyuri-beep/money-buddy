import { useRef, useState, type KeyboardEvent } from 'react';
import type { Account, Entry } from '../domain/ledger/types';
import { PortfolioTransfer } from './PortfolioTransfer';
import { PortfolioView } from './PortfolioView';
import { UsOverview } from './UsOverview';
import { UsStocksView } from './UsStocksView';

interface Props {
  /** แท็บย่อยที่เปิดตอนเริ่ม (ปุ่ม + Add ของโหมด /invest เปิดหุ้นสหรัฐ ที่มีฟอร์มเพิ่มรายการ) */
  startTab?: 'overview' | 'us';
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  /** กระเป๋าเงินสดบาทที่เลือกจ่าย/รับเงินได้ (ป้ายเงินใช้จ่าย) */
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
}

type Tab = 'overview' | 'us';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'us', label: 'US stocks' },
];

/** หน้า "พอร์ตการลงทุน" แบบแท็บ (A3-2): ภาพรวมพอร์ต (ของเดิมครบ + ส่วนหุ้นสหรัฐเมื่อมีข้อมูล) และหุ้นสหรัฐ */
export default function PortfolioPage({ today, accounts, entries, wallets, onLedgerChanged, startTab }: Props) {
  const [tab, setTab] = useState<Tab>(startTab ?? 'overview');
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, us: null });

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = TABS[next]!.id;
    setTab(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="pf-page">
      <div className="pf-tabs" role="tablist" aria-label="Portfolio views">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`pf-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`pf-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={`pf-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' ? (
        <div role="tabpanel" id="pf-panel-overview" aria-labelledby="pf-tab-overview">
          <PortfolioView today={today} wallets={wallets} onLedgerChanged={onLedgerChanged} />
          <UsOverview today={today} accounts={accounts} entries={entries} />
          <PortfolioTransfer today={today} accounts={accounts} wallets={wallets} onLedgerChanged={onLedgerChanged} />
        </div>
      ) : (
        <div role="tabpanel" id="pf-panel-us" aria-labelledby="pf-tab-us">
          <UsStocksView today={today} accounts={accounts} entries={entries} wallets={wallets} onLedgerChanged={onLedgerChanged} />
        </div>
      )}
    </div>
  );
}
