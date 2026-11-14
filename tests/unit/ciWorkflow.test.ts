import { describe, expect, it } from 'vitest';
import ci from '../../.github/workflows/ci.yml?raw';

/** โครงสร้าง CI (14 พ.ย. 2569): e2e แบ่ง 4 shard ขนานกัน + งานรวมชื่อ "e2e" (กติกา merge ใน CLAUDE.md ตรวจชื่อ e2e) */
const text = ci.replace(/\r\n/g, '\n');

describe('ci.yml: e2e แบบ shard', () => {
  it('มีงานรวมชื่อ e2e ที่ต้องรอทุก shard และล้มถ้า shard ใดไม่สำเร็จ (ไม่ถูกข้ามเมื่อ shard ล้ม)', () => {
    expect(text).toMatch(/\n  e2e:\n    needs: e2e-shard\n    if: \$\{\{ always\(\) \}\}/);
    expect(text).toContain('test "${{ needs.e2e-shard.result }}" = "success"');
  });
  it('shard ขนาน 4 ส่วน (1-4) ไม่หยุดทั้งชุดเมื่อ shard เดียวล้ม และรันชุดเทสต์เดียวกันทั้งหมด (ไม่กรองเทสต์)', () => {
    expect(text).toContain('shard: [1, 2, 3, 4]');
    expect(text).toContain('fail-fast: false');
    expect(text).toContain('npx playwright test --shard=${{ matrix.shard }}/4');
    expect(text).not.toMatch(/playwright test[^\n]*(--grep|-g |--project|\.spec\.ts)/);
  });
  it('ชื่อ shard ขึ้นต้นด้วย "e2e-shard" (ไม่ชนกับคำสั่ง merge ที่จับ job ชื่อ e2e) และมีเพดานเวลา', () => {
    expect(text).toContain('name: e2e-shard (${{ matrix.shard }}/4)');
    expect(text).toMatch(/e2e-shard:[\s\S]*timeout-minutes: 6/);
  });
  it('shard เก็บผลเมื่อล้มด้วยชื่อ artifact ไม่ซ้ำกันต่อ shard', () => {
    expect(text).toContain('name: playwright-results-${{ matrix.shard }}');
  });
});
