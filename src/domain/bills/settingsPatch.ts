/**
 * แผนการเขียนค่าตั้งค่าแบบ "เปลี่ยนเฉพาะคีย์ที่ส่งมา" (ใช้คู่กับ RPC merge_settings และที่เก็บในเครื่อง)
 * แก้ช่องแข่งเขียน: เดิมหน้าเว็บอ่านทั้งก้อนแล้วเขียนทั้งก้อน เปิดสองแท็บแล้วบันทึกเหลื่อมกันอาจเขียนทับค่าอื่น
 * ฟังก์ชันล้วน ไม่แตะฐานข้อมูล · ตรวจและทำความสะอาดค่าด้วย settingsProblem/sanitizeSettings เดิม (ไม่เชื่อค่าที่ส่งมา)
 */

import { taxTagsProblem } from '../invest/taxTags';
import { sanitizeSettings, settingsProblem, type FinanceSettings } from './settings';

/** คีย์ทั้งหมดของ FinanceSettings (ลำดับคงที่) */
export const SETTINGS_KEYS = ['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride', 'dcaPlans', 'retirementAssetIds', 'taxRmfAssetIds', 'taxThaiEsgAssetIds', 'lastBackupAt', 'backupSnoozeUntil'] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/** คีย์ที่ผู้เรียกบางรายไม่รู้จัก (หน้าบิลสร้างค่าตั้งค่าใหม่ทั้งก้อน): ไม่ส่ง = คงของเดิม ส่งอาร์เรย์ว่าง = ลบ */
const CARRIED_KEYS: readonly SettingsKey[] = ['dcaPlans', 'retirementAssetIds', 'taxRmfAssetIds', 'taxThaiEsgAssetIds', 'lastBackupAt', 'backupSnoozeUntil'];

/** ค่าที่จะเปลี่ยน: ค่า = ตั้ง/แทน · null หรืออาร์เรย์ว่าง = ลบคีย์ · undefined = ไม่แตะ */
export type SettingsPatch = { [K in SettingsKey]?: FinanceSettings[K] | null };

export interface SettingsPlan {
  /** คีย์ที่จะตั้ง (ผ่านการตรวจและทำความสะอาดแล้ว) */
  set: FinanceSettings;
  /** คีย์ที่จะลบ */
  remove: SettingsKey[];
}

export type SettingsPlanResult = { ok: true; plan: SettingsPlan } | { ok: false; problem: string };

function plan(entries: [SettingsKey, unknown][], removeExtra: SettingsKey[]): SettingsPlanResult {
  const candidate: Record<string, unknown> = {};
  const remove = new Set<SettingsKey>(removeExtra);
  for (const [key, value] of entries) {
    if (value === null) {
      remove.add(key);
    } else if (Array.isArray(value) && value.length === 0) {
      remove.add(key); // อาร์เรย์ว่าง = ลบ (ตรงกับ sanitizeSettings ที่ไม่เก็บอาร์เรย์ว่าง)
    } else {
      candidate[key] = value;
    }
  }
  const problem = settingsProblem(candidate as FinanceSettings);
  if (problem) return { ok: false, problem };
  const set = sanitizeSettings(candidate);
  // คีย์ที่ส่งมาแต่ถูกตัดทิ้งตอนทำความสะอาด = ค่าผิดรูป ห้ามลบค่าเดิมเงียบๆ
  for (const key of Object.keys(candidate)) {
    if (!(key in set)) return { ok: false, problem: `ค่า ${key} ไม่ถูกต้อง` };
  }
  return { ok: true, plan: { set, remove: [...remove] } };
}

/** แผนของ patchSettings(patch): เปลี่ยนเฉพาะคีย์ที่ส่ง */
export function planSettingsPatch(patch: SettingsPatch): SettingsPlanResult {
  const entries: [SettingsKey, unknown][] = [];
  for (const key of SETTINGS_KEYS) {
    if (patch[key] !== undefined) entries.push([key, patch[key]]);
  }
  return plan(entries, []);
}

/**
 * แผนของ saveSettings(settings): แทนทั้งชุดแบบเดิม (ฟิลด์ที่ไม่ส่ง = ไม่ตั้ง) ยกเว้น CARRIED_KEYS ที่ไม่ส่ง = คงของเดิม
 * ต่างจากเดิมตรงที่ทำฝั่งฐานข้อมูลในคำสั่งเดียว ไม่ต้องอ่านก่อนเขียน
 */
export function planSettingsReplace(settings: FinanceSettings): SettingsPlanResult {
  const entries: [SettingsKey, unknown][] = [];
  const removeExtra: SettingsKey[] = [];
  for (const key of SETTINGS_KEYS) {
    const value = settings[key];
    if (value !== undefined) entries.push([key, value]);
    else if (!CARRIED_KEYS.includes(key)) removeExtra.push(key);
  }
  return plan(entries, removeExtra);
}

/** ผลที่คาดว่าจะได้หลังรวม (ใช้ตรวจขนาดรวมก่อนเขียน และเป็นตัวรวมของที่เก็บในเครื่อง) */
export function applySettingsPlan(current: FinanceSettings, p: SettingsPlan): FinanceSettings {
  const next: Record<string, unknown> = { ...current };
  for (const key of p.remove) delete next[key];
  Object.assign(next, p.set);
  return sanitizeSettings(next);
}

/**
 * ความขัดแย้งระหว่างค่าที่จะเขียนกับค่าที่มีอยู่ (ตรวจก่อนเขียน): ป้ายภาษีของสินทรัพย์หนึ่งต้องเป็นประเภทเดียว
 * (patch ส่งมาแค่คีย์เดียวอาจไปซ้อนกับอีกคีย์ที่เก็บไว้ ถ้าไม่ตรวจ sanitize จะตัดทิ้งเงียบๆ) · null = ไม่ขัดแย้ง
 */
export function planConflictProblem(current: FinanceSettings, p: SettingsPlan): string | null {
  const merged: Record<string, unknown> = { ...current };
  for (const key of p.remove) delete merged[key];
  Object.assign(merged, p.set);
  return taxTagsProblem(merged.taxRmfAssetIds ?? [], merged.taxThaiEsgAssetIds ?? []);
}

/** จำนวนครั้งสูงสุดที่ updateSettings อ่านค่าล่าสุดแล้วลองเขียนใหม่เมื่อชนกับแท็บอื่น */
export const SETTINGS_UPDATE_MAX_ATTEMPTS = 5;

/** ค่าของคีย์ที่ระบุต่างกันหรือไม่ (เทียบแบบ JSON · ไม่มี = ไม่มีเหมือนกัน) ใช้ตรวจว่าค่าที่ฟอร์มแสดงอยู่ยังเหมือนค่าล่าสุดไหม */
export function settingsKeysChanged(keys: readonly SettingsKey[], a: FinanceSettings, b: FinanceSettings): boolean {
  return keys.some((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null));
}

/** แผนแตะคีย์นอกที่ประกาศไว้หรือไม่ (ความผิดพลาดของผู้เขียนโค้ด: การเขียนแบบ compare-and-set ป้องกันเฉพาะคีย์ที่ประกาศ) · null = ไม่เกินขอบเขต */
export function planOutsideKeysProblem(p: SettingsPlan, keys: readonly SettingsKey[]): string | null {
  const touched = [...(Object.keys(p.set) as SettingsKey[]), ...p.remove];
  const outside = touched.filter((k) => !keys.includes(k));
  return outside.length > 0 ? `updateSettings แตะคีย์นอกที่ประกาศไว้: ${outside.join(', ')}` : null;
}

/** คีย์ที่ฟอร์ม "ตั้งค่ารายเดือน" ของหน้าบิลเป็นเจ้าของ (ฟอร์มไม่รู้จักแผน DCA/รายชื่อเกษียณ/ป้ายภาษี จึงไม่แตะคีย์เหล่านั้น) */
export const FORM_SETTINGS_KEYS = ['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride'] as const satisfies readonly SettingsKey[];

/** ค่าที่ฟอร์มส่ง → patch ของคีย์ฟอร์ม: ไม่ได้ตั้ง (ว่าง) = ลบคีย์ (null) */
export function formSettingsPatch(settings: FinanceSettings): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const k of FORM_SETTINGS_KEYS) (patch as Record<string, unknown>)[k] = settings[k] ?? null;
  return patch;
}
