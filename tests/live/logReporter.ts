import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Reporter, SerializedError, TestModule } from 'vitest/node';
import { formatLiveLog, safeErrorText, type LiveCaseRecord, type LiveRunRecord } from './logFormat';

/**
 * เขียนผลเต็มของชุดทดสอบจริงลงไฟล์ในเครื่องทุกครั้ง: .live-logs/live-<เวลา>.log (อยู่ใน .gitignore ไม่เข้า git)
 * มี: ชื่อข้อ ผล เวลาที่ใช้ต่อข้อ ข้อความ error เต็ม (ปิดบัง key/token แล้ว) และ 10 ข้อที่ช้าที่สุด
 * ไม่ทำให้รันล้มถ้าเขียนไฟล์ไม่ได้ (พิมพ์คำเตือนแทน)
 */
export default class LiveLogReporter implements Reporter {
  private startedAt = new Date();

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<SerializedError>): void {
    const cases: LiveCaseRecord[] = [];
    const suiteErrors: LiveRunRecord['suiteErrors'] = [];
    for (const mod of testModules) {
      const file = mod.moduleId.replace(/\\/g, '/').split('/tests/').pop() ?? mod.moduleId;
      for (const e of mod.errors()) suiteErrors.push({ file, message: safeErrorText(e) });
      for (const t of mod.children.allTests()) {
        const result = t.result();
        const state = result.state;
        const errors = state === 'failed' ? (result.errors ?? []).map((e) => safeErrorText(e)) : [];
        cases.push({ file, name: t.fullName, state, durationMs: t.diagnostic()?.duration ?? 0, errors });
      }
    }
    for (const e of unhandledErrors) suiteErrors.push({ file: '(ไม่ถูกจับ)', message: safeErrorText(e) });
    const run: LiveRunRecord = { startedAt: this.startedAt.toISOString(), cases, suiteErrors, totalMs: Date.now() - this.startedAt.getTime() };
    try {
      const dir = resolve(process.cwd(), '.live-logs');
      mkdirSync(dir, { recursive: true });
      const stamp = this.startedAt.toISOString().replace(/[:.]/g, '-');
      const file = resolve(dir, `live-${stamp}.log`);
      writeFileSync(file, formatLiveLog(run), 'utf8');
      // ไม่สะสมไม่จำกัด: เก็บ log รายรอบ 30 ไฟล์ล่าสุด และตัด live-requests.log ที่เกิน 1 MB
      const old = readdirSync(dir).filter((n) => /^live-20.*\.log$/.test(n)).sort();
      for (const n of old.slice(0, Math.max(0, old.length - 30))) rmSync(resolve(dir, n), { force: true });
      const req = resolve(dir, 'live-requests.log');
      if (existsSync(req) && statSync(req).size > 1_000_000) rmSync(req, { force: true });
      console.log(`\nบันทึก log เต็มที่ ${file}`);
    } catch {
      console.warn('\nเขียนไฟล์ log ของชุดทดสอบจริงไม่สำเร็จ (ไม่กระทบผลทดสอบ)');
    }
  }
}
