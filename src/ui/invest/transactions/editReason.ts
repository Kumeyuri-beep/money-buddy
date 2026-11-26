import { formatDateEn } from '../../../app/dateEn';
import type { TransactionEditPlan } from '../../../domain/invest/editImpact';
import { investProblem } from '../investError';

export const DESKTOP_ONLY_TEXT = 'Available on desktop';

/** เหตุผลที่ปุ่ม Edit ปิด (ข้อความอังกฤษ) · แผนแก้ได้ = null · คอมเท่านั้น: มือถือส่ง desktop=false จะได้ "Available on desktop" */
export function editDisabledReason(plan: TransactionEditPlan, desktop: boolean): string | null {
  if (!desktop) return DESKTOP_ONLY_TEXT;
  if (plan.ok) return null;
  if (plan.why !== 'rule') {
    return plan.why === 'notTrade'
      ? 'Exchanges, cash deposits and transfers cannot be edited yet. Delete it and add it again.'
      : 'Reinvested dividends of US stocks cannot be edited here. Delete it and add it again.';
  }
  const p = plan.problem;
  if (p.code === 'rules.deleteBeforeLastSell' && typeof p.params?.date === 'string') {
    return `Cannot edit: it is dated on or before the latest sale (${formatDateEn(p.params.date)}). Delete the later sale first.`;
  }
  if (p.code === 'rules.deleteOnlyLastSell') return 'Cannot edit: only the latest sale can be edited. Delete the later sale first.';
  return `Cannot edit: ${investProblem(p)}`;
}
