import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { redactSecrets, requestLogLine } from './logFormat';

/**
 * setupFile ของชุดทดสอบจริง: ห่อ fetch ของ Node ทั้งโปรเซสเพื่อบันทึกคำขอที่ "ช้า" หรือ "ล้ม" ลง .live-logs/live-requests.log
 * ครอบคลุมทั้ง client ผู้ใช้ทดสอบและ client ผู้ดูแล (ไม่แก้พฤติกรรม: ส่งต่อคำขอและคืนผลเดิมทุกอย่าง)
 * บันทึกเฉพาะ วิธี + พาธ + เวลา + ผล (ไม่มี host/query/header/body จึงไม่มี key หรือข้อมูล)
 * ที่มา: 13 พ.ย. 2569 พบข้อทดสอบที่ปกติ 8 วินาทีใช้ 57 วินาที (ใกล้เพดาน 60) จากคำขอเดียวที่ค้าง → ต้องรู้ว่าคำขอไหน
 */
export const SLOW_REQUEST_MS = 3_000;

const MARK = Symbol.for('money-buddy.live.traceFetch');
const g = globalThis as unknown as Record<symbol, unknown> & { fetch: typeof fetch };

function write(line: string): void {
  try {
    const dir = resolve(process.cwd(), '.live-logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(resolve(dir, 'live-requests.log'), line + '\n', 'utf8');
  } catch {
    /* log ไม่ได้ก็ไม่เป็นไร */
  }
}

if (!g[MARK]) {
  g[MARK] = true;
  const original = g.fetch.bind(globalThis);
  g.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const method = (init?.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const started = Date.now();
    try {
      const response = await original(input, init);
      const ms = Date.now() - started;
      if (ms >= SLOW_REQUEST_MS) write(requestLogLine({ at: new Date().toISOString(), method, url, ms, outcome: String(response.status) }));
      return response;
    } catch (e) {
      const ms = Date.now() - started;
      const reason = e instanceof Error ? `${e.name}${e.message ? ': ' + redactSecrets(e.message).slice(0, 120) : ''}` : 'error';
      write(requestLogLine({ at: new Date().toISOString(), method, url, ms, outcome: `ล้ม ${reason}` }));
      throw e;
    }
  }) as typeof fetch;
}
