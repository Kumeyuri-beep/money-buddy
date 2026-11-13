/**
 * การ์ด "เริ่มต้น 3 ขั้น" สำหรับผู้ใช้ใหม่ (เจ้าของตัดสิน 13 พ.ย. 2569): ติ๊กเองจากข้อมูลที่มีอยู่ ไม่เก็บข้อมูลใหม่ และหายเองเมื่อทำครบ
 * ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล · ไม่แตะเงิน
 */
import type { FinanceInput } from './billsOverview';
import type { Entry } from '../domain/ledger/types';

export type StartStepId = 'first-entry' | 'pay-day' | 'first-bill';

export interface StartStep {
  id: StartStepId;
  title: string;
  hint: string;
  done: boolean;
}

export interface StartGuide {
  steps: StartStep[];
  doneCount: number;
  /** ทำครบทั้ง 3 ขั้น = ไม่ต้องแสดงการ์ด */
  complete: boolean;
}

export function startGuide(entries: readonly Entry[], finance: FinanceInput): StartGuide {
  const steps: StartStep[] = [
    {
      id: 'first-entry',
      title: 'บันทึกรายการแรก',
      hint: 'จดรายจ่ายหรือรายรับสักรายการ ยอดยกมาตอนตั้งต้นไม่นับ',
      done: entries.some((e) => e.source !== 'system'),
    },
    {
      id: 'pay-day',
      title: 'ตั้งวันเงินเดือน',
      hint: 'ให้แอปคำนวณว่าเหลือใช้ได้วันละเท่าไรจนถึงวันเงินเดือนถัดไป',
      done: finance.settings.payDay !== undefined,
    },
    {
      id: 'first-bill',
      title: 'เพิ่มบิลประจำ',
      hint: 'เช่น ค่าเน็ต ค่าน้ำไฟ ให้แอปเตือนเมื่อใกล้ครบกำหนด',
      done: finance.bills.length > 0,
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return { steps, doneCount, complete: doneCount === steps.length };
}
