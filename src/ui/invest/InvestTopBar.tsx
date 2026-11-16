import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { PORTFOLIO_NAME_MAX, PORTFOLIO_NOTE_MAX } from '../../domain/bills/settings';
import { TipButton } from './Tip';
import type { InvestCurrency, PortfolioSettings } from './InvestContext';

export type InvestTab = 'dashboard' | 'analysis' | 'transactions' | 'tools';
export const INVEST_TABS: { id: InvestTab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'analysis', label: 'Analytics' },
  { id: 'transactions', label: 'Portfolio' },
  { id: 'tools', label: 'Tools' },
];

const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]![0] ?? ''}${words[1]![0] ?? ''}` : (words[0] ?? '').slice(0, 2);
  return letters.toUpperCase() || 'MP';
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

interface MenuProps {
  portfolio: PortfolioSettings;
  onSave: (next: PortfolioSettings) => Promise<void>;
}

/** เมนูพอร์ต: ชื่อพอร์ต + Edit portfolio (Name / Description / Default currency) · Add a portfolio และ My portfolios ยังไม่เปิดใช้ */
function PortfolioMenu({ portfolio, onSave }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(portfolio.name);
  const [note, setNote] = useState(portfolio.note);
  const [cur, setCur] = useState<InvestCurrency>(portfolio.currency);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const reset = () => {
    setName(portfolio.name);
    setNote(portfolio.note);
    setCur(portfolio.currency);
    setError('');
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    reset();
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    }
  };

  const save = async () => {
    const n = name.trim();
    const d = note.trim();
    if (n === '') return setError('Enter a name.');
    if (n.length > PORTFOLIO_NAME_MAX) return setError(`Name can be up to ${PORTFOLIO_NAME_MAX} characters.`);
    if (d.length > PORTFOLIO_NOTE_MAX) return setError(`Description can be up to ${PORTFOLIO_NOTE_MAX} characters.`);
    setSaving(true);
    setError('');
    try {
      await onSave({ name: n, note: d, currency: cur });
      setOpen(false);
      buttonRef.current?.focus();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="iv-menu" ref={rootRef} onKeyDown={onKey}>
      <button ref={buttonRef} type="button" className="iv-portfolio-btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => (open ? close(false) : setOpen(true))}>
        <span className="iv-avatar" aria-hidden="true">
          {initials(portfolio.name)}
        </span>
        <span className="iv-portfolio-name">{portfolio.name}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="iv-menu-panel" id={panelId} role="dialog" aria-label="Portfolio">
          <div className="iv-menu-head">
            <span className="iv-avatar iv-avatar-lg" aria-hidden="true">
              {initials(portfolio.name)}
            </span>
            <strong>{portfolio.name}</strong>
          </div>
          <form
            className="iv-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <h3 className="iv-edit-title">
              <Icon d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
              Edit portfolio
            </h3>
            <label className="iv-field">
              <span>Name</span>
              <input value={name} maxLength={PORTFOLIO_NAME_MAX + 10} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </label>
            <label className="iv-field">
              <span>Description (optional)</span>
              <input value={note} maxLength={PORTFOLIO_NOTE_MAX + 20} placeholder="e.g. Long-term US stocks" onChange={(e) => setNote(e.target.value)} autoComplete="off" />
            </label>
            <label className="iv-field">
              <span>Default currency</span>
              <select value={cur} onChange={(e) => setCur(e.target.value === 'USD' ? 'USD' : 'THB')}>
                <option value="THB">THB (฿)</option>
                <option value="USD">USD ($)</option>
              </select>
            </label>
            {error !== '' && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="iv-edit-actions">
              <button type="button" className="iv-btn" onClick={() => close(true)}>
                Cancel
              </button>
              <button type="submit" className="iv-btn iv-btn-gold" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
          <div className="iv-menu-foot">
            <TipButton className="iv-btn" tip="Coming soon">
              + Add a portfolio
            </TipButton>
            <TipButton className="iv-btn" tip="Coming soon">
              My portfolios
            </TipButton>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  tab: InvestTab;
  onTab: (t: InvestTab) => void;
  tabRefs: RefObject<Record<InvestTab, HTMLButtonElement | null>>;
  onAdd: () => void;
  currency: InvestCurrency;
  onCurrency: (c: InvestCurrency) => void;
  portfolio: PortfolioSettings;
  onSavePortfolio: (next: PortfolioSettings) => Promise<void>;
}

/** แถบบนของโหมด /invest (ภาษาอังกฤษ): แท็บซ้าย · ปุ่มขวา (AI, Add, Search, Watchlist, สกุล, เมนูพอร์ต) */
export function InvestTopBar({ tab, onTab, tabRefs, onAdd, currency, onCurrency, portfolio, onSavePortfolio }: Props) {
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % INVEST_TABS.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + INVEST_TABS.length) % INVEST_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = INVEST_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = INVEST_TABS[next]!.id;
    onTab(id);
    tabRefs.current?.[id]?.focus();
  };

  return (
    <div className="iv-topbar glass-lite" lang="en">
      <div className="iv-tabs" role="tablist" aria-label="Portfolio sections">
        {INVEST_TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              if (tabRefs.current) tabRefs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`inv-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="inv-panel"
            tabIndex={tab === t.id ? 0 : -1}
            className={`iv-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="iv-actions">
        <TipButton className="iv-icon-btn iv-ai" tip="Ask AI — coming soon" ariaLabel="Ask AI">
          <Icon d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
        </TipButton>
        <button type="button" className="iv-btn iv-add" onClick={onAdd}>
          <Icon d="M12 5v14M5 12h14" />
          Add
        </button>
        <TipButton className="iv-icon-btn" tip="Search — available after automatic data is enabled" ariaLabel="Search">
          <Icon d="M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4" />
        </TipButton>
        <TipButton className="iv-icon-btn" tip="Watchlist — available after automatic data is enabled" ariaLabel="Watchlist">
          <Icon d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8L3.5 9.7l5.9-.9z" />
        </TipButton>
        <div className="iv-currency" role="group" aria-label="Currency">
          {(['THB', 'USD'] as const).map((c) => (
            <button key={c} type="button" className={`iv-cur${currency === c ? ' is-active' : ''}`} aria-pressed={currency === c} onClick={() => onCurrency(c)}>
              {c === 'THB' ? '฿ THB' : '$ USD'}
            </button>
          ))}
        </div>
        <PortfolioMenu key={`${portfolio.name}|${portfolio.note}|${portfolio.currency}`} portfolio={portfolio} onSave={onSavePortfolio} />
      </div>
    </div>
  );
}
