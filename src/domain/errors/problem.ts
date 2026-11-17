import { hasCode, type ErrorParams } from './coded';

/**
 * ปัญหาที่ฟังก์ชันตรวจ (…Problem) คืนให้หน้าจอ: message ไทยเดิมเสมอ + code/params เมื่อมีรหัส (เจ้าของอนุมัติ 17 พ.ย. 2569)
 * ใช้คู่กับฟังก์ชันเดิมที่ยังคืน string ไทย (สัญญาเดิมไม่เปลี่ยน)
 */
export interface CodedProblem {
  message: string;
  code?: string;
  params?: ErrorParams;
}

/** ปัญหาจาก error ที่ถูกโยน: พก code/params ต่อถ้า error นั้นมีรหัส ไม่มี = มีแต่ message */
export function problemOfError(e: unknown, fallback: CodedProblem): CodedProblem {
  if (hasCode(e)) return { message: e.message, code: e.code, params: e.params };
  if (e instanceof Error) return { message: e.message };
  return fallback;
}
