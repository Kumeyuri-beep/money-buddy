import { useState } from 'react';
import { applyTheme, readStoredTheme, storeTheme, themeSettingPatch, type ThemeChoice } from '../app/theme';
import { friendlyError } from '../app/errorText';
import { useRepository } from './RepositoryContext';

const OPTIONS: { value: ThemeChoice; label: string; hint: string }[] = [
  { value: 'system', label: 'ตามเครื่อง', hint: 'สลับมืด/สว่างตามเครื่องของคุณ (ค่าเริ่มต้น)' },
  { value: 'dark', label: 'มืด', hint: 'พื้นหลังเข้ม' },
  { value: 'light', label: 'สว่าง', hint: 'พื้นหลังสว่าง' },
];

/** เลือกธีมสี (หน้าโปรไฟล์): ใช้ทันที จำในเครื่อง (ไม่กะพริบตอนเปิดครั้งหน้า) และเก็บในบัญชีให้ตามไปทุกเครื่อง */
export function ThemeSelector() {
  const repo = useRepository();
  const [choice, setChoice] = useState<ThemeChoice>(() => readStoredTheme());
  const [note, setNote] = useState('');

  const pick = async (next: ThemeChoice) => {
    setChoice(next);
    applyTheme(next);
    storeTheme(next);
    setNote('');
    try {
      await repo.updateSettings(['theme'], () => themeSettingPatch(next));
    } catch (e) {
      setNote(`ใช้สีนี้ในเครื่องนี้แล้ว แต่บันทึกลงบัญชีไม่สำเร็จ (${friendlyError(e, 'ลองเลือกอีกครั้ง')})`);
    }
  };

  return (
    <section className="solid card" aria-labelledby="theme-title">
      <h2 id="theme-title">สีหน้าจอ</h2>
      <fieldset className="theme-options">
        <legend className="muted small">เลือกสีที่ใช้กับทุกเครื่องของบัญชีนี้</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className="theme-option">
            <input type="radio" name="theme" value={o.value} checked={choice === o.value} onChange={() => void pick(o.value)} aria-describedby={`theme-hint-${o.value}`} />
            <span>
              {o.label}
              <span id={`theme-hint-${o.value}`} className="muted small theme-hint">
                {o.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div role="status" className="muted small">
        {note}
      </div>
    </section>
  );
}
