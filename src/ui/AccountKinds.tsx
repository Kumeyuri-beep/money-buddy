import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../app/errorText';
import { checkAccountKindChange } from '../domain/invest/portfolioMoney';
import type { InvestmentData } from '../domain/invest/types';
import type { Account } from '../domain/ledger/types';
import type { Bill } from '../domain/bills/types';
import { useRepository } from './RepositoryContext';

type Kind = 'normal' | 'investment';

interface Pending {
  id: string;
  name: string;
  next: Kind;
}

/**
 * ป้ายบัญชีเงินสดบาท: "เงินใช้จ่าย" / "เงินลงทุน" (A3-2 · R23) · แบ่งสองกลุ่ม เปลี่ยนป้ายได้แม้มีรายการแล้ว เพราะเป็นการแสดงผลล้วน ไม่แตะสมุดบัญชี
 * ก่อนเปลี่ยนต้องกดยืนยันในกรอบที่บอกผลตรงๆ: "ใช้ได้วันนี้" เปลี่ยนทันที และรายงานเดือนก่อนๆ จะคำนวณใหม่ตามป้ายใหม่ (ฐานข้อมูลไม่เก็บป้ายตามเวลา)
 * บัญชีที่ผูกสินทรัพย์ บัญชี USD และกระเป๋าจ่ายของบิล (เมื่อจะเปลี่ยนเป็นเงินลงทุน) เปลี่ยนไม่ได้ · ฐานข้อมูลตรวจซ้ำ (set_account_kind)
 */
export function AccountKinds({ onChanged }: { onChanged: () => void }) {
  const repo = useRepository();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [investments, setInvestments] = useState<InvestmentData | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    try {
      const [ledger, inv, b] = await Promise.all([repo.loadLedger(), repo.loadInvestments(), repo.loadBills()]);
      setAccounts(ledger.accounts);
      setInvestments(inv);
      setBills(b);
      setLoadError('');
    } catch (e) {
      setLoadError(friendlyError(e, 'โหลดรายชื่อบัญชีไม่สำเร็จ ลองโหลดหน้าใหม่'));
    }
  }, [repo]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (pending) confirmRef.current?.focus();
  }, [pending]);

  if (loadError !== '') {
    return (
      <section className="solid card" aria-labelledby="ak-title">
        <h2 id="ak-title">กลุ่มบัญชีเงินสด</h2>
        <p role="alert" className="form-error">{loadError}</p>
      </section>
    );
  }
  if (accounts === null || investments === null) return null;

  const bound = new Set(investments.assets.map((a) => a.accountId));
  const candidates = accounts.filter((a) => a.type === 'asset' && a.currency === 'THB' && !a.archived && !bound.has(a.id));
  const spending = candidates.filter((a) => a.kind !== 'investment');
  const investing = candidates.filter((a) => a.kind === 'investment');
  // ไม่มีบัญชีเงินลงทุนและมีกระเป๋าเดียว = ไม่ต้องมีส่วนนี้ (เปลี่ยนป้ายกระเป๋าเดียวเป็นเงินลงทุนทำให้ไม่มีเงินใช้จ่ายเลย จึงไม่เสนอ)
  if (candidates.length === 0) return null;

  const ctx = { accounts, investments, bills };
  const ask = (a: Account, next: Kind, opener: HTMLElement) => {
    setMessage(null);
    const problem = checkAccountKindChange(ctx, a.id, next);
    if (problem) return setMessage({ text: problem, error: true });
    openerRef.current = opener;
    setPending({ id: a.id, name: a.name, next });
  };
  const cancel = () => {
    setPending(null);
    const el = openerRef.current;
    if (el && el.isConnected) window.setTimeout(() => el.focus(), 0);
  };
  const confirm = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await repo.setAccountKind(pending.id, pending.next);
      setMessage({ text: `ย้าย "${pending.name}" ไปกลุ่ม${pending.next === 'investment' ? 'เงินลงทุน' : 'เงินใช้จ่าย'}แล้ว`, error: false });
      setPending(null);
      await load();
      onChanged();
    } catch (e) {
      setMessage({ text: friendlyError(e, 'เปลี่ยนป้ายไม่สำเร็จ ลองอีกครั้ง'), error: true });
    } finally {
      setBusy(false);
    }
  };

  const group = (title: string, list: Account[], next: Kind, moveLabel: string, id: string) => (
    <div className="ak-group" role="group" aria-labelledby={id}>
      <h3 id={id} className="small">{title}</h3>
      {list.length === 0 ? (
        <p className="muted small">ไม่มีบัญชีในกลุ่มนี้</p>
      ) : (
        <ul className="wallet-name-list">
          {list.map((a) => (
            <li key={a.id} className="ak-row">
              <span className="wallet-name">{a.name}</span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={busy || (next === 'investment' && spending.length <= 1)}
                onClick={(e) => ask(a, next, e.currentTarget)}
                aria-label={`${moveLabel} ${a.name}`}
              >
                {moveLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <section className="solid card account-kinds" aria-labelledby="ak-title">
      <h2 id="ak-title">กลุ่มบัญชีเงินสด</h2>
      <p className="muted small">แยกเงินใช้จ่ายรายวันออกจากเงินลงทุน (เช่น เงินที่พักกับโบรกเกอร์) เป็นการจัดกลุ่มที่การแสดงผลและตัวเลขเท่านั้น สมุดบัญชียังเหมือนเดิม</p>
      <div role="status">{message && !message.error && <p className="auth-ok">{message.text}</p>}</div>
      <div role="alert">{message?.error && <p className="form-error">{message.text}</p>}</div>
      {group('เงินใช้จ่าย', spending, 'investment', 'ย้ายไปเงินลงทุน', 'ak-spending')}
      {group('เงินลงทุน', investing, 'normal', 'ย้ายไปเงินใช้จ่าย', 'ak-investing')}
      {pending && (
        <div className="notice" role="alertdialog" aria-labelledby="ak-confirm-title" aria-describedby="ak-confirm-body">
          <h3 id="ak-confirm-title" ref={confirmRef} tabIndex={-1}>
            ย้าย "{pending.name}" ไปกลุ่ม{pending.next === 'investment' ? 'เงินลงทุน' : 'เงินใช้จ่าย'}?
          </h3>
          <div id="ak-confirm-body">
            <p>
              {pending.next === 'investment'
                ? '"ใช้ได้วันนี้" จะไม่นับเงินในบัญชีนี้อีกต่อไป (ลดลงทันทีตามยอดคงเหลือของบัญชีนี้)'
                : '"ใช้ได้วันนี้" จะนับเงินในบัญชีนี้เข้าด้วย (เพิ่มขึ้นทันทีตามยอดคงเหลือของบัญชีนี้)'}
            </p>
            <p>รายงานของเดือนก่อนๆ จะคำนวณใหม่ตามป้ายใหม่ด้วย (ระบบไม่เก็บป้ายตามช่วงเวลา) ส่วนรายการและยอดในสมุดบัญชีไม่เปลี่ยน และเปลี่ยนกลับได้เสมอ</p>
          </div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={cancel} disabled={busy}>
              ยกเลิก
            </button>
            <button type="button" className="btn btn-primary btn-small" onClick={() => void confirm()} disabled={busy}>
              {busy ? 'กำลังเปลี่ยน…' : 'ยืนยันย้ายกลุ่ม'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
