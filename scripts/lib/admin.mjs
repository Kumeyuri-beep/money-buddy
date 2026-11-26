// โหลด key ผู้ดูแลจากไฟล์ "นอกโปรเจกต์" แล้วสร้าง client ฝั่งผู้ดูแล · ใช้เฉพาะสคริปต์ในเครื่องเจ้าของ
// กติกา: ไม่พิมพ์/ไม่ log ค่า key · ไม่รับ key ทางอาร์กิวเมนต์ · ปฏิเสธถ้าไฟล์ key อยู่ในโฟลเดอร์โปรเจกต์
// รันสคริปต์ที่ใช้ไฟล์นี้ใน terminal ของเจ้าของเองเท่านั้น (ห้ามรันผ่านผู้ช่วย AI: ผลลัพธ์รวมรหัสชั่วคราวจะไปอยู่ในบันทึกการคุย)
import { createClient } from '@supabase/supabase-js';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { adminEnvPath, isInsideDir, redact } from './adminEnv.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

/** ข้อความ error ที่ปลอดภัย: รหัส + ข้อความสั้น ตัดความลับ ไม่พิมพ์ทั้งอ็อบเจ็กต์ error */
export function makeSafeMessage(secrets) {
  return (error) => {
    const status = error && typeof error === 'object' && 'status' in error ? String(error.status ?? '') : '';
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code ?? '') : '';
    const message = error && typeof error === 'object' && 'message' in error ? String(error.message ?? '') : String(error);
    return redact(`${status} ${code} ${message}`.trim(), secrets).slice(0, 240);
  };
}

// promise ที่ไม่มีใครจับ: พิมพ์เฉพาะข้อความสั้น (ไม่พิมพ์ stack/อ็อบเจ็กต์ทั้งก้อน)
process.on('unhandledRejection', (reason) => {
  fail(`เกิดข้อผิดพลาดที่ไม่คาดคิด: ${makeSafeMessage([])(reason)}`, 1);
});

const KEY_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'];

/** ตรวจไฟล์ key: อยู่นอกโปรเจกต์ (ตามลิงก์จริง) ไม่ใช่ symlink/พาธเครือข่าย และบน POSIX ไม่เปิดสิทธิ์ให้คนอื่นอ่าน */
function checkAdminFile(file) {
  if (file.startsWith('\\\\')) fail('ปฏิเสธ: ไม่รองรับพาธเครือข่ายหรือพาธขึ้นต้น \\\\ สำหรับไฟล์ key ผู้ดูแล');
  if (isInsideDir(file, projectRoot)) fail('ปฏิเสธ: ไฟล์ key ผู้ดูแลต้องอยู่นอกโฟลเดอร์โปรเจกต์');
  if (!existsSync(file)) {
    fail('ไม่พบไฟล์ key ผู้ดูแลที่ <โฟลเดอร์บ้าน>/.money-buddy-admin/admin.env (เจ้าของต้องสร้างและใส่ key เอง)');
  }
  const dir = dirname(file);
  if (lstatSync(file).isSymbolicLink() || lstatSync(dir).isSymbolicLink()) {
    fail('ปฏิเสธ: ไฟล์หรือโฟลเดอร์ key ผู้ดูแลเป็นลิงก์ (symlink/junction) ต้องเป็นไฟล์จริงนอกโปรเจกต์');
  }
  const realFile = realpathSync.native(file);
  const realRoot = realpathSync.native(projectRoot);
  if (isInsideDir(realFile, realRoot)) fail('ปฏิเสธ: พาธจริงของไฟล์ key ผู้ดูแลอยู่ในโฟลเดอร์โปรเจกต์');
  if (/onedrive|dropbox|google ?drive|icloud/i.test(realFile)) {
    console.error('คำเตือน: ไฟล์ key ผู้ดูแลอยู่ในโฟลเดอร์ที่ซิงก์ขึ้นคลาวด์ ควรย้ายออก');
  }
  if (process.platform !== 'win32' && (lstatSync(file).mode & 0o077) !== 0) {
    fail('ปฏิเสธ: สิทธิ์ไฟล์ key ผู้ดูแลเปิดให้คนอื่นอ่านได้ ตั้งเป็น 600 (chmod 600) ก่อน');
  }
}

export function loadAdmin() {
  // ห้ามมี key ผู้ดูแลอยู่ในสภาพแวดล้อมอยู่ก่อน: key ต้องมาจากไฟล์นอกโปรเจกต์เท่านั้น (ไม่ให้ค่าจาก shell/.env ชนะเงียบๆ)
  if (KEY_NAMES.some((name) => process.env[name])) {
    fail(`ปฏิเสธ: พบ ${KEY_NAMES.join(' หรือ ')} ใน environment ของ shell ให้ลบออก (key ต้องอ่านจาก admin.env เท่านั้น)`);
  }
  if (Object.keys(process.env).some((name) => /^VITE_.*(SERVICE|SECRET)/i.test(name))) {
    fail('พบตัวแปรขึ้นต้น VITE_ ที่ชื่อเกี่ยวกับ key ผู้ดูแล ซึ่งจะถูกฝังลงเว็บ ลบออกก่อน');
  }

  if (process.env.SUPABASE_DB_URL) {
    fail('ปฏิเสธ: พบ SUPABASE_DB_URL ใน environment ของ shell ให้ลบออก (ต้องอ่านจาก admin.env เท่านั้น)');
  }

  const file = resolve(adminEnvPath(homedir(), '/'));
  checkAdminFile(file);

  // อ่านเองด้วย parseEnv (ไม่ใช้ตัวโหลดที่เขียนลงสภาพแวดล้อม): ไม่ใส่ key ลงตัวแปรของ process (ไม่ให้ค้างหรือถูกส่งต่อให้ process ลูก)
  const values = parseEnv(readFileSync(file, 'utf8'));
  const url = values.SUPABASE_URL;
  const key = values.SUPABASE_SERVICE_ROLE_KEY || values.SUPABASE_SECRET_KEY;
  if (!url || !key) fail('ไฟล์ admin.env ต้องมี SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY (หรือ SUPABASE_SECRET_KEY)');

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // SUPABASE_DB_URL ใช้เฉพาะ admin:sql-tests (ไม่บังคับสำหรับสคริปต์อื่น) · อ่านจากไฟล์นี้เท่านั้นเช่นเดียวกับ key
  const dbUrl = values.SUPABASE_DB_URL;
  return { client, url, dbUrl, safeMessage: makeSafeMessage([key, url, dbUrl ?? '']) };
}
