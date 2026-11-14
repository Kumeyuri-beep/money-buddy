import { describe, expect, it } from 'vitest';
import { MAX_MEMO_LENGTH, MAX_NAME_LENGTH } from '../../src/domain/ledger/limits';

/**
 * ช่องกรอกที่เก็บลงฐานข้อมูลต้องมี maxLength ตรงกับข้อจำกัดของ DB (ฝั่งเว็บกันก่อน ไม่ปล่อยให้ผู้ใช้พิมพ์เกินแล้วค่อยถูกปฏิเสธ)
 * ตรวจที่ระดับซอร์ส (ไม่มี DOM ในเทสต์ชุดนี้): maxLength ต้องอ้างค่าคงที่จาก domain/ledger/limits ไม่ใช่เลขตายตัว
 * หมายเหตุ: maxLength ของ HTML นับหน่วย UTF-16 ซึ่งไม่น้อยกว่าจำนวนจุดรหัสที่ DB นับ จึงเข้มกว่าหรือเท่ากันเสมอ (ปลอดภัย)
 */
const files = import.meta.glob(['/src/ui/*.tsx', '/supabase/migrations/20261108000000_m2a_schema.sql'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const read = (path: string): string => {
  const text = files['/' + path];
  if (text === undefined) throw new Error('ไม่พบไฟล์ ' + path);
  return text;
};

/** ดึงแท็ก <input ... /> ที่มีข้อความ marker (เช่น id="bill-name") อยู่ในแท็ก */
function inputTag(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`ไม่พบ ${marker}`);
  const start = source.lastIndexOf('<input', at);
  const end = source.indexOf('/>', at);
  if (start < 0 || end < 0) throw new Error(`ไม่พบแท็ก input ของ ${marker}`);
  return source.slice(start, end + 2);
}

describe('ค่าคงที่ตรงกับ migration ของฐานข้อมูล', () => {
  const sql = read('supabase/migrations/20261108000000_m2a_schema.sql');
  it('ชื่อ ≤ 200 และ memo ≤ 2000', () => {
    expect(sql).toContain(`char_length(name) between 1 and ${MAX_NAME_LENGTH}`);
    expect(sql).toContain(`char_length(memo) <= ${MAX_MEMO_LENGTH}`);
  });
});

describe('ช่องกรอกมี maxLength ตรงกับ DB', () => {
  it('ชื่อกระเป๋าในหน้าตั้งต้น', () => {
    expect(inputTag(read('src/ui/Setup.tsx'), 'id={`name-${i}`}')).toContain('maxLength={MAX_NAME_LENGTH}');
  });
  it('ชื่อบิล', () => {
    expect(inputTag(read('src/ui/BillDialog.tsx'), 'id="bill-name"')).toContain('maxLength={MAX_NAME_LENGTH}');
  });
  it('บันทึกช่วยจำของรายการ', () => {
    expect(inputTag(read('src/ui/MemoField.tsx'), 'id="entry-memo"')).toContain('maxLength={MAX_MEMO_LENGTH}');
  });
  it('ช่องพิมพ์จดด่วน (กลายเป็น memo)', () => {
    expect(inputTag(read('src/ui/QuickAdd.tsx'), 'id="quick-text"')).toContain('maxLength={MAX_MEMO_LENGTH}');
  });
  it('ไฟล์ที่ใช้ต้อง import ค่าคงที่จาก limits (ไม่ใช้เลขตายตัว)', () => {
    for (const [file, name] of [
      ['src/ui/Setup.tsx', 'MAX_NAME_LENGTH'],
      ['src/ui/BillDialog.tsx', 'MAX_NAME_LENGTH'],
      ['src/ui/MemoField.tsx', 'MAX_MEMO_LENGTH'],
      ['src/ui/QuickAdd.tsx', 'MAX_MEMO_LENGTH'],
    ] as const) {
      expect(read(file), file).toMatch(new RegExp(`import[^;]*${name}[^;]*from '[^']*domain/ledger/limits'`, 's'));
    }
  });
});
