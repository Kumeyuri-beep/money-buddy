/**
 * รหัส error + พารามิเตอร์ (เจ้าของอนุมัติ 17 พ.ย. 2569) · ฟังก์ชันล้วน ไม่แตะ DOM/ฐานข้อมูล
 * ปัญหา: ข้อความ error ใน domain/app/storage เป็นไทยฝังในประโยค หน้า /invest ต้องแสดงอังกฤษ ส่วนหน้าอื่นยังเป็นไทยเหมือนเดิมทุกตัวอักษร
 * วิธี: แต่ละรหัสมีแม่แบบ th และ en รับ params ชุดเดียวกัน · error ที่โยนยังเป็นชนิดเดิม (RangeError, StorageError ฯลฯ) และ message ยังเป็นไทยเหมือนเดิม
 *       เพิ่มเฉพาะ code และ params บน error นั้น · ห้ามเปลี่ยนเงื่อนไขหรือลำดับการตรวจ เปลี่ยนแค่วิธีสร้างข้อความ
 * ห้ามใช้กับ error ที่ผู้ใช้ไม่เห็น (ไม่ต้องมีรหัสทุกข้อความ)
 */

export type ErrorParams = Readonly<Record<string, string | number>>;
export type Lang = 'th' | 'en';

export interface MessageTemplate {
  th: (p: ErrorParams) => string;
  en: (p: ErrorParams) => string;
}

const REGISTRY = new Map<string, MessageTemplate>();

/**
 * ลงทะเบียนแม่แบบของกลุ่มหนึ่ง (เรียกที่ระดับโมดูล) รหัสซ้ำกับกลุ่มอื่น = โยน (กันชนกัน)
 * คืนฟังก์ชันสร้างข้อความ: msg(code, params, lang = 'th')
 */
export function defineMessages<K extends string>(spec: Readonly<Record<K, MessageTemplate>>): (code: K, params?: ErrorParams, lang?: Lang) => string {
  for (const code of Object.keys(spec) as K[]) {
    if (REGISTRY.has(code)) throw new Error(`error code ซ้ำ: ${code}`);
    REGISTRY.set(code, spec[code]);
  }
  return (code, params = {}, lang = 'th') => spec[code][lang](params);
}

/** error ที่มีรหัส (ชนิดเดิมของ error ยังอยู่ แค่เพิ่มสองช่อง) */
export interface CodedFields {
  code: string;
  params: ErrorParams;
}

export function hasCode(e: unknown): e is Error & CodedFields {
  return e instanceof Error && typeof (e as Partial<CodedFields>).code === 'string' && (e as Partial<CodedFields>).code !== '';
}

/** แปะรหัสและพารามิเตอร์บน error ที่สร้างแล้ว (message ไทยเดิมไม่เปลี่ยน) */
export function withCode<E extends Error>(error: E, code: string, params: ErrorParams = {}): E & CodedFields {
  return Object.assign(error, { code, params });
}

/** ข้อความของรหัสในภาษาที่ขอ · รหัสที่ไม่รู้จัก = null (ผู้เรียกตัดสินใจเอง ไม่เดา) */
export function messageFor(code: string, params: ErrorParams, lang: Lang): string | null {
  const t = REGISTRY.get(code);
  return t ? t[lang](params) : null;
}

/** ข้อความของ error ในภาษาที่ขอ ถ้ามีรหัสที่ลงทะเบียนไว้ · ไม่มี = null */
export function codedMessage(e: unknown, lang: Lang): string | null {
  return hasCode(e) ? messageFor(e.code, e.params, lang) : null;
}

/** ใช้ทดสอบ: รหัสที่ลงทะเบียนทั้งหมด */
export function registeredCodes(): string[] {
  return [...REGISTRY.keys()].sort();
}
