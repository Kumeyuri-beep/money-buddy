import { describe, expect, it } from 'vitest';
import ci from '../../.github/workflows/ci.yml?raw';

/**
 * โครงสร้าง CI: e2e แบ่ง 5 shard ขนานกัน + งานรวมชื่อ "e2e" (กติกา merge ใน CLAUDE.md ตรวจชื่อ test และ e2e ต้อง pass)
 * ลดนาที (17 พ.ย. 2569): ข้ามเมื่อแก้แค่เอกสาร (ยังรายงาน pass) · ยกเลิกรอบเก่าของ PR เดิม · shard รอ test ผ่านก่อน
 * ความปลอดภัย (repo เป็น public): สิทธิ์ GITHUB_TOKEN อ่านอย่างเดียว · ไม่มี secrets · ไม่ใช้ pull_request_target
 */
const text = ci.replace(/\r\n/g, '\n');
/** เฉพาะส่วนที่ทำงานจริง (ตัดบรรทัดคอมเมนต์ออก เพื่อไม่ให้คำอธิบายไปชนการตรวจ "ห้ามมี") */
const live = text
  .split('\n')
  .filter((l) => !l.trim().startsWith('#'))
  .join('\n');

describe('ci.yml: e2e แบบ shard', () => {
  it('มีงานรวมชื่อ e2e ที่ต้องรอทุก shard และล้มถ้า shard ใดไม่สำเร็จ (ไม่ถูกข้ามเมื่อ shard ล้ม)', () => {
    expect(text).toMatch(/\n  e2e:\n    needs: \[changes, e2e-shard\]\n    if: \$\{\{ always\(\) \}\}/);
    expect(text).toContain('test "${{ needs.e2e-shard.result }}" = "success"');
  });
  it('shard ขนาน 5 ส่วน (1-5) ไม่หยุดทั้งชุดเมื่อ shard เดียวล้ม และรันชุดเทสต์เดียวกันทั้งหมด (ไม่กรองเทสต์)', () => {
    expect(text).toContain('shard: [1, 2, 3, 4, 5]');
    expect(text).toContain('fail-fast: false');
    expect(text).toContain('npx playwright test --shard=${{ matrix.shard }}/5');
    expect(text).not.toMatch(/playwright test[^\n]*(--grep|-g |--project|\.spec\.ts)/);
  });
  it('ชื่อ shard ขึ้นต้นด้วย "e2e-shard" (ไม่ชนกับคำสั่ง merge ที่จับ job ชื่อ e2e) และมีเพดานเวลา', () => {
    expect(text).toContain('name: e2e-shard (${{ matrix.shard }}/5)');
    expect(text).toMatch(/e2e-shard:[\s\S]*timeout-minutes: 6/);
  });
  it('shard เก็บผลเมื่อล้มด้วยชื่อ artifact ไม่ซ้ำกันต่อ shard', () => {
    expect(text).toContain('name: playwright-results-${{ matrix.shard }}');
  });
  it('shard รอ test ผ่านก่อน (ล้มตั้งแต่ขั้นแรกจะไม่เปลืองนาที) และรันเฉพาะเมื่อแก้โค้ด', () => {
    expect(text).toMatch(/e2e-shard:\n    name: [^\n]+\n    needs: \[changes, test\]\n    if: \$\{\{ needs\.changes\.outputs\.code == 'true' \}\}/);
  });
});

describe('ci.yml: ข้ามเมื่อแก้แค่เอกสาร (ต้องยังรายงาน test/e2e = pass เพื่อให้คำสั่ง merge ผ่าน)', () => {
  it('ไม่ใช้ paths-ignore (จะทำให้ check test/e2e หายไป)', () => {
    expect(live).not.toMatch(/paths-ignore|paths:/);
  });
  it('ทั้ง test และ e2e ยังเป็น job ที่รันเสมอ (ไม่มี if ระดับ job ที่ทำให้ถูกข้าม)', () => {
    const testJob = text.slice(text.indexOf('\n  test:\n'), text.indexOf('\n  e2e-shard:'));
    // if ระดับ job ได้เฉพาะ always() (รันเสมอ) · เงื่อนไขอื่นอยู่ระดับ step
    expect(testJob).toMatch(/\n    needs: changes\n    if: \$\{\{ always\(\) \}\}\n    runs-on: ubuntu-latest\n/);
    expect(testJob.match(/\n    if:/g)).toHaveLength(1);
    // งานตรวจไฟล์ที่เปลี่ยนล้ม = test ต้องล้มจริง (ไม่ใช่ skipped)
    expect(testJob).toMatch(/if: \$\{\{ needs\.changes\.result != 'success' \}\}\n        run: \|\n[^\n]*\n          exit 1/);
    const e2eJob = text.slice(text.indexOf('\n  e2e:\n'));
    expect(e2eJob).toContain('if: ${{ always() }}');
  });
  it('ทุกขั้นตอนหนักของ test มีเงื่อนไข code == true', () => {
    const testJob = text.slice(text.indexOf('\n  test:\n'), text.indexOf('\n  e2e-shard:'));
    for (const cmd of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build']) {
      expect(testJob).toMatch(new RegExp(`- run: ${cmd}\\n        if: \\$\\{\\{ needs\\.changes\\.outputs\\.code == 'true' \\}\\}`));
    }
  });
  it('e2e ผ่านทันทีเฉพาะเมื่อ changes สำเร็จและ code เป็น false จริง (changes ล้ม = ไม่ผ่านง่ายๆ)', () => {
    expect(text).toContain('if [ "${{ needs.changes.result }}" = "success" ] && [ "${{ needs.changes.outputs.code }}" = "false" ]; then');
  });
  it('เทียบไฟล์แบบ --no-renames กับ commit แม่ (ย้ายโค้ดเข้า docs/ ต้องไม่ถูกนับเป็นเอกสาร) และไม่ใช้ค่าจาก PR ในคำสั่ง', () => {
    expect(text).toContain('git diff --name-only --no-renames "$BASE" HEAD');
    expect(text).toContain('BASE=$(git rev-parse --verify -q "HEAD^1" || true)');
    expect(live).not.toMatch(/github\.(head_ref|event\.pull_request\.(title|body|head))/);
  });
  it('ค่าเริ่มต้นเป็น "แก้โค้ด" และตัวกรองเอกสารไม่รวมโค้ด/เทสต์/workflow/config', () => {
    expect(text).toMatch(/\n          code=true\n/);
    const m = /grep -qvE '([^']+)'/.exec(text);
    expect(m).not.toBeNull();
    const notDoc = new RegExp(m![1]!);
    // ไฟล์เหล่านี้ถือเป็นเอกสาร (grep -v ไม่พบบรรทัดที่ไม่ใช่เอกสาร)
    for (const f of ['docs/HANDOFF.md', 'docs/design/a.png', 'docs/learning/x.md', 'README.md', 'CLAUDE.md', '.gitleaksignore']) expect(notDoc.test(f), f).toBe(true);
    // ไฟล์เหล่านี้ต้องนับเป็นโค้ด
    for (const f of ['src/app/route.ts', 'tests/unit/a.test.ts', '.github/workflows/ci.yml', 'package.json', 'package-lock.json', 'supabase/migrations/1.sql', 'src/docs/x.md', 'public/a.md.png', '.claude/settings.json', 'scripts/a.mjs']) {
      expect(notDoc.test(f), f).toBe(false);
    }
  });
});

describe('ci.yml: ความปลอดภัยของ workflow (repo เป็น public)', () => {
  it('สิทธิ์ GITHUB_TOKEN ระดับ workflow = contents: read อย่างเดียว', () => {
    expect(text).toMatch(/\npermissions:\n  contents: read\n/);
    expect(live).not.toMatch(/(contents|pull-requests|issues|actions|packages|id-token|checks|statuses|deployments): write/);
  });
  it('ไม่ใช้ pull_request_target/workflow_run และไม่อ้าง secrets', () => {
    expect(live).not.toMatch(/pull_request_target|workflow_run|issue_comment/);
    expect(live).not.toMatch(/\$\{\{\s*secrets\./);
    expect(live).not.toMatch(/\n\s+secrets:/);
  });
  it('ไม่รัน live-contract/งานที่ต้องใช้ key ใน CI', () => {
    expect(live).not.toMatch(/live-contract|admin:|MONEY_BUDDY_LIVE_TESTS|SERVICE_ROLE|SUPABASE_/);
  });
});

describe('ci.yml: ยกเลิกรอบเก่าของ PR เดิม', () => {
  it('ยกเลิกเฉพาะ pull_request · push เข้า main ไม่ยกเลิกกัน (กลุ่มแยกตาม commit)', () => {
    expect(text).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
    expect(text).toContain("group: ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || github.sha }}");
  });
});
