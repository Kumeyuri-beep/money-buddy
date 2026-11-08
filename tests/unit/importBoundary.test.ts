import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(
  ['/src/domain/backup/*.ts', '/src/app/importVerify.ts', '/src/app/localBackup.ts', '/src/ui/backup.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/**
 * เจ้าของสั่ง (9 พ.ย. 2569): ห้ามลบข้อมูลใน Dexie จนกว่าจะยืนยันว่านำเข้าครบและยอดตรง
 * โค้ดส่วนตรวจ/นำเข้า/ตรวจยอด/สำรองต้องไม่มีทางลบหรือล้างข้อมูลในเครื่อง
 */
describe('การนำเข้าไม่แตะข้อมูลเดิมใน Dexie', () => {
  it('ไฟล์ที่เกี่ยวข้องมีอยู่ครบ (กัน glob ว่าง)', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
  });
  it('ไม่มีการเรียก resetAll / clear / delete / bulkDelete / ล้างฐาน', () => {
    for (const [path, text] of Object.entries(sources)) {
      expect(text, path).not.toMatch(/resetAll|\.clear\(|\.delete\(|bulkDelete|deleteDatabase|\.drop\(|indexedDB\.delete/);
    }
  });
});
