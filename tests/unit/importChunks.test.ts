import { describe, expect, it } from 'vitest';
import { chunkEntries, IMPORT_CHUNK_MAX_ENTRIES, IMPORT_CHUNK_MAX_LINES } from '../../src/domain/backup/chunk';
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_LINES, SINGLE_IMPORT_MAX_ENTRIES } from '../../src/domain/backup/parseBackup';
import type { Entry } from '../../src/domain/ledger/types';

const entry = (i: number, lines = 2): Entry => ({
  id: 'e' + i,
  date: '2026-11-02',
  memo: '',
  source: 'manual',
  lines: Array.from({ length: lines }, (_, j) => ({ accountId: 'a' + j, amount: j % 2 ? -1 : 1 })),
});

describe('แบ่งรายการเป็นก้อนสำหรับนำเข้า', () => {
  it('ไม่ทิ้ง ไม่ซ้ำ ไม่สลับลำดับ: ต่อก้อนกลับได้ลำดับเดิมทุกรายการ', () => {
    const all = Array.from({ length: 1234 }, (_, i) => entry(i));
    const chunks = chunkEntries(all);
    expect(chunks.flat().map((e) => e.id)).toEqual(all.map((e) => e.id));
    expect(chunks.every((c) => c.length > 0)).toBe(true);
  });
  it('ทุกก้อนไม่เกินเพดานจำนวนรายการและจำนวนบรรทัด (ต้องไม่เกินเพดานต่อคำสั่งของฐานข้อมูล)', () => {
    const all = Array.from({ length: 900 }, (_, i) => entry(i, i % 3 === 0 ? 200 : 2));
    for (const c of chunkEntries(all)) {
      expect(c.length).toBeLessThanOrEqual(IMPORT_CHUNK_MAX_ENTRIES);
      expect(c.reduce((n, e) => n + e.lines.length, 0)).toBeLessThanOrEqual(IMPORT_CHUNK_MAX_LINES);
    }
  });
  it('ขอบเขต: ว่าง = ไม่มีก้อน · 1 รายการ = 1 ก้อน · พอดีเพดาน = 1 ก้อน · เกิน 1 = 2 ก้อน', () => {
    expect(chunkEntries([])).toEqual([]);
    expect(chunkEntries([entry(1)])).toHaveLength(1);
    expect(chunkEntries(Array.from({ length: IMPORT_CHUNK_MAX_ENTRIES }, (_, i) => entry(i)))).toHaveLength(1);
    expect(chunkEntries(Array.from({ length: IMPORT_CHUNK_MAX_ENTRIES + 1 }, (_, i) => entry(i)))).toHaveLength(2);
  });
  it('รายการเดียวที่ 200 บรรทัด (สูงสุด) ใส่ได้เสมอ ไม่วนไม่รู้จบ', () => {
    const chunks = chunkEntries([entry(1, 200), entry(2, 200)]);
    expect(chunks.flat()).toHaveLength(2);
  });
  it('เพดานรวมของไฟล์และเพดานต่อคำสั่งตรงกับฐานข้อมูล (migration 20261109000200 / import_ledger)', () => {
    expect(MAX_IMPORT_ENTRIES).toBe(10_000);
    expect(SINGLE_IMPORT_MAX_ENTRIES).toBe(1500);
    expect(IMPORT_CHUNK_MAX_ENTRIES).toBeLessThanOrEqual(1500);
    expect(IMPORT_CHUNK_MAX_LINES).toBeLessThanOrEqual(20_000);
    expect(MAX_IMPORT_LINES).toBe(200_000);
  });
});
