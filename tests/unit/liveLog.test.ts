import { describe, expect, it } from 'vitest';
import { describeRequest, formatLiveLog, redactSecrets, requestLogLine, safeErrorText, scrubData, slowestCases, type LiveRunRecord } from '../live/logFormat';
import { authErrorText } from '../live/liveHelpers';

const gitignore = Object.values(import.meta.glob('/.gitignore', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';
const rawFiles = import.meta.glob('/tests/live/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const liveConfig = Object.values(import.meta.glob('/vitest.live.config.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? '';

/** log ของชุดทดสอบจริง (เจ้าของสั่ง 13 พ.ย. 2569): ต้องรู้ชื่อข้อที่ล้ม ข้อความ error และเวลาต่อข้อทุกครั้ง · ห้ามมี key */
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlMTIzNDU2';

describe('redactSecrets / safeErrorText', () => {
  it('ปิดบัง JWT, sb_secret_/sb_publishable_, Bearer และ apikey', () => {
    const text = `x ${JWT} y sb_secret_abcdefghijk1234 z Bearer abcdefghijklmnop1234 apikey: abcdefghijklmnop12`;
    const out = redactSecrets(text);
    expect(out).not.toContain(JWT);
    expect(out).not.toMatch(/sb_secret_abc|abcdefghijklmnop12/);
    expect(out).toContain('[JWT]');
    expect(out).toContain('[KEY]');
    expect(out).toContain('[TOKEN]');
  });
  it('ข้อความธรรมดาไม่ถูกแก้ · error ยาวถูกตัดและบอกจำนวนที่ตัด', () => {
    expect(redactSecrets('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: 400 invalid_credentials')).toBe('ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: 400 invalid_credentials');
    const long = safeErrorText(new Error('ก'.repeat(5000)));
    expect(long.length).toBeLessThan(1300);
    expect(long).toContain('ตัด');
  });
  it('ปิดบัง URL โปรเจกต์และ refresh_token', () => {
    const out = redactSecrets('fetch https://abcd1234.supabase.co/auth/v1/token?x=1 failed refresh_token: abcdef123456');
    expect(out).not.toContain('supabase.co');
    expect(out).toContain('[URL]');
    expect(out).not.toContain('abcdef123456');
  });
  it('scrubData ซ่อนแถวข้อมูลใน assertion (กรณี RLS พังแล้วแถวของคนอื่นหลุดเข้าข้อความ) แต่เก็บโครงข้อความและ [] ว่าง', () => {
    const msg = 'AssertionError: expected [ { id: "x", amount: 12345, memo: "ลับ" } ] to deeply equal []';
    const out = scrubData(msg);
    expect(out).toBe('AssertionError: expected […] to deeply equal []');
    expect(out).not.toMatch(/12345|ลับ/);
    expect(scrubData('nested {a: {b: [1, {c: 2}]}} end')).toBe('nested {…} end');
    expect(safeErrorText(new Error('expected [ { secret: 987654 } ] to equal []'))).not.toContain('987654');
  });
  it('รับ error ที่ไม่ใช่ Error (อ็อบเจ็กต์ที่มี message / ข้อความ) ไม่พัง', () => {
    expect(safeErrorText({ message: 'ข้อความ' })).toBe('ข้อความ');
    expect(safeErrorText('plain')).toBe('plain');
  });
});

describe('formatLiveLog', () => {
  const run: LiveRunRecord = {
    startedAt: '2026-11-13T15:00:00.000Z',
    totalMs: 205_000,
    suiteErrors: [{ file: 'live/investRls.live.ts', message: 'ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: AuthApiError 429 over_request_rate_limit' }],
    cases: [
      { file: 'live/a.live.ts', name: 'ข้อเร็ว', state: 'passed', durationMs: 120, errors: [] },
      { file: 'live/a.live.ts', name: 'ข้อช้า', state: 'passed', durationMs: 90_000, errors: [] },
      { file: 'live/b.live.ts', name: 'ข้อล้ม', state: 'failed', durationMs: 4_000, errors: ['AssertionError: expected 1 to be 2'] },
      { file: 'live/b.live.ts', name: 'ข้อข้าม', state: 'skipped', durationMs: 0, errors: [] },
    ],
  };
  const log = formatLiveLog(run);
  it('มีสรุปจำนวน เวลารวม และทุกข้อพร้อมเวลาเป็นมิลลิวินาที', () => {
    expect(log).toContain('ผ่าน 2 · ล้ม 1 · ข้าม 1 · ทั้งหมด 4');
    expect(log).toContain('205.0 วินาที');
    expect(log).toMatch(/PASS\s+120ms\s+live\/a\.live\.ts > ข้อเร็ว/);
    expect(log).toMatch(/PASS\s+90000ms\s+live\/a\.live\.ts > ข้อช้า/);
  });
  it('ข้อที่ล้มมีชื่อข้อและข้อความ error เต็ม · ข้อผิดพลาดระดับไฟล์ถูกบันทึก', () => {
    expect(log).toMatch(/FAIL\s+4000ms\s+live\/b\.live\.ts > ข้อล้ม/);
    expect(log).toContain('ข้อผิดพลาด: AssertionError: expected 1 to be 2');
    expect(log).toContain('live/investRls.live.ts: ล็อกอินผู้ใช้ทดสอบไม่สำเร็จ: AuthApiError 429 over_request_rate_limit');
  });
  it('มีรายการข้อที่ช้าที่สุด เรียงจากช้าไปเร็ว', () => {
    expect(slowestCases(run.cases, 2).map((c) => c.name)).toEqual(['ข้อช้า', 'ข้อล้ม']);
    expect(log.indexOf('## ช้าที่สุด')).toBeGreaterThan(log.indexOf('## ทุกข้อ'));
  });
});

describe('authErrorText', () => {
  it('รวมชื่อ/สถานะ/รหัส/ข้อความของ error (ไม่ทิ้งสาเหตุจริง) และตัดความยาว', () => {
    expect(authErrorText({ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit', message: 'rate limit' })).toBe('AuthApiError 429 over_request_rate_limit rate limit');
    expect(authErrorText(null)).toContain('ไม่มี error');
    expect(authErrorText({ message: 'x'.repeat(1000) }).length).toBe(300);
  });
});

describe('การตั้งค่า log', () => {
  it('config ใช้ reporter เขียนไฟล์ · .live-logs/ อยู่ใน .gitignore (ไม่เข้า git)', () => {
    expect(liveConfig).toContain("reporters: ['default', './tests/live/logReporter.ts']");
    expect(gitignore).toMatch(/^\.live-logs\/$/m);
  });
  it('เทสต์จริงไม่ทิ้งสาเหตุของการล็อกอินล้มอีก (ทุกจุดที่ล็อกอินล้มต้องแนบ authErrorText)', () => {
    for (const [path, text] of Object.entries(rawFiles)) {
      if (!path.endsWith('.live.ts')) continue;
      expect(text, path).not.toMatch(/throw new Error\('ล็อกอินผู้ใช้ทดสอบ[^']*ไม่สำเร็จ'\)/);
    }
  });
  it('reporter ไม่พิมพ์/เขียน environment หรือ key', () => {
    const src = rawFiles['/tests/live/logReporter.ts'] ?? '';
    expect(src).not.toMatch(/process\.env/);
    expect(src).toContain('safeErrorText');
  });
});

describe('บันทึกคำขอที่ช้า (traceFetch)', () => {
  it('describeRequest เก็บเฉพาะวิธี + พาธ: ไม่มี host, query หรือค่าใน query', () => {
    expect(describeRequest('get', 'https://abcd1234.supabase.co/rest/v1/trades?select=*&user_id=eq.0000&apikey=secret-value')).toBe('GET /rest/v1/trades');
    expect(describeRequest('POST', '/rpc/record_trade?x=1')).toBe('POST /rpc/record_trade');
  });
  it('requestLogLine: เวลา + มิลลิวินาที + วิธีพาธ + ผล', () => {
    const line = requestLogLine({ at: '2026-11-13T15:00:00.000Z', method: 'POST', url: 'https://h.supabase.co/auth/v1/token?grant_type=password', ms: 50_123, outcome: '200' });
    expect(line).toBe('2026-11-13T15:00:00.000Z  50123ms POST /auth/v1/token 200');
    expect(line).not.toContain('grant_type');
    expect(line).not.toContain('supabase.co');
  });
  it('config ใช้ setupFile ห่อ fetch · ตัวห่อไม่แตะ header/body/environment และส่งต่อผลเดิมไม่แก้', () => {
    expect(liveConfig).toContain("setupFiles: ['tests/live/traceFetch.ts']");
    const full = rawFiles['/tests/live/traceFetch.ts'] ?? '';
    const src = full.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // ไม่นับคอมเมนต์
    expect(src).not.toMatch(/headers|\.body|process\.env|authorization/i);
    expect(src).toContain('return response;');
    expect(src).toContain('throw e;');
  });
  it('คำขอที่ทำซ้ำได้ปลอดภัย (GET/HEAD/DELETE) มีเพดานเวลา · POST/PATCH/PUT ไม่ถูกตัด (ไม่รู้ว่าเซิร์ฟเวอร์ทำไปแล้วหรือยัง)', () => {
    const src = rawFiles['/tests/live/liveHelpers.ts'] ?? '';
    expect(src).toContain('AbortSignal.timeout(SAFE_REQUEST_TIMEOUT_MS)');
    expect(src).toMatch(/const signal = safe \?/);
    expect(src).toContain('if (!safe || attempt >= 2 || init?.signal?.aborted) throw e;');
  });
});
