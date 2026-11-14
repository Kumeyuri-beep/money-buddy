import { useMemo, useState } from 'react';
import { thaiIsoDate, thaiDayLabel, thaiMonthKeyLabel } from '../app/dates';
import { counterOptions, walletOptions } from '../app/entryForm';
import { amountClass } from '../app/describe';
import { groupByDate, monthsWithEntries, queryLedger, type LedgerFilter } from '../app/ledgerQuery';
import { periodTotals } from '../domain/ledger/balance';
import type { Entry } from '../domain/ledger/types';
import { formatBaht, satang } from '../domain/money/satang';
import type { Ledger } from '../storage/repository';

interface LedgerViewProps {
  ledger: Ledger;
  onAdd: () => void;
  onEdit: (entry: Entry) => void;
  onDelete: (entry: Entry) => void;
  onCancelPayment: (entry: Entry) => void;
}

const KIND_LABEL = { all: 'ทุกประเภท', expense: 'รายจ่าย', income: 'รายรับ', transfer: 'ย้ายเงิน' } as const;

export function LedgerView({ ledger, onAdd, onEdit, onDelete, onCancelPayment }: LedgerViewProps) {
  const { accounts, entries } = ledger;
  const months = useMemo(() => monthsWithEntries(entries), [entries]);
  const thisMonth = thaiIsoDate().slice(0, 7);

  const [filter, setFilter] = useState<LedgerFilter>(() => ({
    month: months.includes(thisMonth) ? thisMonth : (months[0] ?? 'all'),
    kind: 'all',
    accountId: 'all',
    text: '',
  }));
  const set = (patch: Partial<LedgerFilter>) => setFilter((f) => ({ ...f, ...patch }));

  const rows = useMemo(() => queryLedger(accounts, entries, filter), [accounts, entries, filter]);
  const groups = useMemo(() => groupByDate(rows), [rows]);

  // ยอดรวมของรายการที่แสดงอยู่ คำนวณด้วย periodTotals ตัวเดียวกับหน้าวันนี้
  // ยอดเกินช่วงปลอดภัย (periodTotals โยน RangeError) ต้องไม่ทำให้ทั้งหน้าล้ม
  const totals = useMemo(() => {
    const shown = rows.map((r) => r.entry);
    try {
      return periodTotals(accounts, shown, { from: '0000-01-01', to: '9999-12-31' });
    } catch (e) {
      if (e instanceof RangeError) return null;
      throw e;
    }
  }, [accounts, rows]);

  // ถ้าลบรายการสุดท้ายของเดือนที่เลือกอยู่ เดือนนั้นจะหายจากรายการ จึงคงไว้เป็นตัวเลือกให้ตรงกับค่าที่เลือก
  const monthOptions = filter.month === 'all' || months.includes(filter.month) ? months : [filter.month, ...months];
  const wallets = walletOptions(accounts);
  const categories = [...counterOptions(accounts, 'expense', ''), ...counterOptions(accounts, 'income', '')];
  const filtered = filter.kind !== 'all' || filter.accountId !== 'all' || filter.text.trim() !== '';

  return (
    <>
      {/* ปุ่มเพิ่มรายการอยู่ที่หัวหน้าส่วนกลางแล้ว หัวข้อหน้านี้จึงเป็น h2 (h1 คือคำทักทายในหัวหน้า) */}
      <div className="page-header">
        <h2 className="page-title">รายรับ-รายจ่าย</h2>
        <p className="muted">{filter.month === 'all' ? 'ทุกเดือน' : thaiMonthKeyLabel(filter.month)}</p>
      </div>

      <section className="glass-lite card filters" aria-label="ตัวกรอง">
        <div className="field">
          <label htmlFor="f-text">ค้นหา</label>
          <input
            id="f-text"
            type="search"
            placeholder="เช่น กาแฟ หรือชื่อกระเป๋า"
            value={filter.text}
            onChange={(e) => set({ text: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="f-month">เดือน</label>
          <select id="f-month" value={filter.month} onChange={(e) => set({ month: e.target.value })}>
            {monthOptions.map((m) => (
              <option key={m} value={m}>
                {thaiMonthKeyLabel(m)}
              </option>
            ))}
            <option value="all">ทุกเดือน</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-kind">ประเภท</label>
          <select id="f-kind" value={filter.kind} onChange={(e) => set({ kind: e.target.value as LedgerFilter['kind'] })}>
            {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-account">กระเป๋าหรือหมวด</label>
          <select id="f-account" value={filter.accountId} onChange={(e) => set({ accountId: e.target.value })}>
            <option value="all">ทั้งหมด</option>
            <optgroup label="กระเป๋าเงิน">
              {wallets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="หมวด">
              {categories.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </section>

      <section className="solid card ledger-summary" aria-label="สรุปรายการที่แสดง">
        <span>
          <span className="muted">รายการ </span>
          <strong className="num">{rows.length}</strong>
        </span>
        <span role="status" className="ledger-summary-warn slip-warn">
          {totals === null ? '⚠ รวมยอดไม่ได้ เพราะมีรายการที่ยอดใหญ่ผิดปกติ ลองตรวจรายการที่ยอดสูงเกินจริง' : null}
        </span>
        {totals === null ? null : (
          <>
            <span>
              <span className="muted">รายรับ </span>
              <strong className="num income">+{formatBaht(satang(totals.income))}</strong>
            </span>
            <span>
              <span className="muted">รายจ่าย </span>
              <strong className="num expense">−{formatBaht(satang(totals.expense))}</strong>
            </span>
          </>
        )}
      </section>

      <section className="solid card ledger-list">
        {groups.length === 0 ? (
          <div className="empty">
            <p className="muted">{filtered ? 'ไม่พบรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีรายการในช่วงนี้'}</p>
            {filtered ? (
              <button className="btn btn-ghost" onClick={() => set({ kind: 'all', accountId: 'all', text: '' })}>
                ล้างตัวกรอง
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={onAdd}>
                บันทึกรายการ
              </button>
            )}
          </div>
        ) : (
          groups.map((group) => (
            <div className="day" key={group.date}>
              <h2 className="day-label">{thaiDayLabel(group.date)}</h2>
              {group.rows.map(({ entry, kind, amountText, detail, editable, cancelable }) => (
                <div className="tx ledger-tx" key={entry.id}>
                  <div className="tx-main">
                    <div>{entry.memo}</div>
                    <div className="muted small">{detail}</div>
                  </div>
                  <div className={amountClass(kind, amountText)}>{amountText}</div>
                  <div className="tx-actions">
                    {cancelable && (
                      <button
                        className="btn btn-ghost btn-small btn-danger"
                        aria-label={`ยกเลิกการจ่าย ${entry.memo}`}
                        onClick={() => onCancelPayment(entry)}
                      >
                        ยกเลิกการจ่าย
                      </button>
                    )}
                    {editable && (
                      <>
                        <button className="btn btn-ghost btn-small" aria-label={`แก้ไข ${entry.memo}`} onClick={() => onEdit(entry)}>
                          แก้ไข
                        </button>
                        <button className="btn btn-ghost btn-small" aria-label={`ลบ ${entry.memo}`} onClick={() => onDelete(entry)}>
                          ลบ
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </section>
    </>
  );
}
