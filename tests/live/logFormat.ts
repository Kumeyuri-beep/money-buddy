/**
 * จัดรูปแบบ log ของชุดทดสอบจริง (ฟังก์ชันล้วน ทดสอบใน tests/unit/liveLog.test.ts)
 * เป้าหมาย: เมื่อมีข้อล้ม/ช้า ต้องรู้ "ข้อไหน เพราะอะไร ใช้กี่มิลลิวินาที" จากไฟล์ log เดียว · ห้ามมี key/token ใน log
 */

export interface LiveCaseRecord {
  file: string;
  name: string;
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  durationMs: number;
  /** ข้อความ error (ถ้ามี) */
  errors: string[];
}

export interface LiveRunRecord {
  startedAt: string;
  cases: LiveCaseRecord[];
  /** ข้อผิดพลาดระดับไฟล์/ชุด (เช่น beforeAll ล้ม) และที่ไม่ถูกจับ */
  suiteErrors: { file: string; message: string }[];
  totalMs: number;
}

/** ปิดบังสิ่งที่เหมือน key/token (JWT, sb_secret_/sb_publishable_, Bearer, ค่า apikey) ก่อนเขียนลงไฟล์ */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT]')
    .replace(/sb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g, '[KEY]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[TOKEN]')
    .replace(/(apikey["':=\s]+)[A-Za-z0-9._-]{12,}/gi, '$1[KEY]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[URL]')
    .replace(/(refresh_token["':=\s]+)[A-Za-z0-9._-]{6,}/gi, '$1[TOKEN]');
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}… (ตัด ${s.length - n} ตัวอักษร)` : s);

/**
 * ซ่อนข้อมูลในวงเล็บปีกกา/เหลี่ยม (เช่น assertion `expected [ {...} ] to deeply equal []` ที่ถ้า RLS พังอาจมีแถวข้อมูลจริงของคนอื่น)
 * เหลือแค่ชนิดและโครงข้อความ · ทำซ้ำจนวงเล็บซ้อนหมด
 */
export function scrubData(text: string): string {
  // ใช้อักขระแทนที่ (U+0001/U+0002) ระหว่างวน เพื่อให้วงเล็บที่ซ้อนกันยุบจากในออกนอกได้ครบ
  let out = String(text);
  for (let i = 0; i < 20; i++) {
    const next = out.replace(/\{[^{}]*\}/g, '\u0001').replace(/\[[^[\]]*\]/g, (m) => (m === '[]' ? m : '\u0002'));
    if (next === out) break;
    out = next;
  }
  return out.replace(/\u0001/g, '{…}').replace(/\u0002/g, '[…]');
}

/** ข้อความ error ที่ปลอดภัยและยาวพอวินิจฉัย: ปิดบังความลับ + ซ่อนข้อมูลในวงเล็บ + ตัดความยาว */
export function safeErrorText(e: unknown): string {
  const raw = e instanceof Error ? `${e.name}: ${e.message}` : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  return clip(scrubData(redactSecrets(raw)), 1200);
}

/** คำขอ HTTP ที่ช้าหรือล้ม: บันทึกเฉพาะ วิธี + พาธ (ไม่มี host, query, header, body จึงไม่มี key/ข้อมูล) + เวลา + ผล */
export function describeRequest(method: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = String(url).split('?')[0] ?? '';
  }
  return `${method.toUpperCase()} ${path}`;
}

export function requestLogLine(input: { at: string; method: string; url: string; ms: number; outcome: string }): string {
  return `${input.at} ${String(Math.round(input.ms)).padStart(6)}ms ${describeRequest(input.method, input.url)} ${input.outcome}`;
}

/** ข้อที่ช้า: เกินค่าที่กำหนด (ms) เรียงจากช้าสุด */
export function slowestCases(cases: readonly LiveCaseRecord[], top = 10): LiveCaseRecord[] {
  return [...cases].sort((a, b) => b.durationMs - a.durationMs).slice(0, top);
}

export function formatLiveLog(run: LiveRunRecord): string {
  const out: string[] = [];
  const count = (s: LiveCaseRecord['state']) => run.cases.filter((c) => c.state === s).length;
  out.push(`# live-contract log · เริ่ม ${run.startedAt} · ใช้เวลารวม ${(run.totalMs / 1000).toFixed(1)} วินาที`);
  out.push(`# ผ่าน ${count('passed')} · ล้ม ${count('failed')} · ข้าม ${count('skipped') + count('pending')} · ทั้งหมด ${run.cases.length}`);
  out.push('');
  out.push('## ทุกข้อ (ลำดับที่รัน)');
  for (const c of run.cases) {
    const tag = c.state === 'passed' ? 'PASS' : c.state === 'failed' ? 'FAIL' : 'SKIP';
    out.push(`${tag} ${String(Math.round(c.durationMs)).padStart(6)}ms  ${c.file} > ${c.name}`);
    for (const e of c.errors) out.push(`      ข้อผิดพลาด: ${e.replace(/\n/g, '\n      ')}`);
  }
  if (run.suiteErrors.length > 0) {
    out.push('');
    out.push('## ข้อผิดพลาดระดับไฟล์/ที่ไม่ถูกจับ');
    for (const s of run.suiteErrors) out.push(`${s.file}: ${s.message.replace(/\n/g, '\n      ')}`);
  }
  out.push('');
  out.push('## ช้าที่สุด 10 ข้อ');
  for (const c of slowestCases(run.cases)) out.push(`${String(Math.round(c.durationMs)).padStart(6)}ms  ${c.file} > ${c.name}`);
  return out.join('\n') + '\n';
}
