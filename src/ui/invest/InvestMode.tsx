import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { investError } from './investError';
import { buildInvestBadge } from '../../app/investBadge';
import type { InvestmentData } from '../../domain/invest/types';
import type { Account, Entry } from '../../domain/ledger/types';
import { useRepository } from '../RepositoryContext';
import { AnalysisTab } from './AnalysisTab';
import { DashboardTab } from './DashboardTab';
import { DEFAULT_PORTFOLIO_NAME, InvestContext, type InvestCurrency, type PortfolioSettings } from './InvestContext';
import { InvestTopBar, type InvestTab } from './InvestTopBar';
import { ToolsTab } from './ToolsTab';
import { TransactionsTab } from './TransactionsTab';
import './invest.css';

interface Props {
  today: string;
  accounts: readonly Account[];
  entries: readonly Entry[];
  wallets: readonly { id: string; name: string }[];
  onLedgerChanged: () => void;
  onOpenRetirement?: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** YYYY-MM-DD → "16 Nov" (ข้อความล้วน ไม่ใช้ Date จึงไม่ขึ้นกับเขตเวลา) */
function shortDate(iso: string): string {
  const m = MONTHS[Number(iso.slice(5, 7)) - 1] ?? '';
  return `${Number(iso.slice(8, 10))} ${m}`;
}

const DEFAULT_PORTFOLIO: PortfolioSettings = { name: DEFAULT_PORTFOLIO_NAME, note: '', currency: 'THB' };

/**
 * โหมดการลงทุน (/invest): แถบบน (แท็บ + ปุ่ม) + ชื่อพอร์ต + แท็บที่เลือก · ข้อความทั้งโหมดเป็นภาษาอังกฤษ
 * โหลดข้อมูลลงทุนครั้งเดียวที่นี่แล้วแชร์ทุกแท็บผ่าน InvestContext · เป็นไฟล์ที่โหลดแยก (lazy chunk)
 * ชื่อ/คำอธิบาย/สกุลเริ่มต้นของพอร์ตเก็บในตาราง settings เดิม (portfolioName / portfolioNote / portfolioCurrency) ไม่ต้อง migration
 */
export default function InvestMode({ today, accounts, entries, wallets, onLedgerChanged, onOpenRetirement }: Props) {
  const repo = useRepository();
  const [tab, setTab] = useState<InvestTab>('dashboard');
  const [addSignal, setAddSignal] = useState(0);
  const [portfolio, setPortfolio] = useState<PortfolioSettings>(DEFAULT_PORTFOLIO);
  const [currency, setCurrency] = useState<InvestCurrency>('THB');
  const [data, setData] = useState<InvestmentData | null>(null);
  const [loadError, setLoadError] = useState('');
  const refs = useRef<Record<InvestTab, HTMLButtonElement | null>>({ dashboard: null, analysis: null, transactions: null, tools: null });
  const touchedCurrency = useRef(false);

  const reload = useCallback(async () => {
    try {
      setData(await repo.loadInvestments());
      setLoadError('');
    } catch (e) {
      setLoadError(investError(e));
    }
  }, [repo]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // ชื่อ/คำอธิบาย/สกุลเริ่มต้นของพอร์ต: อ่านครั้งเดียว (อ่านไม่ได้ = ใช้ค่าเริ่มต้น ไม่ขัดการใช้งาน)
  useEffect(() => {
    let alive = true;
    void repo
      .loadSettings()
      .then((s) => {
        if (!alive) return;
        const next: PortfolioSettings = { name: s.portfolioName ?? DEFAULT_PORTFOLIO_NAME, note: s.portfolioNote ?? '', currency: s.portfolioCurrency ?? 'THB' };
        setPortfolio(next);
        if (!touchedCurrency.current) setCurrency(next.currency);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [repo]);

  const savePortfolio = useCallback(
    async (next: PortfolioSettings) => {
      await repo.updateSettings(['portfolioName', 'portfolioNote', 'portfolioCurrency'], () => ({
        portfolioName: next.name,
        portfolioNote: next.note === '' ? null : next.note,
        portfolioCurrency: next.currency,
      }));
      setPortfolio(next);
      touchedCurrency.current = true;
      setCurrency(next.currency);
    },
    [repo],
  );

  const changeCurrency = useCallback((c: InvestCurrency) => {
    touchedCurrency.current = true;
    setCurrency(c);
  }, []);

  const openAdd = useCallback(() => {
    setTab('transactions');
    setAddSignal((n) => n + 1);
  }, []);

  const badge = useMemo(() => buildInvestBadge(data, today), [data, today]);
  const ctx = useMemo(
    () => ({ today, accounts, entries, wallets, data, loadError, reload, onLedgerChanged, onOpenRetirement, currency, setCurrency: changeCurrency, portfolio }),
    [today, accounts, entries, wallets, data, loadError, reload, onLedgerChanged, onOpenRetirement, currency, changeCurrency, portfolio],
  );

  return (
    <InvestContext.Provider value={ctx}>
      <div className="invest-mode iv-mode">
        <InvestTopBar tab={tab} onTab={setTab} tabRefs={refs} onAdd={openAdd} currency={currency} onCurrency={changeCurrency} portfolio={portfolio} onSavePortfolio={savePortfolio} />
        <header className="iv-head" lang="en">
          <div>
            <h2 className="iv-title" id="invest-title">
              {portfolio.name}
            </h2>
            {portfolio.note !== '' && <p className="iv-note">{portfolio.note}</p>}
          </div>
          {data !== null && (
            <p className="iv-badge" role="status">
              {badge.updatedOn ? `Updated ${shortDate(badge.updatedOn)}` : 'No prices or rates yet'}
              {badge.rateText ? ` · ${badge.rateText}` : ''}
            </p>
          )}
        </header>
        {loadError !== '' && (
          <div role="alert">
            <p className="form-error">Could not load portfolio data: {loadError}</p>
            <button type="button" className="iv-btn" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        )}
        <div role="tabpanel" id="inv-panel" tabIndex={0} aria-labelledby={`inv-tab-${tab}`}>
          {data === null && loadError === '' ? (
            <p className="iv-empty">Loading portfolio…</p>
          ) : tab === 'dashboard' ? (
            <DashboardTab />
          ) : tab === 'analysis' ? (
            <AnalysisTab />
          ) : tab === 'transactions' ? (
            <TransactionsTab key={addSignal} startTab={addSignal > 0 ? 'us' : undefined} />
          ) : (
            <ToolsTab />
          )}
        </div>
      </div>
    </InvestContext.Provider>
  );
}
