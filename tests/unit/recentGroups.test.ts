import { describe, expect, it } from 'vitest';
import { groupRecentByDay } from '../../src/app/recentGroups';
import type { Entry } from '../../src/domain/ledger/types';

let seq = 0;
function entry(date: string, source: Entry['source'] = 'manual', memo = ''): Entry {
  seq += 1;
  return {
    id: `r${seq}`,
    date,
    memo: memo || `m${seq}`,
    source,
    lines: [
      { accountId: 'a', amount: 1 },
      { accountId: 'b', amount: -1 },
    ],
  };
}

const keys = (groups: ReturnType<typeof groupRecentByDay>) => groups.map((g) => g.kind);

describe('groupRecentByDay: หัวข้อวัน', () => {
  it('ไม่มีรายการ: คืนอาร์เรย์ว่าง', () => {
    expect(groupRecentByDay([], '2026-11-03', 8)).toEqual([]);
  });

  it('วันนี้ / เมื่อวาน / วันที่อื่น', () => {
    const g = groupRecentByDay(
      [entry('2026-10-30'), entry('2026-11-02'), entry('2026-11-03')],
      '2026-11-03',
      8,
    );
    expect(keys(g)).toEqual(['today', 'yesterday', 'other']);
    expect(g.map((x) => x.date)).toEqual(['2026-11-03', '2026-11-02', '2026-10-30']);
    expect(g[0]?.label).toBe('วันนี้');
    expect(g[1]?.label).toBe('เมื่อวาน');
    expect(g[2]?.label).not.toBe('');
  });

  it('รายการหลายรายการวันเดียวกันอยู่กลุ่มเดียว ใหม่สุดก่อน (ตามลำดับท้ายสุดของข้อมูลก่อน)', () => {
    const a = entry('2026-11-03', 'manual', 'แรก');
    const b = entry('2026-11-03', 'manual', 'หลัง');
    const g = groupRecentByDay([a, b], '2026-11-03', 8);
    expect(g).toHaveLength(1);
    expect(g[0]?.entries.map((x) => x.memo)).toEqual(['หลัง', 'แรก']);
  });
});

describe('groupRecentByDay: ขอบเวลา', () => {
  it('วันนี้เป็นวันที่ 1: เมื่อวานคือสิ้นเดือนก่อน (30 ต.ค.)', () => {
    const g = groupRecentByDay([entry('2026-10-31')], '2026-11-01', 8);
    expect(keys(g)).toEqual(['yesterday']);
  });

  it('ข้ามปี: 1 ม.ค. เมื่อวานคือ 31 ธ.ค. ปีก่อน', () => {
    const g = groupRecentByDay([entry('2026-12-31')], '2027-01-01', 8);
    expect(keys(g)).toEqual(['yesterday']);
  });

  it('ปีอธิกสุรทิน: 1 มี.ค. 2028 เมื่อวานคือ 29 ก.พ.', () => {
    const g = groupRecentByDay([entry('2028-02-29')], '2028-03-01', 8);
    expect(keys(g)).toEqual(['yesterday']);
  });

  it('ไม่ใช่ปีอธิกสุรทิน: 1 มี.ค. 2027 เมื่อวานคือ 28 ก.พ. และ 27 ก.พ. เป็น other', () => {
    const g = groupRecentByDay([entry('2027-02-27'), entry('2027-02-28')], '2027-03-01', 8);
    expect(keys(g)).toEqual(['yesterday', 'other']);
  });

  it('รายการลงวันล่วงหน้าไม่ถูกเรียกว่า วันนี้/เมื่อวาน และอยู่บนสุด', () => {
    const g = groupRecentByDay([entry('2026-11-03'), entry('2026-11-05')], '2026-11-03', 8);
    expect(keys(g)).toEqual(['other', 'today']);
    expect(g[0]?.date).toBe('2026-11-05');
  });
});

describe('groupRecentByDay: จำนวนและการกรอง', () => {
  it('ตัดรายการยอดยกมา (source system) ออก', () => {
    const g = groupRecentByDay([entry('2026-11-03', 'system'), entry('2026-11-03')], '2026-11-03', 8);
    expect(g[0]?.entries).toHaveLength(1);
  });

  it('มีแต่รายการ system: คืนอาร์เรย์ว่าง', () => {
    expect(groupRecentByDay([entry('2026-11-03', 'system')], '2026-11-03', 8)).toEqual([]);
  });

  it('จำกัดจำนวนรายการรวมทุกกลุ่มตาม limit โดยเก็บรายการใหม่สุด', () => {
    const list = Array.from({ length: 12 }, (_, i) => entry(i < 6 ? '2026-11-02' : '2026-11-03', 'manual', `n${i}`));
    const g = groupRecentByDay(list, '2026-11-03', 8);
    const total = g.reduce((s, x) => s + x.entries.length, 0);
    expect(total).toBe(8);
    expect(keys(g)).toEqual(['today', 'yesterday']);
    expect(g[0]?.entries).toHaveLength(6);
    expect(g[1]?.entries).toHaveLength(2);
  });

  it('limit 0 = ไม่มีรายการ', () => {
    expect(groupRecentByDay([entry('2026-11-03')], '2026-11-03', 0)).toEqual([]);
  });

  it('ไม่แก้อาร์เรย์ต้นฉบับ', () => {
    const list = [entry('2026-11-01'), entry('2026-11-03')];
    const copy = list.slice();
    groupRecentByDay(list, '2026-11-03', 8);
    expect(list).toEqual(copy);
  });
});
