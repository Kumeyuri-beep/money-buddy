// ลายนิ้วมือรายการของสินทรัพย์ (basedOn) · ต้องตรงกับ private.trades_fingerprint ในฐานข้อมูลทุกตัวอักษร
// (supabase/migrations/20261124000100_basedon_fingerprint.sql) · ใช้กันสองแท็บ/แท็บเก่า: ต้นทุนที่ตัดออกของรายการขายคำนวณจากรายการเหล่านี้
// สูตร: sha256(hex) ของ "<จำนวนรายการ>\n" + บรรทัดละรายการ คั่นด้วย "\n" เรียงตามรหัสแบบไบต์ (collate "C")
//   บรรทัด = id|kind|date|created_at (มิลลิวินาที epoch ปัดลง · ลำดับในวันเดียวกันของ replay ขึ้นกับมัน)|units|price_micro|amount|fee|withholding|fx_rate_micro (ค่าว่าง/null = ข้อความว่าง)
// ไม่รวม memo/entry_id (ไม่กระทบต้นทุน) · ห้ามมีสูตรเงินที่นี่ (ไม่คำนวณเงิน แค่ต่อข้อความ)

/** แถวรายการลงทุนตามรูปที่ฐานข้อมูลส่งกลับ (ฟิลด์เท่าที่ลายนิ้วมือใช้) */
export interface TradeFingerprintRow {
  id: string;
  kind: string;
  date: string;
  /** ISO จาก PostgREST (อาจมีเศษวินาทีถึงไมโครวินาที) */
  created_at: string;
  units: string | null;
  price_micro: number | string | null;
  amount: number | string | null;
  fee: number | string;
  withholding: number | string;
  fx_rate_micro?: number | string | null;
}

const encoder = new TextEncoder();

function text(value: number | string | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/** เทียบรหัสแบบไบต์ UTF-8 (เหมือน collate "C" ของ Postgres บนฐานข้อมูล UTF-8) */
function compareBytes(a: string, b: string): number {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i += 1) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

/** ข้อความที่ใช้ทำลายนิ้วมือ (แยกไว้ให้เทสต์ตรวจรูปแบบ) */
export function tradesFingerprintText(rows: readonly TradeFingerprintRow[]): string {
  const sorted = [...rows].sort((p, q) => compareBytes(p.id, q.id));
  const lines = sorted.map((t) =>
    [t.id, t.kind, t.date, String(Date.parse(t.created_at)), text(t.units), text(t.price_micro), text(t.amount), text(t.fee), text(t.withholding), text(t.fx_rate_micro)].join('|'),
  );
  return `${rows.length}\n${lines.join('\n')}`;
}

export async function tradesFingerprint(rows: readonly TradeFingerprintRow[]): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('เบราว์เซอร์นี้ไม่รองรับการตรวจความสดของข้อมูล (ต้องใช้ HTTPS)');
  const digest = await subtle.digest('SHA-256', encoder.encode(tradesFingerprintText(rows)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
