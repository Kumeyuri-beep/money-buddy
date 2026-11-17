import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { groupOfPage, INVEST_GROUPS, investPage, type InvestMenuGroup, type InvestPageId } from '../../app/investRoute';
import { PORTFOLIO_NAME_MAX, PORTFOLIO_NOTE_MAX } from '../../domain/bills/settings';
import { TipButton } from './Tip';
import type { InvestCurrency, PortfolioSettings } from './InvestContext';

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
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
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
  page: InvestPageId;
  /** ไปหน้าที่เลือก (ผู้ใช้กดเมนู: InvestMode ผูก history และย้ายโฟกัสมาที่เนื้อหา) */
  onNavigate: (id: InvestPageId) => void;
  /** URL จริงของแต่ละหน้า (ใส่ใน href เพื่อเปิดแท็บใหม่/คัดลอกลิงก์ได้) */
  hrefFor: (id: InvestPageId) => string;
  /** ปุ่ม Add: ไปหน้า Holdings (ฟอร์มเพิ่มรายการ) */
  onAdd: () => void;
  currency: InvestCurrency;
  onCurrency: (c: InvestCurrency) => void;
  portfolio: PortfolioSettings;
  onSavePortfolio: (next: PortfolioSettings) => Promise<void>;
}

const isPlainClick = (e: ReactMouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * เมนูหลักของโหมด /invest: Dashboard เป็นลิงก์ · Analytics / Portfolio / Tools เป็นปุ่มที่เปิดเมนูเลื่อนลง
 * เปิดด้วย: ชี้เมาส์ · โฟกัสด้วยคีย์บอร์ด · กด/แตะ (มือถือ) · ลูกศรลง · ปิดด้วย Esc / คลิกที่อื่น / โฟกัสออก
 * คีย์บอร์ด: ลูกศรลง/ขึ้น เลื่อนระหว่างรายการ · ซ้าย/ขวา ข้ามไปเมนูหลักข้างเคียง · Home/End ไปรายการแรก/สุดท้าย
 */
function MainNav({ page, onNavigate, hrefFor }: Pick<Props, 'page' | 'onNavigate' | 'hrefFor'>) {
  const [open, setOpen] = useState<InvestMenuGroup['id'] | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const openedByHover = useRef(false);
  const skipFocusOpen = useRef(false); // ตอนคืนโฟกัสให้ปุ่มหลังกด Esc ห้ามเปิดเมนูซ้ำ
  const activeGroup = groupOfPage(page);

  const triggers = (): HTMLElement[] => Array.from(navRef.current?.querySelectorAll<HTMLElement>('[data-iv-trigger]') ?? []);
  const itemsOf = (id: string): HTMLElement[] => Array.from(navRef.current?.querySelectorAll<HTMLElement>(`[data-iv-panel="${id}"] [data-iv-item]:not(:disabled)`) ?? []);
  const triggerOf = (id: string): HTMLElement | null => navRef.current?.querySelector<HTMLElement>(`[data-iv-trigger="${id}"]`) ?? null;
  const close = (returnFocusTo?: string) => {
    setOpen(null);
    openedByHover.current = false;
    if (returnFocusTo) {
      skipFocusOpen.current = true;
      triggerOf(returnFocusTo)?.focus();
      skipFocusOpen.current = false;
    }
  };

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: Event) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(null);
        openedByHover.current = false;
      }
    };
    // Esc ปิดเมนูได้แม้โฟกัสอยู่นอกแถบ (เช่น เปิดด้วยเมาส์ชี้) · กรณีโฟกัสอยู่ในแถบ onKeyDown ของ nav จัดการและคืนโฟกัสให้ปุ่มแล้ว
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      openedByHover.current = false;
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const el = e.target as HTMLElement;
    const trigger = el.closest<HTMLElement>('[data-iv-trigger]');
    const panel = el.closest<HTMLElement>('[data-iv-panel]');
    const groupId = (trigger?.getAttribute('data-iv-trigger') ?? panel?.getAttribute('data-iv-panel')) as InvestMenuGroup['id'] | null;
    if (e.key === 'Escape' && open !== null) {
      e.preventDefault();
      e.stopPropagation();
      close(open);
      return;
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && groupId) {
      const list = triggers();
      const from = triggerOf(groupId);
      if (!from) return;
      e.preventDefault();
      const next = list[(list.indexOf(from) + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
      next?.focus();
      const nextId = next?.getAttribute('data-iv-trigger') ?? null;
      // ถ้าเมนูเปิดอยู่ ให้เมนูข้างเคียงเปิดตาม (ยกเว้น Dashboard ที่ไม่มีเมนูย่อย)
      if (open !== null) setOpen(next?.tagName === 'BUTTON' && nextId ? (nextId as InvestMenuGroup['id']) : null);
      return;
    }
    if (trigger && trigger.tagName === 'BUTTON' && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && groupId) {
      e.preventDefault();
      setOpen(groupId);
      const focusEnd = () => {
        const items = itemsOf(groupId);
        (e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
      };
      if (open === groupId) focusEnd();
      else requestAnimationFrame(focusEnd);
      return;
    }
    if (panel && groupId && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const items = itemsOf(groupId);
      const i = items.indexOf(el);
      if (e.key === 'Home') items[0]?.focus();
      else if (e.key === 'End') items[items.length - 1]?.focus();
      else if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
      else if (i <= 0) triggerOf(groupId)?.focus();
      else items[i - 1]?.focus();
    }
  };

  return (
    <nav className="iv-nav" aria-label="Portfolio sections" ref={navRef} onKeyDown={onKeyDown}>
      {INVEST_GROUPS.map((g) => {
        const active = activeGroup === g.id;
        if (g.page) {
          const target = g.page;
          return (
            <div className="iv-nav-item" key={g.id}>
              <a
                href={hrefFor(target)}
                data-iv-trigger={g.id}
                className={`iv-tab${active ? ' is-active' : ''}`}
                aria-current={page === target ? 'page' : undefined}
                onClick={(e) => {
                  if (!isPlainClick(e)) return;
                  e.preventDefault();
                  close();
                  onNavigate(target);
                }}
              >
                {g.label}
              </a>
            </div>
          );
        }
        const isOpen = open === g.id;
        const panelId = `iv-menu-${g.id}`;
        return (
          <div
            className={`iv-nav-item${isOpen ? ' is-open' : ''}`}
            key={g.id}
            onPointerEnter={(e) => {
              if (e.pointerType !== 'mouse') return;
              if (open !== g.id) openedByHover.current = true;
              setOpen(g.id);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === 'mouse' && open === g.id) close();
            }}
            onFocus={(e) => {
              // เปิดเมื่อโฟกัสปุ่มหลักด้วยคีย์บอร์ดเท่านั้น (คลิกด้วยเมาส์/แตะ ให้ onClick จัดการเอง)
              const t = e.target as HTMLElement;
              if (!skipFocusOpen.current && t.hasAttribute('data-iv-trigger') && t.matches(':focus-visible')) setOpen(g.id);
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen((cur) => (cur === g.id ? null : cur));
            }}
          >
            <button
              type="button"
              data-iv-trigger={g.id}
              id={`iv-trigger-${g.id}`}
              className={`iv-tab${active ? ' is-active' : ''}`}
              aria-expanded={isOpen}
              aria-controls={isOpen ? panelId : undefined}
              onClick={(e) => {
                if (isOpen && e.detail === 0) {
                  // Enter/Space ขณะเมนูเปิดอยู่ (เปิดจากโฟกัส) = เข้าไปเลือกรายการ ไม่ใช่ปิด
                  itemsOf(g.id)[0]?.focus();
                } else if (isOpen && !openedByHover.current) close();
                else {
                  openedByHover.current = false;
                  setOpen(g.id);
                }
              }}
            >
              {g.label}
              <span className="iv-caret" aria-hidden="true">
                ▾
              </span>
            </button>
            {isOpen && (
              <div className="iv-submenu" id={panelId} data-iv-panel={g.id} role="group" aria-labelledby={`iv-trigger-${g.id}`}>
                {g.sections.map((s, si) => (
                  <ul className="iv-submenu-sec" key={si}>
                    {s.items.map((it) => (
                      <li key={it.label}>
                        {it.kind === 'external' ? (
                          <a data-iv-item className="iv-submenu-link" href={it.href} target="_blank" rel="noopener noreferrer" onClick={() => close(g.id)}>
                            {it.label}
                            <span className="iv-ext" aria-hidden="true">
                              ↗
                            </span>
                            <span className="sr-only">(opens in a new tab)</span>
                          </a>
                        ) : (
                          <a
                            data-iv-item
                            className="iv-submenu-link"
                            href={hrefFor(it.page!)}
                            aria-current={page === it.page ? 'page' : undefined}
                            onClick={(e) => {
                              if (!isPlainClick(e)) return;
                              e.preventDefault();
                              close();
                              onNavigate(it.page!);
                            }}
                          >
                            {it.label}
                            {investPage(it.page!).status === 'soon' && <span className="iv-submenu-hint">Soon</span>}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/** แถบบนของโหมด /invest (ภาษาอังกฤษ): เมนูหลักซ้าย (มีเมนูเลื่อนลง) · ปุ่มขวา (AI, Add, Search, Watchlist, สกุล, เมนูพอร์ต) */
export function InvestTopBar({ page, onNavigate, hrefFor, onAdd, currency, onCurrency, portfolio, onSavePortfolio }: Props) {
  return (
    <div className="iv-topbar glass-lite" lang="en">
      <MainNav page={page} onNavigate={onNavigate} hrefFor={hrefFor} />
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
