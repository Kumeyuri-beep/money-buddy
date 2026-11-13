import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { backupReminder, markBackupDone, snoozeUntilFor, BACKUP_STALE_DAYS, BACKUP_SNOOZE_DAYS } from '../../src/app/backupReminder';
import { BackupReminder } from '../../src/ui/overview/BackupReminder';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { SETTINGS_KEYS, planSettingsReplace, applySettingsPlan, planSettingsPatch } from '../../src/domain/bills/settingsPatch';
import type { Entry } from '../../src/domain/ledger/types';

const entry = (id: string, source: Entry['source']): Entry => ({ id, date: '2026-11-01', memo: '', source, lines: [] });
const manual = [entry('e1', 'manual')];
const today = '2026-11-20';

describe('settings: lastBackupAt / backupSnoozeUntil', () => {
  it('เป็นคีย์ที่รู้จัก และรับเฉพาะวันที่ที่มีจริง', () => {
    expect(SETTINGS_KEYS).toContain('lastBackupAt');
    expect(SETTINGS_KEYS).toContain('backupSnoozeUntil');
    expect(settingsProblem({ lastBackupAt: '2026-11-13' })).toBeNull();
    expect(settingsProblem({ lastBackupAt: '2026-02-30' })).not.toBeNull();
    expect(settingsProblem({ backupSnoozeUntil: 'พรุ่งนี้' })).not.toBeNull();
    expect(sanitizeSettings({ lastBackupAt: '2026-11-13', backupSnoozeUntil: 'x' })).toEqual({ lastBackupAt: '2026-11-13' });
  });
  it('ฟอร์มตั้งค่าหน้าบิล (replace) ไม่ลบสองคีย์นี้ทิ้ง', () => {
    const plan = planSettingsReplace({ payDay: 5 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.remove).not.toContain('lastBackupAt');
    expect(plan.plan.remove).not.toContain('backupSnoozeUntil');
    expect(applySettingsPlan({ lastBackupAt: '2026-11-13', payDay: 1 }, plan.plan)).toEqual({ lastBackupAt: '2026-11-13', payDay: 5 });
  });
  it('null = ลบคีย์ (ล้างการปิดชั่วคราว)', () => {
    const plan = planSettingsPatch({ backupSnoozeUntil: null });
    expect(plan.ok && plan.plan.remove).toContain('backupSnoozeUntil');
  });
});

describe('backupReminder', () => {
  it('ค่าคงที่ตามที่เจ้าของสั่ง: เกิน 7 วัน · ปิดชั่วคราว 3 วัน', () => {
    expect(BACKUP_STALE_DAYS).toBe(7);
    expect(BACKUP_SNOOZE_DAYS).toBe(3);
  });
  it('ไม่เคยดาวน์โหลด + ยังไม่มีรายการ (มีแต่ยอดยกมา) = ไม่เตือน', () => {
    expect(backupReminder({ entries: [], settings: {}, today }).show).toBe(false);
    expect(backupReminder({ entries: [entry('o', 'system')], settings: {}, today }).show).toBe(false);
  });
  it('ไม่เคยดาวน์โหลด + มีรายการแล้ว = เตือน (never)', () => {
    expect(backupReminder({ entries: manual, settings: {}, today })).toEqual({ show: true, reason: 'never' });
  });
  it('ดาวน์โหลดล่าสุดไม่เกิน 7 วัน = ไม่เตือน · 8 วันขึ้นไป = เตือน (stale + จำนวนวัน)', () => {
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2026-11-13' }, today }).show).toBe(false);
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2026-11-20' }, today }).show).toBe(false);
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2026-11-12' }, today })).toEqual({ show: true, reason: 'stale', daysSince: 8 });
  });
  it('ข้ามเดือน/ปีอธิกสุรทินนับวันถูก', () => {
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2028-02-20' }, today: '2028-03-01' })).toEqual({ show: true, reason: 'stale', daysSince: 10 });
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2027-02-20' }, today: '2027-03-01' })).toEqual({ show: true, reason: 'stale', daysSince: 9 });
  });
  it('วันที่ดาวน์โหลดในอนาคต (นาฬิกาเครื่องเพี้ยน) ไม่เตือนและไม่พัง', () => {
    expect(backupReminder({ entries: manual, settings: { lastBackupAt: '2026-12-31' }, today }).show).toBe(false);
  });
  it('ปิดชั่วคราว: ก่อนถึงวันที่ตั้ง = ซ่อน · ถึงวันนั้นแล้ว = กลับมาเตือน', () => {
    const s = { backupSnoozeUntil: '2026-11-23' };
    expect(backupReminder({ entries: manual, settings: s, today: '2026-11-22' }).show).toBe(false);
    expect(backupReminder({ entries: manual, settings: s, today: '2026-11-23' }).show).toBe(true);
  });
  it('snoozeUntilFor = วันนี้ + 3 วัน (ข้ามสิ้นเดือน)', () => {
    expect(snoozeUntilFor('2026-11-20')).toBe('2026-11-23');
    expect(snoozeUntilFor('2026-11-29')).toBe('2026-12-02');
  });
});

describe('markBackupDone', () => {
  it('เขียนเฉพาะสองคีย์ผ่าน updateSettings: ตั้ง lastBackupAt = วันนี้ และล้างการปิดชั่วคราว', async () => {
    const calls: { keys: readonly string[]; patch: unknown }[] = [];
    const repo = {
      updateSettings: async (keys: readonly string[], compute: (c: Record<string, unknown>) => unknown) => {
        calls.push({ keys, patch: compute({ backupSnoozeUntil: '2026-11-25', payDay: 5 }) });
        return {};
      },
    };
    await markBackupDone(repo as never, today);
    expect(calls).toHaveLength(1);
    expect([...calls[0]!.keys].sort()).toEqual(['backupSnoozeUntil', 'lastBackupAt']);
    expect(calls[0]!.patch).toEqual({ lastBackupAt: today, backupSnoozeUntil: null });
  });
});

describe('BackupReminder (แถบเตือน)', () => {
  const noop = () => undefined;
  const html = (settings = {}, entries = manual) =>
    renderToString(createElement(BackupReminder, { entries, settings, today, onDownload: noop, onSnooze: noop })).replace(/<!-- -->/g, '');
  it('ไม่ถึงเกณฑ์ = ไม่แสดงอะไร', () => {
    expect(html({ lastBackupAt: today })).toBe('');
  });
  it('ไม่เคยดาวน์โหลด: บอกตรงๆ ว่าไม่มีสำรองบนเซิร์ฟเวอร์ · มีปุ่มดาวน์โหลดและปุ่มปิด 3 วัน', () => {
    const h = html();
    expect(h).toContain('ยังไม่เคยดาวน์โหลดข้อมูลสำรอง');
    expect(h).toContain('ไม่มีสำรองบนเซิร์ฟเวอร์');
    expect(h).toContain('ดาวน์โหลดข้อมูลของฉัน');
    expect(h).toContain('ปิดไว้ 3 วัน');
  });
  it('เก่าเกินไป: บอกจำนวนวันที่ผ่านมา', () => {
    expect(html({ lastBackupAt: '2026-11-10' })).toContain('ดาวน์โหลดสำรองครั้งล่าสุดเมื่อ 10 วันที่แล้ว');
  });
  it('เป็นพื้นทึบ (ไม่ใช่กระจก) และอ่านออกเสียงได้ (มีชื่อหัวข้อผูกกับส่วน)', () => {
    const h = html();
    expect(h).toContain('solid');
    expect(h).toMatch(/aria-labelledby="backup-reminder-title"/);
  });
});

describe('การต่อสาย UI', () => {
  const ui = import.meta.glob('/src/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const of = (name: string) => Object.entries(ui).find(([p]) => p.endsWith(`/${name}`))?.[1] ?? '';
  it('ภาพรวมแสดงแถบเตือนใต้การ์ดเริ่มต้น ก่อนการ์ดสรุป', () => {
    const t = of('Today.tsx');
    expect(t.indexOf('<StartGuide')).toBeGreaterThan(-1);
    expect(t.indexOf('<BackupReminder')).toBeGreaterThan(t.indexOf('<StartGuide'));
    expect(t.indexOf('<BackupReminder')).toBeLessThan(t.indexOf('<SummaryCards'));
  });
  it('ดาวน์โหลดสำเร็จแล้วจึงจดวันที่ (จดหลัง downloadBackup ไม่ใช่ก่อน) ทั้งในแถบเตือนและหน้าโปรไฟล์', () => {
    for (const f of ['App.tsx', 'AccountView.tsx']) {
      const t = of(f);
      expect(t.indexOf('downloadBackup(repo)'), f).toBeGreaterThan(-1);
      expect(t.indexOf('markBackupDone('), f).toBeGreaterThan(t.indexOf('downloadBackup(repo)'));
    }
  });
});
