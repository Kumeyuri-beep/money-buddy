import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { friendlyError } from '../../app/errorText';
import { thaiDayLabel } from '../../app/dates';
import { buildInvestBadge } from '../../app/investBadge';
import type { InvestmentData } from '../../domain/invest/types';
import type { Account, Entry } from '../../domain/ledger/types';
import { useRepository } from '../RepositoryContext';
import { AnalysisTab } from './AnalysisTab';
import { DashboardTab } from './DashboardTab';
import { DividendCalendarTab } from './DividendCalendarTab';
import { InvestContext, type InvestCurrency } from './InvestContext';
import { TransactionsTab } from './TransactionsTab';

interface Props {
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
}

type Tab = 'dashboard' | 'analysis' | 'transactions' | 'calendar';
const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'แดชบอร์ด' },
  { id: 'analysis', label: 'วิเคราะห์' },
  { id: 'transactions', label: 'รายการ' },
  { id: 'calendar', label: 'ปฏิทินปันผล' },
];

/**
 * โหมดการลงทุน (/invest · ขั้น 1 ปรับโครงเว็บ): หัวข้อ "พอร์ตการลงทุน" + ปุ่มสลับ ฿/USD + ป้ายอัปเดต/อัตรา + 4 แท็บ
 * โหลดข้อมูลลงทุนครั้งเดียวที่นี่แล้วแชร์ทุกแท็บผ่าน InvestContext · เป็นไฟล์ที่โหลดแยก (lazy chunk) ไม่อยู่ในก้อนหลักของหน้าหลัก
 */
export default function InvestMode({ today, accounts, entries, wallets, onLedgerChanged }: Props) {
  const repo = useRepository();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [currency, setCurrency] = useState<InvestCurrency>('THB');
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ dashboard: null, analysis: null, transactions: null, calendar: null });

  const reload = useCallback(async () => {
    try {
      setData(await repo.loadInvestments());
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e));
    }
  }, [repo]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const badge = useMemo(() => buildInvestBadge(data, today), [data, today]);
  const ctx = useMemo(
    () => ({ today, accounts, entries, wallets, data, loadError, reload, onLedgerChanged, currency, setCurrency }),
    [today, accounts, entries, wallets, data, loadError, reload, onLedgerChanged, currency],
  );

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
    <InvestContext.Provider value={ctx}>
      <div className="invest-mode">
        <header className="invest-head">
          <h2 className="page-title" id="invest-title">
            พอร์ตการลงทุน
          </h2>
          <div className="invest-head-tools">
            <div className="invest-currency" role="group" aria-label="สกุลเงินที่แสดง">
              {(['THB', 'USD'] as const).map((c) => (
                <button key={c} type="button" className={`invest-cur${currency === c ? ' is-active' : ''}`} aria-pressed={currency === c} onClick={() => setCurrency(c)}>
                  {c === 'THB' ? '฿' : 'USD'}
                </button>
              ))}
            </div>
            <p className="invest-badge muted small" role="status">
              {badge.updatedOn ? `อัปเดต ${thaiDayLabel(badge.updatedOn)}` : 'ยังไม่มีราคา/อัตรา'}
              {badge.rateText ? ` · อัตรา ${badge.rateText}` : ''}
            </p>
          </div>
        </header>
        {loadError !== '' && (
          <div role="alert">
            <p className="form-error">โหลดข้อมูลพอร์ตไม่สำเร็จ: {loadError}</p>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void reload()}>
              ลองโหลดใหม่
            </button>
          </div>
        )}
        <div className="pf-tabs invest-tabs" role="tablist" aria-label="หน้าย่อยของโหมดการลงทุน">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`inv-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`inv-panel-${t.id}`}
              tabIndex={tab === t.id ? 0 : -1}
              className={`pf-tab${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`inv-panel-${tab}`} aria-labelledby={`inv-tab-${tab}`}>
          {tab === 'dashboard' ? <DashboardTab /> : tab === 'analysis' ? <AnalysisTab /> : tab === 'transactions' ? <TransactionsTab /> : <DividendCalendarTab />}
        </div>
      </div>
    </InvestContext.Provider>
  );
}
