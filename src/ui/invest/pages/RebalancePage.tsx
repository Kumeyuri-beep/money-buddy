import { useMemo, useState } from 'react';
import { rebalance, type RebalanceMode } from '../../../domain/invest/rebalance';
import {
  BUILD_FAILURE_TEXT,
  buildRebalanceCsv,
  buildRebalanceInput,
  buildRebalanceView,
  parseUsdCents,
  REBALANCE_REASON_TEXT,
  rebalanceCsvFilename,
  type AmountProblem,
  type RebalanceOptions,
} from '../../../domain/invest/rebalanceView';
import { downloadCsv } from '../downloadCsv';
import { useInvest } from '../InvestContext';
import { RebalanceForm } from '../rebalance/RebalanceForm';
import { RebalanceResult } from '../rebalance/RebalanceResult';
import { useRebalanceSettings } from '../rebalance/useRebalanceSettings';
import '../rebalance/rebalance.css';

/**
 * Tools → Rebalancing (แบบร่าง 30 · R29): ผลลัพธ์ "Result" ที่คำนวณจากเป้าที่ผู้ใช้ตั้งเองในหน้า Categories
 * ใช้ rebalance() (ฟังก์ชันล้วน BigInt) ผ่านตัวแปลงใน domain/invest/rebalanceView · ไม่มีสูตรเงินในหน้านี้ · ไม่สร้างรายการซื้อขาย ไม่เขียนสมุด/ฐานข้อมูล
 * คำนวณเป็น USD เสมอ (R26) แม้เลือกมุมมอง THB
 */
export function RebalancePage({ onOpenCategories }: { onOpenCategories: () => void }) {
  const { today, data, currency } = useInvest();
  const [settings, setSettings] = useRebalanceSettings();
  const [mode, setMode] = useState<RebalanceMode>('deposit');
  const [amount, setAmount] = useState('');
  const [problems, setProblems] = useState<{ amount: AmountProblem | null; min: AmountProblem | null }>({ amount: null, min: null });
  const [submitted, setSubmitted] = useState<RebalanceOptions | null>(null);

  const categories = data?.categories ?? [];
  const hasTargets = categories.length > 0 && categories.some((c) => c.targetBps !== null);

  const outcome = useMemo(() => {
    if (submitted === null || data === null) return null;
    try {
      const built = buildRebalanceInput(data, today, submitted);
      if (!built.ok) return { text: BUILD_FAILURE_TEXT[built.reason], view: null };
      const result = rebalance(built.input);
      if (!result.ok) return { text: REBALANCE_REASON_TEXT[result.reason], view: null };
      const nameOf = new Map((data.categories ?? []).map((c) => [c.id, c.name]));
      return {
        text: null,
        view: buildRebalanceView(result, { assets: data.assets, categoryName: (id) => nameOf.get(id) ?? id, fractional: submitted.fractional }),
      };
    } catch {
      return { text: 'The numbers are too large to calculate safely, so nothing was calculated.', view: null };
    }
  }, [submitted, data, today]);

  const parsed = useMemo(() => ({ amount: parseUsdCents(amount), min: parseUsdCents(settings.minOrder) }), [amount, settings.minOrder]);

  const stale =
    submitted !== null &&
    (!parsed.amount.ok ||
      !parsed.min.ok ||
      submitted.mode !== mode ||
      submitted.amountCents !== parsed.amount.cents ||
      submitted.allowSales !== settings.allowSales ||
      submitted.fractional !== settings.fractional ||
      submitted.minOrderCents !== parsed.min.cents);

  const submit = () => {
    const { amount: a, min: m } = parsed;
    setProblems({ amount: a.ok ? null : a.problem, min: m.ok ? null : m.problem });
    if (a.ok && m.ok) setSubmitted({ mode, amountCents: a.cents, allowSales: settings.allowSales, fractional: settings.fractional, minOrderCents: m.cents });
  };

  const exportCsv = () => {
    if (outcome === null || outcome.view === null || submitted === null) return;
    downloadCsv(buildRebalanceCsv(outcome.view, submitted), rebalanceCsvFilename(today));
  };

  return (
    <div className="invest-tab rb-page" lang="en">
      <h2 className="rb-title">Portfolio rebalancing</h2>
      <p className="rb-lead">
        Compare your portfolio with the target mix you set in{' '}
        <button type="button" className="rb-link" onClick={onOpenCategories}>
          Categories
        </button>
        . Choose a deposit (buy) or a withdrawal (sell). To rebalance without adding money, leave the amount empty and turn on &quot;Allow sales&quot; in Set up.
      </p>
      {currency === 'THB' && <p className="rb-note">Amounts on this page are always calculated in USD, for your US stocks. The baht view does not change this page.</p>}
      {data !== null && !hasTargets ? (
        <section className="iv-card rb-empty" aria-labelledby="rb-empty-title">
          <h3 id="rb-empty-title">Set up categories and target allocations first</h3>
          <p>
            This page works from the target % you give each category. Go to{' '}
            <button type="button" className="rb-link" onClick={onOpenCategories}>
              Categories
            </button>{' '}
            to set them.
          </p>
        </section>
      ) : (
        <>
          <RebalanceForm
            mode={mode}
            amount={amount}
            settings={settings}
            amountProblem={problems.amount}
            minOrderProblem={problems.min}
            onMode={setMode}
            onAmount={setAmount}
            onSettings={setSettings}
            onSubmit={submit}
          />
          {outcome !== null && <RebalanceResult notCalculated={outcome.text} view={outcome.view} allowSales={submitted?.allowSales ?? false} stale={stale} onExport={exportCsv} />}
        </>
      )}
    </div>
  );
}
