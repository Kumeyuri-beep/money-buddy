/**
 * แผนการเขียนค่าตั้งค่าแบบ "เปลี่ยนเฉพาะคีย์ที่ส่งมา" (ใช้คู่กับ RPC merge_settings และที่เก็บในเครื่อง)
 * แก้ช่องแข่งเขียน: เดิมหน้าเว็บอ่านทั้งก้อนแล้วเขียนทั้งก้อน เปิดสองแท็บแล้วบันทึกเหลื่อมกันอาจเขียนทับค่าอื่น
 * ฟังก์ชันล้วน ไม่แตะฐานข้อมูล · ตรวจและทำความสะอาดค่าด้วย settingsProblem/sanitizeSettings เดิม (ไม่เชื่อค่าที่ส่งมา)
 */

import { sanitizeSettings, settingsProblem, type FinanceSettings } from './settings';

/** คีย์ทั้งหมดของ FinanceSettings (ลำดับคงที่) */
export const SETTINGS_KEYS = ['payDay', 'monthlySavingsGoal', 'monthlyBudget', 'nextPaydayOverride', 'dcaPlans', 'retirementAssetIds'] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/** คีย์ที่ผู้เรียกบางรายไม่รู้จัก (หน้าบิลสร้างค่าตั้งค่าใหม่ทั้งก้อน): ไม่ส่ง = คงของเดิม ส่งอาร์เรย์ว่าง = ลบ */
const CARRIED_KEYS: readonly SettingsKey[] = ['dcaPlans', 'retirementAssetIds'];

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
