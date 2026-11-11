import { describe, expect, it } from 'vitest';
import { sanitizeSettings, settingsProblem } from '../../src/domain/bills/settings';
import { dcaDueDate, dcaPlanProblem, dcaStatus, MAX_DCA_PLANS, sanitizeDcaPlans, type DcaPlan } from '../../src/domain/invest/dcaPlan';
import type { TradeRecord } from '../../src/domain/invest/types';

const plan = (over: Partial<DcaPlan> = {}): DcaPlan => ({ id: 'p1', assetId: 'a1', amount: 100_000, dayOfMonth: 5, startMonth: '2026-09', ...over });
const buy = (date: string, assetId = 'a1'): TradeRecord => ({
  id: `b-${date}-${assetId}`, assetId, kind: 'buy', date, createdAt: `${date}T03:00:00.000Z`, units: '100000000', amount: 100_000, fee: 0, withholding: 0, memo: '',
});

describe('dcaDueDate: วันครบกำหนดของรอบ (เดือนสั้นใช้วันสุดท้าย)', () => {
  it('วันปกติ', () => expect(dcaDueDate('2026-11', 5)).toBe('2026-11-05'));
  it('31 ในเดือนที่มี 30 วัน = 30', () => expect(dcaDueDate('2026-11', 31)).toBe('2026-11-30'));
  it('29-31 ในกุมภาพันธ์: ปีไม่อธิกสุรทิน = 28 · ปีอธิกสุรทิน = 29', () => {
    expect(dcaDueDate('2027-02', 30)).toBe('2027-02-28');
    expect(dcaDueDate('2028-02', 31)).toBe('2028-02-29');
  });
});

describe('dcaStatus: ตัวเตือน (ไม่สร้างรายการเอง)', () => {
  it('ถึงวันแล้วยังไม่ซื้อ = due ของรอบนี้ · นับวันที่เลยมา', () => {
    const s = dcaStatus(plan(), [], '2026-11-07');
    expect(s).toMatchObject({ state: 'due', cycle: '2026-11', dueDate: '2026-11-05', daysLate: 2 });
  });
  it('วันครบกำหนดพอดี = due (daysLate 0)', () => {
    expect(dcaStatus(plan(), [], '2026-11-05')).toMatchObject({ state: 'due', daysLate: 0 });
  });
  it('ยังไม่ถึงวัน = upcoming นับถอยหลัง', () => {
    const s = dcaStatus(plan({ startMonth: '2026-11' }), [], '2026-11-02');
    expect(s).toEqual({ state: 'upcoming', cycle: '2026-11', dueDate: '2026-11-05', daysUntil: 3 });
  });
  it('ซื้อแล้วในเดือนนั้น (วันไหนก็ได้ ยอดเท่าไรก็ได้) = รอบนี้ทำแล้ว → upcoming เดือนถัดไป', () => {
    const s = dcaStatus(plan({ startMonth: '2026-11' }), [buy('2026-11-01')], '2026-11-20');
    expect(s).toEqual({ state: 'upcoming', cycle: '2026-12', dueDate: '2026-12-05', daysUntil: 15 });
  });
  it('รายการซื้อของสินทรัพย์อื่น หรือขาย/ปันผล ไม่นับว่าทำแล้ว', () => {
    const other = buy('2026-11-06', 'a2');
    const sell: TradeRecord = { ...buy('2026-11-06'), id: 's1', kind: 'sell' };
    expect(dcaStatus(plan({ startMonth: '2026-11' }), [other, sell], '2026-11-07').state).toBe('due');
  });
  it('รอบที่ค้างหลายเดือน: แสดงรอบล่าสุด บอกจำนวนรอบที่ค้าง · ไม่เตือนย้อนเกิน 3 เดือน · ไม่เตือนก่อนเดือนเริ่ม', () => {
    const s = dcaStatus(plan({ startMonth: '2026-01' }), [], '2026-11-07');
    expect(s).toMatchObject({ state: 'due', cycle: '2026-11', pendingCycles: 3 }); // 2026-09, 10, 11
    const fresh = dcaStatus(plan({ startMonth: '2026-11' }), [], '2026-11-07');
    expect(fresh).toMatchObject({ state: 'due', pendingCycles: 1 });
  });
  it('เดือนเริ่มอยู่ในอนาคต = upcoming ของเดือนเริ่ม', () => {
    expect(dcaStatus(plan({ startMonth: '2027-01' }), [], '2026-11-20')).toMatchObject({ state: 'upcoming', cycle: '2027-01', dueDate: '2027-01-05' });
  });
  it('วันสิ้นเดือน: ตั้ง 31 ในเดือน 30 วัน ถึงกำหนดวันที่ 30', () => {
    expect(dcaStatus(plan({ dayOfMonth: 31, startMonth: '2026-11' }), [], '2026-11-29').state).toBe('upcoming');
    expect(dcaStatus(plan({ dayOfMonth: 31, startMonth: '2026-11' }), [], '2026-11-30').state).toBe('due');
  });
  it('ข้ามปี: ธันวาคม → มกราคม', () => {
    const s = dcaStatus(plan({ startMonth: '2026-12' }), [buy('2026-12-03')], '2026-12-20');
    expect(s).toMatchObject({ state: 'upcoming', cycle: '2027-01', dueDate: '2027-01-05' });
  });
  it('พักแผน = ไม่เตือน · สินทรัพย์ไม่มีแล้ว = บอกว่าไม่พบ', () => {
    expect(dcaStatus(plan({ paused: true }), [], '2026-11-07')).toEqual({ state: 'paused' });
    expect(dcaStatus(plan(), [], '2026-11-07', false)).toEqual({ state: 'unknown-asset' });
  });
});

describe('dcaPlanProblem / sanitizeDcaPlans: ไม่เชื่อข้อมูลจากภายนอก', () => {
  it('แผนปกติผ่าน', () => expect(dcaPlanProblem(plan())).toBeNull());
  it('จำนวนเงิน 0 / ติดลบ / ทศนิยม / เกินช่วงปลอดภัย ถูกปฏิเสธ', () => {
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(dcaPlanProblem(plan({ amount })), String(amount)).not.toBeNull();
    }
    expect(dcaPlanProblem(plan({ amount: 1 }))).toBeNull();
    expect(dcaPlanProblem(plan({ amount: Number.MAX_SAFE_INTEGER }))).toBeNull();
  });
  it('วัน 0 / 32 / ทศนิยม และเดือนเริ่มผิดรูป ถูกปฏิเสธ', () => {
    for (const dayOfMonth of [0, 32, 1.5]) expect(dcaPlanProblem(plan({ dayOfMonth }))).not.toBeNull();
    for (const startMonth of ['2026-13', '2026-00', '26-11', '2026-1', '0000-01', '3000-01']) expect(dcaPlanProblem(plan({ startMonth })), startMonth).not.toBeNull();
  });
  it('sanitize ทิ้งแผนเสียและรหัสซ้ำ · เกินเพดานตัดทิ้ง · ไม่ใช่อาร์เรย์ = ว่าง', () => {
    const many = Array.from({ length: MAX_DCA_PLANS + 5 }, (_, i) => plan({ id: `p${i}` }));
    expect(sanitizeDcaPlans(many)).toHaveLength(MAX_DCA_PLANS);
    expect(sanitizeDcaPlans([plan(), plan(), { id: 'x' }, null, 5, plan({ id: 'p2', amount: 0 })])).toEqual([plan()]);
    expect(sanitizeDcaPlans('x')).toEqual([]);
    expect(sanitizeDcaPlans(undefined)).toEqual([]);
  });
  it('sanitize เก็บ paused เฉพาะ true และไม่เก็บฟิลด์แปลก', () => {
    const [p] = sanitizeDcaPlans([{ ...plan(), paused: true, extra: 'x' }]);
    expect(p).toEqual({ ...plan(), paused: true });
  });
});

describe('ค่าตั้งค่า (settings) รองรับ dcaPlans', () => {
  it('sanitizeSettings เก็บแผนที่ถูกต้อง · ไม่มีแผน = ไม่มีฟิลด์', () => {
    expect(sanitizeSettings({ payDay: 25, dcaPlans: [plan(), { id: 'bad' }] })).toEqual({ payDay: 25, dcaPlans: [plan()] });
    expect(sanitizeSettings({ payDay: 25, dcaPlans: [] })).toEqual({ payDay: 25 });
  });
  it('settingsProblem ปฏิเสธแผนผิดรูป รหัสซ้ำ และเกินเพดาน', () => {
    expect(settingsProblem({ dcaPlans: [plan()] })).toBeNull();
    expect(settingsProblem({ dcaPlans: [plan({ amount: 0 })] })).toContain('แผนซื้อประจำ');
    expect(settingsProblem({ dcaPlans: [plan(), plan()] })).toContain('รหัสซ้ำ');
    expect(settingsProblem({ dcaPlans: Array.from({ length: MAX_DCA_PLANS + 1 }, (_, i) => plan({ id: `p${i}` })) })).toContain('ไม่เกิน');
  });
});

describe('ไฟล์สำรองรวมแผน DCA (ผ่าน settings)', () => {
  const accountsF = [{ id: 'w1', type: 'asset', name: 'กระเป๋า', currency: 'THB' }];
  const backup = (settings: unknown) => JSON.stringify({ schemaVersion: 2, exportedAt: '2026-11-10T00:00:00.000Z', accounts: accountsF, entries: [], bills: [], settings });
  it('แผนที่ถูกต้องคงอยู่หลังตรวจไฟล์', async () => {
    const { parseBackup } = await import('../../src/domain/backup/parseBackup');
    const r = parseBackup(backup({ payDay: 25, dcaPlans: [plan()] }), '2026-11-10');
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.data.settings).toEqual({ payDay: 25, dcaPlans: [plan()] });
  });
  it('แผนผิดรูปในไฟล์ = ไฟล์ถูกปฏิเสธพร้อมเหตุผล (ไม่ทิ้งเงียบ)', async () => {
    const { parseBackup } = await import('../../src/domain/backup/parseBackup');
    const r = parseBackup(backup({ dcaPlans: [plan({ amount: 0 })] }), '2026-11-10');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.join(' | ')).toContain('แผนซื้อประจำ');
  });
});

describe('ผลตรวจ money-auditor: เดือนเริ่มของแผนใหม่, ต้นเดือนที่มีรอบเก่าค้าง, จำนวนเงินใกล้เพดาน', () => {
  it('สร้างแผนหลังวันครบกำหนดของเดือนนี้ = เริ่มเดือนหน้า (ไม่เตือน "เลยมา" ทันที) · วันครบกำหนดคือวันนี้ = เริ่มเดือนนี้', async () => {
    const { dcaStartMonth } = await import('../../src/domain/invest/dcaPlan');
    expect(dcaStartMonth('2026-11-20', 5)).toBe('2026-12');
    expect(dcaStartMonth('2026-11-05', 5)).toBe('2026-11');
    expect(dcaStartMonth('2026-11-02', 5)).toBe('2026-11');
    expect(dcaStartMonth('2026-12-20', 5)).toBe('2027-01');
    const p = plan({ startMonth: dcaStartMonth('2026-11-20', 5) });
    expect(dcaStatus(p, [], '2026-11-20')).toMatchObject({ state: 'upcoming', cycle: '2026-12' });
  });
  it('ต้นเดือน ก่อนวันครบกำหนด แต่เดือนก่อนค้างอยู่ = due ของเดือนก่อน', () => {
    const s = dcaStatus(plan({ startMonth: '2026-10' }), [], '2026-11-02');
    expect(s).toMatchObject({ state: 'due', cycle: '2026-10', dueDate: '2026-10-05' });
  });
  it('จำนวนเงินใกล้เพดาน: สตางค์ → ข้อความในฟอร์ม → สตางค์ ย้อนกลับตรงทุกค่า', async () => {
    const { parseBahtToSatang, satang, toBahtString } = await import('../../src/domain/money/satang');
    for (const n of [1, 99, 100, 123_456_789, Number.MAX_SAFE_INTEGER]) {
      expect(parseBahtToSatang(toBahtString(satang(n)))).toBe(n);
    }
  });
});
