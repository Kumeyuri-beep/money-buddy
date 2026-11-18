import { useEffect, useMemo, useState } from 'react';
import { friendlyError } from '../../app/errorText';
import { usd } from '../../app/usdFormat';
import { WEALTH_STALE_DAYS, wealthSummary } from '../../domain/invest/portfolioMoney';
import { emptyInvestments, type InvestmentData } from '../../domain/invest/types';
import { naturalBalance } from '../../domain/ledger/balance';
import type { Account, Entry } from '../../domain/ledger/types';
import { formatBaht, satang } from '../../domain/money/satang';
import { useRepository } from '../RepositoryContext';

/**
 * ความมั่งคั่งรวม (ราคาตลาด) + กลุ่ม "เงินลงทุน" (A3-2 · R23) · ตัวเลขแสดงผลล้วน ไม่ลงสมุด
 *   เงินใช้จ่าย = บัญชีบาทป้ายเงินใช้จ่าย (สินทรัพย์ − หนี้) · เงินลงทุน = เงินสดป้ายลงทุน + หุ้น/กองทุนตามราคาตลาดล่าสุดที่กรอก (USD แปลงที่อัตราล่าสุดที่กรอก)
 *   ไม่มีราคา/อัตรา = ไม่นับส่วนนั้นและติดป้าย "ไม่ครบ" (ไม่ใช้ต้นทุนแทน) · ราคา/อัตราเก่าเกิน 30 วัน = เตือน
 * แสดงเมื่อมีข้อมูลลงทุน (บัญชีป้ายเงินลงทุนหรือสินทรัพย์) เท่านั้น: ผู้ใช้ที่ยังไม่มีเงินลงทุนไม่เห็นการ์ดนี้ ภาพรวมเดิมไม่เปลี่ยน
 */
export function WealthPanel({ accounts, entries, today, investments }: { accounts: readonly Account[]; entries: readonly Entry[]; today: string; investments?: InvestmentData | null }) {
  const repo = useRepository();
  const [own, setData] = useState<InvestmentData | null>(null);
  const [error, setError] = useState('');
  const data = investments !== undefined ? investments : own;
  useEffect(() => {
    if (investments !== undefined) return; // ผู้เรียกส่งข้อมูลมาให้แล้ว ไม่ต้องโหลดซ้ำ
    let cancelled = false;
    repo
      .loadInvestments()
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(friendlyError(e)));
    return () => {
      cancelled = true;
    };
  }, [repo, investments]);

  const model = useMemo(() => {
    const inv = data ?? emptyInvestments();
    const bound = new Set(inv.assets.map((a) => a.accountId));
    const upTo = entries.filter((e) => e.date <= today);
    const cash = accounts
      .filter((a) => a.type === 'asset' && a.kind === 'investment' && !a.archived && !bound.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, currency: a.currency, balance: naturalBalance(a, upTo) }));
    try {
      return { cash, wealth: wealthSummary(accounts, entries, inv, today), tooLarge: false, any: cash.length > 0 || inv.assets.length > 0 };
    } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      return { cash, wealth: null, tooLarge: true, any: true }; // ยอดเกินช่วงปลอดภัย: ไม่ทำให้ทั้งหน้าล้ม ไม่แสดงข้อความดิบ
    }
  }, [accounts, entries, data, today]);

  if (error !== '' || data === null || !model.any) return null;
  const w = model.wealth;
  const baht = (n: number): string => formatBaht(satang(n));

  return (
    <section className="glass-lite card wealth" aria-labelledby="wealth-title">
      <h2 id="wealth-title">ความมั่งคั่งรวม (ราคาตลาด)</h2>
      {w === null ? (
        <p className="slip-warn" role="status">
          ⚠ คำนวณความมั่งคั่งรวมไม่ได้ เพราะมียอดเกินช่วงที่รองรับ
        </p>
      ) : (
        <>
          <div className="summary-value">{baht(w.totalThb)}</div>
          {w.incomplete && (
            <p className="slip-warn" role="status">
              ⚠ ไม่ครบ:{' '}
              {w.missing.some((m) => m.kind !== 'rate') && 'มีหุ้น/กองทุนที่ยังไม่มีราคา หรือมีเงินดอลลาร์แต่ยังไม่มีอัตราแลกเปลี่ยน จึงยังไม่นับส่วนนั้น (ระบบไม่ใช้ต้นทุนแทน)'}
              {w.missing.some((m) => m.kind !== 'rate') && w.missing.some((m) => m.kind === 'rate') && ' '}
              {w.missing.some((m) => m.kind === 'rate') && 'มีรายการหุ้นดอลลาร์ที่ยังไม่ได้ใส่อัตราแลกเปลี่ยน จึงยังไม่นับหุ้นนั้น ไปใส่ได้ที่พอร์ต > รายการ'}
            </p>
          )}
          {w.stale.length > 0 && (
            <p className="muted small" role="status">
              ราคาหรืออัตราแลกเปลี่ยนบางตัวเก่ากว่า {WEALTH_STALE_DAYS} วัน ตัวเลขนี้อาจคลาดเคลื่อน
            </p>
          )}
          <dl className="avg-result">
            <div>
              <dt>เงินใช้จ่าย</dt>
              <dd className="num">{baht(w.spendingThb)}</dd>
            </div>
            <div>
              <dt>เงินลงทุน</dt>
              <dd className="num">{baht(w.investmentThb)}</dd>
            </div>
          </dl>
        </>
      )}
      {model.cash.length > 0 && (
        <>
          <h3 className="small">บัญชีเงินสดในกลุ่มเงินลงทุน</h3>
          <ul className="wallet-list">
            {model.cash.map((c) => (
              <li className="wallet" key={c.id}>
                <div className="wallet-head">
                  <span className="wallet-name">{c.name}</span>
                  <span className={`num wallet-balance ${c.balance < 0 ? 'value-warn' : ''}`}>{c.currency === 'USD' ? usd(c.balance) : baht(c.balance)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small">เป็นตัวเลขแสดงผล ไม่ใช่ยอดในสมุดบัญชี · "ใช้ได้วันนี้" ไม่นับเงินลงทุน</p>
    </section>
  );
}
