import { describe, expect, it } from 'vitest';

const ui = import.meta.glob('/src/ui/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const app = import.meta.glob('/src/app/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** หน้าจอเข้าถึงข้อมูลผ่าน LedgerRepository เท่านั้น (M2-C) ยกเว้นตัวช่วยย้ายข้อมูลเฉพาะ Dexie ที่จะหายไปใน M2-D */
const DEXIE_ONLY = ['/src/ui/RepositoryContext.tsx', '/src/ui/App.tsx', '/src/ui/DataSourceGate.tsx', '/src/ui/backup.ts'];

describe('ขอบเขต repository', () => {
  it('src/ui ไม่ import db ตรง ยกเว้นไฟล์ที่ระบุ', () => {
    expect(Object.keys(ui).length).toBeGreaterThan(10);
    for (const [path, text] of Object.entries(ui)) {
      if (DEXIE_ONLY.includes(path)) continue;
      expect(text, path).not.toMatch(/storage\/instance/);
    }
  });
  it('src/ui ไม่เรียกฟังก์ชันเขียน/อ่านของ repository.ts ด้วย db โดยตรง', () => {
    for (const [path, text] of Object.entries(ui)) {
      expect(text, path).not.toMatch(/\b(appendEntry|updateEntry|deleteEntry|addBill|updateBill|deleteBill|payBill|undoPayBill|saveSettings|saveInitialLedger|resetAll|loadLedger|loadBills|loadSettings|exportSnapshot)\(db\b/);
    }
  });
  it('src/app (use case) ไม่แตะ db', () => {
    for (const [path, text] of Object.entries(app)) expect(text, path).not.toMatch(/storage\/instance/);
  });
  it('App.tsx ใช้ db เฉพาะตัวช่วย migration snapshot ของ Dexie', () => {
    const t = ui['/src/ui/App.tsx'] ?? '';
    const uses = t.match(/\w+\(db\b[^)]*\)/g) ?? [];
    expect(uses.map((u) => u.split('(')[0]).sort()).toEqual(['clearMigrationSnapshot', 'migrationSnapshotInfo']);
  });
});
