import { describe, expect, it } from 'vitest';
import { tradesFingerprint, tradesFingerprintText, type TradeFingerprintRow } from '../../src/domain/invest/tradesFingerprint';

// ตัวอย่างชุดเดียวกับที่คำนวณบนฐานข้อมูลจริง (สูตร private.trades_fingerprint) ได้ 0034d207… · ถ้าแก้สูตรฝั่งใดฝั่งหนึ่ง ต้องแก้ทั้งสองฝั่งและค่านี้
const FIXTURE: TradeFingerprintRow[] = [
  { id: 'b1', kind: 'buy', date: '2026-11-03', created_at: '2026-11-03T03:00:00.123456+00:00', units: '1000000000', price_micro: 100000000, amount: 100000, fee: 100, withholding: 0, fx_rate_micro: 35000000 },
  { id: 'a-div', kind: 'dividend', date: '2026-11-02', created_at: '2026-11-02T04:30:00+00:00', units: null, price_micro: null, amount: 1000, fee: 0, withholding: 100, fx_rate_micro: null },
  { id: 'Z-sell', kind: 'sell', date: '2026-11-10', created_at: '2026-11-10T04:00:00.9999+00:00', units: '400000000', price_micro: 6000000, amount: null, fee: 10, withholding: 0 },
  { id: 'thai-ก', kind: 'reinvest', date: '2026-11-12', created_at: '2026-11-12T10:15:30.5+07:00', units: '10000000', price_micro: null, amount: 500, fee: 0, withholding: 0, fx_rate_micro: null },
];
const FIXTURE_HASH = '0034d207c10186745db5213afd7d4a961593a96807ab7f6267b7d30032b4544f';

describe('tradesFingerprint (basedOn ลายนิ้วมือรายการ)', () => {
  it('ตรงกับค่าที่ฐานข้อมูลคำนวณจากชุดเดียวกัน', async () => {
    expect(await tradesFingerprint(FIXTURE)).toBe(FIXTURE_HASH);
  });

  it('สินทรัพย์ไม่มีรายการ = sha256 ของ "0\\n" (ตรงเทสต์ SQL T1)', async () => {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('0\n'));
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await tradesFingerprint([])).toBe(hex);
  });

  it('รูปข้อความ: จำนวนรายการ แล้วบรรทัดละรายการ เรียงตามรหัสแบบไบต์ (ตัวพิมพ์ใหญ่ก่อนเล็ก) ฟิลด์ว่าง = ว่าง', () => {
    expect(tradesFingerprintText(FIXTURE)).toBe(
      [
        '4',
        'Z-sell|sell|2026-11-10|1794283200999|400000000|6000000||10|0|',
        'a-div|dividend|2026-11-02|1793593800000|||1000|0|100|',
        'b1|buy|2026-11-03|1793674800123|1000000000|100000000|100000|100|0|35000000',
        'thai-ก|reinvest|2026-11-12|1794453330500|10000000||500|0|0|',
      ].join('\n'),
    );
  });

  it('ลำดับแถวที่ส่งมาไม่มีผล (เรียงตามรหัสเสมอ)', async () => {
    expect(await tradesFingerprint([...FIXTURE].reverse())).toBe(FIXTURE_HASH);
  });

  it('ตัวเลขจะเป็น number หรือ string ก็ได้ผลเท่ากัน (PostgREST ส่ง bigint เป็น number)', async () => {
    const asStrings = FIXTURE.map((t) => ({
      ...t,
      price_micro: t.price_micro === null ? null : String(t.price_micro),
      amount: t.amount === null ? null : String(t.amount),
      fee: String(t.fee),
      withholding: String(t.withholding),
    }));
    expect(await tradesFingerprint(asStrings)).toBe(FIXTURE_HASH);
  });

  it('แก้ฟิลด์ใดก็ตามที่กระทบต้นทุน แม้จำนวนรายการเท่าเดิม ลายนิ้วมือต้องเปลี่ยน', async () => {
    const changes: Array<Partial<TradeFingerprintRow>> = [
      { id: 'b1x' },
      { kind: 'reinvest' },
      { date: '2026-11-04' },
      { created_at: '2026-11-03T03:00:00.124+00:00' },
      { units: '1000000001' },
      { price_micro: 100000001 },
      { amount: 100001 },
      { fee: 101 },
      { withholding: 1 },
      { fx_rate_micro: 35000001 },
      { fx_rate_micro: null },
    ];
    for (const change of changes) {
      const edited = FIXTURE.map((t, i) => (i === 0 ? { ...t, ...change } : t));
      expect(edited).toHaveLength(FIXTURE.length);
      expect(await tradesFingerprint(edited), JSON.stringify(change)).not.toBe(FIXTURE_HASH);
    }
  });

  it('ศูนย์ไม่เท่ากับว่าง (fee 0 ต่างจากไม่มีค่า) และเพิ่ม/ลบรายการเปลี่ยนค่า', async () => {
    const noPrice = FIXTURE.map((t, i) => (i === 2 ? { ...t, price_micro: 0 } : t));
    expect(await tradesFingerprint(noPrice)).not.toBe(FIXTURE_HASH);
    expect(await tradesFingerprint(FIXTURE.slice(1))).not.toBe(FIXTURE_HASH);
  });
});
