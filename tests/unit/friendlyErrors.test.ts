import { describe, expect, it } from 'vitest';
import { friendlyError, humanizeLedgerMessage } from '../../src/app/errorText';
import { EntryFormError } from '../../src/app/entryForm';
import { SetupError } from '../../src/app/setup';
import { BillError } from '../../src/domain/bills/schedule';
import { LedgerError } from '../../src/domain/ledger/entry';
import { StorageError } from '../../src/storage/repository';

/** ผู้ใช้ต้องไม่เห็นข้อความดิบของระบบ (ชื่อ error อังกฤษ, Entry/Line, ผลต่างเป็นสตางค์) · ผลสำรวจผู้ใช้ใหม่ 13 พ.ย. 2569 */
describe('friendlyError', () => {
  it('ข้อความไทยที่แอปเขียนเอง แสดงตามนั้น', () => {
    expect(friendlyError(new EntryFormError('กรอกจำนวนเงินก่อน'))).toBe('กรอกจำนวนเงินก่อน');
    expect(friendlyError(new SetupError('ใส่ชื่อกระเป๋าก่อน'))).toBe('ใส่ชื่อกระเป๋าก่อน');
    expect(friendlyError(new StorageError('บันทึกไม่ได้ ลองอีกครั้ง'))).toBe('บันทึกไม่ได้ ลองอีกครั้ง');
    expect(friendlyError(new BillError('บิลนี้จ่ายรอบนี้ไปแล้ว'))).toBe('บิลนี้จ่ายรอบนี้ไปแล้ว');
  });
  it('ข้อผิดพลาดของระบบไม่แสดงดิบ: ใช้ข้อความสำรอง/ข้อความเครือข่าย', () => {
    expect(friendlyError(new TypeError('Failed to fetch'))).toBe('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
    expect(friendlyError(new Error('boom: internal'))).toBe('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    expect(friendlyError(new Error('boom'), 'ตั้งต้นไม่สำเร็จ')).toBe('ตั้งต้นไม่สำเร็จ');
    expect(friendlyError('สตริงดิบ')).toBe('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    expect(friendlyError(undefined)).toBe('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
  });
  it('RangeError จากสูตรเงิน (ข้อความอังกฤษ/ศัพท์เทคนิค) เป็นข้อความตัวเลขใหญ่เกินไป', () => {
    const msg = friendlyError(new RangeError('roundHalfUp: ต้องเป็นจำนวนเต็มที่อยู่ในช่วงปลอดภัย'));
    expect(msg).toBe('ตัวเลขใหญ่เกินไปหรือไม่ถูกต้อง ตรวจจำนวนเงินอีกครั้ง');
    expect(msg).not.toContain('roundHalfUp');
  });
  it('LedgerError: ไม่มีคำ Entry/Line และไม่โชว์ผลต่างเป็นสตางค์ดิบ', () => {
    for (const raw of ['Entry ต้องมีอย่างน้อย 2 Line', 'ห้ามมี Line ยอด 0 (บัญชี abc-123)', 'Entry ไม่สมดุลในสกุลเงิน THB: ผลต่าง 100']) {
      const out = friendlyError(new LedgerError(raw));
      expect(out, raw).not.toMatch(/Entry|Line|ผลต่าง/);
    }
    expect(humanizeLedgerMessage('Entry ต้องมีอย่างน้อย 2 Line')).toBe('รายการต้องมีอย่างน้อย 2 บรรทัด');
    expect(humanizeLedgerMessage('Entry ไม่สมดุลในสกุลเงิน THB: ผลต่าง 100')).toBe('รายการไม่สมดุลในสกุลเงิน THB (ยอดฝั่งเข้าและฝั่งออกไม่เท่ากัน)');
    expect(humanizeLedgerMessage('ห้ามมี Line ยอด 0 (บัญชี abc-123)')).toBe('ห้ามมีบรรทัดที่ยอดเป็น 0');
  });
});

describe('หน้าจอไม่ใช้ข้อความดิบของ error', () => {
  const files = import.meta.glob('/src/ui/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('ไม่มี e.message หรือ String(e) ที่แสดงผู้ใช้ตรงๆ ใน App/QuickAdd/AddEntryDialog/Setup', () => {
    for (const n of ['App.tsx', 'QuickAdd.tsx', 'AddEntryDialog.tsx', 'Setup.tsx']) {
      const s = files[`/src/ui/${n}`] ?? '';
      expect(s, n).not.toMatch(/e instanceof Error \? e\.message : String\(e\)/);
      expect(s, n).not.toMatch(/\$\{String\(e\)\}/);
      expect(s, n).toContain('friendlyError');
    }
  });
});
