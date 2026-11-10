import { describe, expect, it } from 'vitest';

// สแกนซอร์สโฟลเดอร์ลงทุน: ห้ามทศนิยมลอยตัวเข้าสูตรหน่วย/ราคา/ต้นทุน (R9, R17)
const sources = {
  ...(import.meta.glob('../../src/domain/invest/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
  ...(import.meta.glob('../../src/app/averaging.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>),
};

describe('โฟลเดอร์ src/domain/invest ไม่มีทศนิยมลอยตัว', () => {
  it('พบไฟล์ซอร์ส', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4);
  });
  for (const [path, text] of Object.entries(sources)) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    it(`${path.split('/').pop()}: ไม่มี parseFloat / toFixed / Math.round / Math.floor`, () => {
      expect(code).not.toMatch(/parseFloat|toFixed|Math\.round|Math\.floor|Math\.trunc/);
    });
  }
});
