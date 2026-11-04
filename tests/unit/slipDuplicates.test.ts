import { describe, expect, it } from 'vitest';
import { buildEntry } from '../../src/app/entryForm';
import { buildInitialLedger } from '../../src/app/setup';
import { findDuplicateEntry } from '../../src/app/slipDuplicates';
import { createEntry } from '../../src/domain/ledger/entry';
import type { Entry } from '../../src/domain/ledger/types';

// ข้อมูลทั้งหมดสมมติ
const { accounts } = buildInitialLedger(
  [
    { name: 'CashFlow', opening: '' },
    { name: 'Mainframe', opening: '' },
  ],
  '2026-11-01',
);

const entry = (id: string, date: string, amount: string, memo: string, source: Entry['source'] = 'manual'): Entry =>
  createEntry(accounts, {
    ...buildEntry(accounts, { kind: 'expense', date, amount, walletId: 'wallet-1', counterId: 'expense-food', memo }, id),
    source,
  });

const existing = entry('e1', '2026-11-12', '65', 'ร้านกาแฟตัวอย่าง 14:35 น.');

describe('findDuplicateEntry: เตือนสลิปที่คล้ายรายการเดิม (ยอด + วันที่ + ผู้รับ)', () => {
  it('ยอด วันที่ และผู้รับตรงกัน -> คืนรายการเดิม', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '65.00', recipient: 'ร้านกาแฟตัวอย่าง' })).toBe(
      existing,
    );
  });

  it('เทียบยอดเป็นสตางค์ ไม่ใช่ข้อความ ("65" = "65.00" = "65.0")', () => {
    for (const amount of ['65', '65.0', '65.00', '฿65']) {
      expect(findDuplicateEntry([existing], { date: '2026-11-12', amount, recipient: 'ร้านกาแฟตัวอย่าง' })).toBe(existing);
    }
  });

  it('ยอดต่างกัน 1 สตางค์ -> ไม่ซ้ำ', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '65.01', recipient: 'ร้านกาแฟตัวอย่าง' })).toBeUndefined();
  });

  it('วันที่ต่างกัน 1 วัน -> ไม่ซ้ำ', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-13', amount: '65', recipient: 'ร้านกาแฟตัวอย่าง' })).toBeUndefined();
  });

  it('ผู้รับไม่อยู่ใน memo เดิม -> ไม่ซ้ำ', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '65', recipient: 'ร้านข้าวตัวอย่าง' })).toBeUndefined();
  });

  it('เทียบชื่อผู้รับแบบไม่สนตัวพิมพ์เล็กใหญ่และช่องว่างซ้ำ', () => {
    const e = entry('e2', '2026-11-12', '120', 'Cafe  Example   10:00 น.');
    expect(findDuplicateEntry([e], { date: '2026-11-12', amount: '120', recipient: 'CAFE EXAMPLE' })).toBe(e);
  });

  it('ไม่มีชื่อผู้รับในสลิป -> เทียบแค่ยอดกับวันที่', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '65' })).toBe(existing);
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '66' })).toBeUndefined();
  });

  it('ข้ามรายการยอดยกมาของระบบ แม้ยอดและวันที่ตรงกัน', () => {
    const opening = entry('e3', '2026-11-12', '65', 'ยอดยกมา', 'system');
    expect(findDuplicateEntry([opening], { date: '2026-11-12', amount: '65' })).toBeUndefined();
  });

  it('ยอดว่าง ยอด 0 หรือวันที่ว่าง -> ไม่ตรวจ (ยังกรอกไม่ครบ)', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '' })).toBeUndefined();
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '0' })).toBeUndefined();
    expect(findDuplicateEntry([existing], { date: '', amount: '65' })).toBeUndefined();
  });

  it('ยอดที่อ่านไม่ได้ ("abc") หรือใหญ่เกินช่วงปลอดภัย -> ไม่ตรวจ ไม่โยนข้อผิดพลาด', () => {
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: 'abc' })).toBeUndefined();
    expect(findDuplicateEntry([existing], { date: '2026-11-12', amount: '99999999999999999999' })).toBeUndefined();
  });

  it('มีหลายรายการ: คืนรายการที่ตรง', () => {
    const other = entry('e4', '2026-11-12', '70', 'ร้านกาแฟตัวอย่าง');
    expect(findDuplicateEntry([other, existing], { date: '2026-11-12', amount: '65', recipient: 'ร้านกาแฟตัวอย่าง' })).toBe(existing);
  });

  it('สมุดว่าง -> ไม่ซ้ำ', () => {
    expect(findDuplicateEntry([], { date: '2026-11-12', amount: '65' })).toBeUndefined();
  });
});
