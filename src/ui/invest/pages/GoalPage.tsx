import { useCallback, useEffect, useMemo, useState } from 'react';
import { usd } from '../../../app/usdFormat';
import { baht } from '../../../app/bahtFormat';
import type { InvestGoal } from '../../../domain/invest/goalProjection';
import { investError } from '../investError';
import { useInvest } from '../InvestContext';
import { useRepository } from '../../RepositoryContext';
import { buildDashboardView } from '../dashboard/dashboardView';
import { GoalForm } from '../goal/GoalForm';
import { GoalResults } from '../goal/GoalResults';
import { defaultAchieve, draftFromGoal, minorToInput, parseGoalDraft, type GoalDraft } from '../goal/goalDraft';
import { buildGoalContext, goalAmountsForDisplay, runGoal } from '../goal/goalModel';
import '../goal/goal.css';

/**
 * portfolio/goal · My goal (แบบร่าง 23 · R28 ประมาณการเป้าหมาย): ตั้งเป้ามูลค่าหรือรายได้ปันผลต่อเดือน แล้วดูว่าจะถึงเมื่อไร
 * เป็นประมาณการ ไม่ใช่คำสัญญา · ค่าที่ตั้งเก็บใน settings.investGoal (ต่อผู้ใช้ ไม่ใช่ยอดเงินจริง ไม่ลงสมุด) · ตัวเลขมาจาก domain/invest/goalProjection ทั้งหมด
 */
export function GoalPage(_props: { onHome: () => void }) {
  const repo = useRepository();
  const { today, accounts, entries, data, currency } = useInvest();
  const [saved, setSaved] = useState<InvestGoal | null>(null);
  const [settingsReady, setSettingsReady] = useState(false);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof GoalDraft, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  // เป้าที่เคยบันทึก: อ่านครั้งเดียว (อ่านไม่ได้ = ถือว่ายังไม่มีเป้า ไม่ขัดการใช้งาน)
  useEffect(() => {
    let alive = true;
    void repo
      .loadSettings()
      .then((s) => {
        if (alive) setSaved(s.investGoal ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setSettingsReady(true);
      });
    return () => {
      alive = false;
    };
  }, [repo]);

  // มุมมองพอร์ตสร้างใน try/catch: ข้อมูลพังเฉพาะหน้านี้ ไม่ทำให้ทั้งโหมดล้ม
  const built = useMemo(() => {
    if (data === null) return null;
    try {
      const view = buildDashboardView(accounts, entries, data, today);
      return { ctx: buildGoalContext(view, data, today, currency), failure: '' };
    } catch (e) {
      return { ctx: null, failure: investError(e) };
    }
  }, [accounts, entries, data, today, currency]);

  const ctx = built?.ctx ?? null;
  const rateMicro = ctx?.rateMicro ?? null;
  const suggested = ctx?.suggestedContributionMinor ?? null;
  const ready = settingsReady && built !== null;

  // ค่าเริ่มต้นของฟอร์ม: เป้าที่บันทึกไว้ (แปลงเป็นสกุลที่แสดง · R26) หรือค่าว่างพร้อมเงินเพิ่มที่เสนอจากรายการซื้อจริง · เริ่มใหม่เมื่อโหลดเสร็จ เป้าที่บันทึกเปลี่ยน หรือสกุลที่แสดงเปลี่ยน
  useEffect(() => {
    if (!ready) return;
    if (saved !== null) {
      const amounts = goalAmountsForDisplay(saved, currency, rateMicro);
      if (amounts.kind === 'ok') {
        setDraft(draftFromGoal(saved, amounts));
        setErrors({});
        return;
      }
    }
    const by = defaultAchieve(today);
    setDraft({ kind: saved?.kind ?? 'value', target: '', month: by.month, year: by.year, contribution: suggested === null ? '' : minorToInput(suggested), returnPct: '', inflationPct: '' });
    setErrors({});
    // เริ่มฟอร์มใหม่เฉพาะเมื่อพร้อม/เป้าที่บันทึกหรือสกุลเปลี่ยน (ไม่ใช่ทุกครั้งที่พิมพ์หรือราคาเปลี่ยน)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, saved, currency]);

  const outcome = useMemo(() => (saved !== null && ctx !== null ? runGoal(saved, ctx, currency, today) : null), [saved, ctx, currency, today]);

  const save = useCallback(async () => {
    if (draft === null) return;
    const parsed = parseGoalDraft(draft, currency, today);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError('');
    try {
      await repo.updateSettings(['investGoal'], () => ({ investGoal: parsed.goal }));
      setSaved(parsed.goal);
    } catch (e) {
      setSaveError(`Could not save your goal: ${investError(e)}`);
    } finally {
      setSaving(false);
    }
  }, [draft, currency, today, repo]);

  const hint = suggested === null ? null : `Suggested from your purchases in the last 12 months: ${currency === 'THB' ? baht(suggested) : usd(suggested)} per month`;

  return (
    <div className="invest-tab iv-goal-page" lang="en">
      <h2 className="iv-goal-title">My goal</h2>
      {built !== null && built.ctx === null ? (
        <p className="form-error" role="alert">
          Could not show your goal: {built.failure}
        </p>
      ) : !ready || draft === null ? (
        <p className="iv-empty">Loading…</p>
      ) : (
        <div className="iv-goal-layout">
          <GoalForm draft={draft} errors={errors} currency={currency} saving={saving} saveError={saveError} contributionHint={hint} onChange={(p) => setDraft({ ...draft, ...p })} onSubmit={() => void save()} />
          <GoalResults outcome={outcome} kind={saved?.kind ?? draft.kind} currency={currency} today={today} achieveBy={saved?.achieveBy ?? ''} hasGoal={saved !== null} />
        </div>
      )}
    </div>
  );
}
