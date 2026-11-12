import { describe, expect, it } from 'vitest';

describe('เมนูมือถือ (pop up)', () => {
  const shell = Object.values(import.meta.glob('/src/ui/Shell.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
  const block = shell.slice(shell.indexOf('const NAV_BOTTOM'), shell.indexOf('function Icon'));
  it('มี "วางแผนเกษียณ" เป็นรายการที่ 7 และ "ภาษี" เป็นรายการที่ 8 (ท้ายสุด) ต่อจาก 6 รายการเดิม', () => {
    const ids = [...block.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['today', 'ledger', 'bills', 'portfolio', 'averaging', 'account', 'retirement', 'tax']);
    expect(block).toContain("short: 'แผนเกษียณ'");
    expect(block).toContain("short: 'ภาษี'");
  });
  it('ไอคอนใช้ชุดเดียวกับแถบข้าง (อ้างจาก NAV_TOOLS ไม่ก๊อป path)', () => {
    expect(block).toMatch(/id: 'retirement'.*icon: NAV_TOOLS\[0\]!\.icon/);
  });
});
