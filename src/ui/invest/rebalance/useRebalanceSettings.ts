import { useCallback, useState } from 'react';
import { DEFAULT_REBALANCE_SETTINGS, parseStoredSettings, type RebalanceSettings } from '../../../domain/invest/rebalanceView';

const KEY = 'mb-rebalance-settings-v1';

function read(): RebalanceSettings {
  try {
    return parseStoredSettings(window.localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULT_REBALANCE_SETTINGS }; // อ่านไม่ได้ (โหมดส่วนตัว/ปิดการเก็บ) = ค่าเริ่มต้น
  }
}

/**
 * ค่าตั้ง Set up ของหน้า Rebalancing: จำไว้ในเบราว์เซอร์นี้เท่านั้น (ความสะดวกต่อผู้ดู ไม่ใช่ข้อมูลสำคัญ ไม่เขียนฐานข้อมูล)
 * เขียนไม่ได้ = ใช้ต่อในหน้านี้ตามปกติ
 */
export function useRebalanceSettings(): [RebalanceSettings, (patch: Partial<RebalanceSettings>) => void] {
  const [settings, setSettings] = useState<RebalanceSettings>(read);
  const update = useCallback((patch: Partial<RebalanceSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // เก็บไม่ได้ = ไม่เป็นไร
      }
      return next;
    });
  }, []);
  return [settings, update];
}
